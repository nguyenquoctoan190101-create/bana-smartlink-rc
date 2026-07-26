import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Wifi, WifiOff, XCircle } from "lucide-react";
import { deleteReport, getSyncQueue, removeFromSyncQueue, saveReport } from "../lib/db";
import { apiFetch, apiJson, toUserFacingError } from "../lib/apiClient";
import type { ReportData, SyncReportsResponse } from "../types";

interface SyncStatusProps {
  onSyncCompleted: () => void;
}

export default function SyncStatus({ onSyncCompleted }: SyncStatusProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [serverConfirmed, setServerConfirmed] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const refreshQueue = useCallback(async () => {
    const queue = await getSyncQueue();
    setQueueSize(queue.length);
  }, []);

  const triggerSync = async () => {
    if (!navigator.onLine || isSyncing) {
      setMessage("Thiết bị đang ngoại tuyến. Dữ liệu vẫn được giữ trên thiết bị.");
      return;
    }
    setIsSyncing(true);
    setErrors([]);
    try {
      const queue = await getSyncQueue();
      if (queue.length === 0) {
        setMessage("Không có báo cáo nào đang chờ gửi.");
        return;
      }
      setMessage(`Đang gửi ${queue.length} báo cáo...`);
      const result = await apiJson<SyncReportsResponse>("/reports/sync", {
        method: "POST",
        body: JSON.stringify({ reports: queue }),
      });

      const byClientId = new Map(queue.map((report) => [report.id, report]));
      for (const accepted of result.accepted || []) {
        const queued = byClientId.get(accepted.client_id);
        if (!queued) continue;
        await removeFromSyncQueue(accepted.client_id);
        await deleteReport(accepted.client_id);
        const submitted: ReportData = {
          ...queued,
          id: accepted.report_id,
          version: accepted.version,
          workflow_status: accepted.workflow_status,
          timeliness_status: accepted.timeliness_status,
          publication_status: accepted.publication_status,
          status: accepted.workflow_status === "submitted"
            ? "Submitted"
            : accepted.workflow_status === "approved"
              ? "Approved"
              : accepted.workflow_status === "locked"
                ? "Locked"
                : "Draft",
          pending_sync: false,
          updated_at: new Date().toISOString(),
        };
        await saveReport(submitted);
      }

      const rejectedMessages = (result.rejected || []).map((rejected) => {
        const retry = rejected.retryable ? "Hệ thống sẽ cho phép thử lại." : "Cần mở báo cáo để xử lý.";
        return `${rejected.client_id}: ${rejected.message} (${rejected.code}). ${retry}`;
      });
      setErrors(rejectedMessages);
      setMessage(rejectedMessages.length
        ? `Đã gửi ${result.accepted?.length || 0} báo cáo; ${rejectedMessages.length} báo cáo vẫn được giữ trong hàng đợi.`
        : `Đã gửi thành công ${result.accepted?.length || 0} báo cáo.`);
      await refreshQueue();
      onSyncCompleted();
    } catch (cause) {
      setMessage(toUserFacingError(cause, "Đồng bộ thất bại. Vui lòng thử lại."));
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void refreshQueue();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshQueue();
    }, 10000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.clearInterval(interval);
    };
  }, [refreshQueue]);

  useEffect(() => {
    if (!isOnline) {
      setServerConfirmed(false);
      return undefined;
    }
    let cancelled = false;
    const confirmServer = async () => {
      try {
        const response = await apiFetch("/health/ready", { cache: "no-store" });
        if (!cancelled) setServerConfirmed(response.ok);
      } catch {
        if (!cancelled) setServerConfirmed(false);
      }
    };
    void confirmServer();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void confirmServer();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isOnline]);

  return (
    <section aria-labelledby="sync-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className={`rounded-lg p-2.5 ${serverConfirmed ? "bg-emerald-50 text-emerald-700" : isOnline ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
            {isOnline ? <Wifi aria-hidden="true" className="h-5 w-5" /> : <WifiOff aria-hidden="true" className="h-5 w-5" />}
          </span>
          <div>
            <h2 id="sync-title" className="text-sm font-bold text-slate-900">Đồng bộ báo cáo</h2>
            <p className="mt-1 text-sm text-slate-600">
              {!isOnline ? "Ngoại tuyến" : serverConfirmed ? "Máy chủ đã xác nhận kết nối" : "Đang kiểm tra máy chủ"} · {queueSize} báo cáo chờ gửi
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><Database aria-hidden="true" className="h-4 w-4" />Chỉ xóa khỏi hàng đợi khi máy chủ xác nhận từng báo cáo.</p>
          </div>
        </div>
        <button type="button" onClick={triggerSync} disabled={!isOnline || !serverConfirmed || isSyncing || queueSize === 0} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Đang gửi..." : "Đồng bộ ngay"}
        </button>
      </div>
      {message && <p role="status" className="mt-3 flex items-start gap-2 border-t border-slate-100 pt-3 text-sm text-slate-700">{errors.length ? <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-600" /> : <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-600" />}{message}</p>}
      {errors.length > 0 && <ul className="mt-3 space-y-2">{errors.map((error) => <li key={error} className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><XCircle aria-hidden="true" className="h-5 w-5 shrink-0" />{error}</li>)}</ul>}
    </section>
  );
}
