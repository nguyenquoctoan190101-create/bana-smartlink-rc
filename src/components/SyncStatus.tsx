import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Database, RefreshCw, Wifi, WifiOff, XCircle } from "lucide-react";
import { getSyncQueue } from "../lib/db";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import { syncQueuedReports } from "../lib/reportSync";

interface SyncStatusProps {
  onSyncCompleted: () => void;
}

export default function SyncStatus({ onSyncCompleted }: SyncStatusProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [serverConfirmed, setServerConfirmed] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "info" | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [userExpanded, setUserExpanded] = useState(false);

  const refreshQueue = useCallback(async () => {
    const queue = await getSyncQueue();
    setQueueSize(queue.length);
  }, []);

  const triggerSync = async () => {
    if (!navigator.onLine || isSyncing) {
      setMessage("Thiết bị đang ngoại tuyến. Dữ liệu vẫn được giữ trên thiết bị.");
      setMessageTone("warning");
      return;
    }
    setIsSyncing(true);
    setErrors([]);
    try {
      if (queueSize === 0) {
        setMessage("Không có báo cáo nào đang chờ gửi.");
        setMessageTone("info");
        return;
      }
      setMessage(`Đang gửi ${queueSize} báo cáo...`);
      setMessageTone("info");
      const result = await syncQueuedReports();

      const rejectedMessages = result.rejected.map((rejected) => {
        const retry = rejected.retryable ? "Hệ thống sẽ cho phép thử lại." : "Cần mở báo cáo để xử lý.";
        return `${rejected.client_id}: ${rejected.message} (${rejected.code}). ${retry}`;
      });
      setErrors(rejectedMessages);
      setMessage(rejectedMessages.length
        ? `Đã gửi ${result.accepted.length} báo cáo; ${rejectedMessages.length} báo cáo vẫn được giữ trong hàng đợi.`
        : `Đã gửi thành công ${result.accepted.length} báo cáo.`);
      setMessageTone(rejectedMessages.length ? "warning" : "success");
      await refreshQueue();
      onSyncCompleted();
    } catch (cause) {
      setMessage(toUserFacingError(cause, "Đồng bộ thất bại. Vui lòng thử lại."));
      setMessageTone("warning");
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

  const needsAttention =
    !isOnline ||
    queueSize > 0 ||
    errors.length > 0 ||
    isSyncing ||
    messageTone === "warning";
  const isExpanded = needsAttention || userExpanded;
  const connectionLabel = !isOnline
    ? "Ngoại tuyến"
    : serverConfirmed
      ? "Máy chủ sẵn sàng"
      : "Đang kiểm tra máy chủ";
  const summary =
    messageTone === "success" && message
      ? message
      : `${connectionLabel} · ${queueSize} báo cáo chờ gửi`;

  return (
    <section aria-labelledby="sync-title" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:px-4">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={`shrink-0 rounded-lg p-2 ${serverConfirmed ? "bg-emerald-50 text-emerald-700" : isOnline ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
            {isOnline ? <Wifi aria-hidden="true" className="h-5 w-5" /> : <WifiOff aria-hidden="true" className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 id="sync-title" className="text-sm font-bold text-slate-900">Đồng bộ báo cáo</h2>
            <p className="truncate text-xs text-slate-600 sm:text-sm" aria-live="polite">
              {summary}
            </p>
          </div>
        </div>
        {!needsAttention && (
          <button
            type="button"
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            aria-expanded={isExpanded}
            aria-controls="sync-details"
            onClick={() => setUserExpanded((current) => !current)}
          >
            {isExpanded ? "Thu gọn" : "Chi tiết"}
            <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {isExpanded && (
        <div id="sync-details" className="mt-2.5 border-t border-slate-100 pt-2.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1 text-xs text-slate-600 sm:text-sm">
              <Database aria-hidden="true" className="h-4 w-4 shrink-0" />
              Chỉ xóa khỏi hàng đợi khi máy chủ xác nhận từng báo cáo.
            </p>
            <button type="button" onClick={triggerSync} disabled={!isOnline || !serverConfirmed || isSyncing || queueSize === 0} className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-600">
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Đang gửi..." : "Đồng bộ ngay"}
            </button>
          </div>
          {message && messageTone !== "success" && (
            <p role={messageTone === "warning" ? "alert" : "status"} className="mt-3 flex items-start gap-2 text-sm text-slate-700">
              {messageTone === "warning"
                ? <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-600" />
                : <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-600" />}
              {message}
            </p>
          )}
          {errors.length > 0 && <ul className="mt-3 space-y-2">{errors.map((error) => <li key={error} className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><XCircle aria-hidden="true" className="h-5 w-5 shrink-0" />{error}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
