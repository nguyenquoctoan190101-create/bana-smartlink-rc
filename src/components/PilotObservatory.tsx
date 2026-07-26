import { useEffect, useState } from "react";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { Button, EmptyState, SectionCard, StatusBadge } from "./ui";

type Observation = {
  id: string;
  device_id: string;
  observed_at: string;
  value: number;
  unit: string;
  quality_flag: "good" | "suspect" | "bad" | "uncalibrated";
};

type Alert = { id: string; severity: string; headline: string; description?: string | null; status: string; source?: string | null; effective_from?: string | null };

const qualityLabel: Record<Observation["quality_flag"], string> = {
  good: "Tốt", suspect: "Cần kiểm tra", bad: "Không đạt", uncalibrated: "Chưa hiệu chuẩn",
};

export default function PilotObservatory({ enabled }: { enabled: boolean }) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!enabled) return;
    setLoading(true); setError(null);
    try {
      const [nextObservations, nextAlerts] = await Promise.all([
        apiJson<Observation[]>("/api/pilots/sensors/observations"),
        apiJson<Alert[]>("/api/pilots/alerts"),
      ]);
      setObservations(nextObservations); setAlerts(nextAlerts);
    } catch (cause) {
      setError(toUserFacingError(cause, "Không tải được dữ liệu quan trắc."));
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, [enabled]);

  if (!enabled) return null;
  return <div className="grid gap-5 lg:grid-cols-2">
    <SectionCard>
      <div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5 text-emerald-700" />Quan trắc gần nhất</h2><p className="mt-1 text-sm text-slate-600">Chỉ dùng để rà soát mô hình thử nghiệm nội bộ; chưa phát cảnh báo.</p></div><Button variant="secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /></Button></div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!error && !observations.length && <div className="mt-4"><EmptyState title="Chưa có quan trắc" description="Dữ liệu sẽ xuất hiện sau khi thiết bị được hiệu chuẩn và gateway gửi bản ghi." /></div>}
      {!!observations.length && <div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th>Thời điểm</th><th>Giá trị</th><th>Chất lượng</th></tr></thead><tbody>{observations.slice(0, 12).map((item) => <tr key={item.id}><td>{new Date(item.observed_at).toLocaleString("vi-VN")}</td><td className="font-semibold">{item.value} {item.unit}</td><td><StatusBadge status={item.quality_flag} /> <span className="sr-only">{qualityLabel[item.quality_flag]}</span></td></tr>)}</tbody></table></div>}
    </SectionCard>
    <SectionCard>
      <h2 className="flex items-center gap-2 text-lg font-bold"><AlertTriangle className="h-5 w-5 text-amber-700" />Cảnh báo nội bộ</h2><p className="mt-1 text-sm text-slate-600">Nguồn cảnh báo phải được xác minh trước khi truyền cho người dân.</p>
      {!alerts.length ? <div className="mt-4"><EmptyState title="Chưa có cảnh báo" description="Không có nghĩa là hệ thống dự báo an toàn; mô hình thử nghiệm chỉ hiển thị bản ghi đã nhận." /></div> : <div className="mt-4 space-y-3">{alerts.slice(0, 8).map((alert) => <article key={alert.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex items-center justify-between gap-2"><strong>{alert.headline}</strong><StatusBadge status={alert.status} /></div><p className="mt-1 text-sm text-slate-700">{alert.description || "Chưa có mô tả."}</p><p className="mt-2 text-xs text-slate-500">Nguồn: {alert.source || "Chưa xác định"}{alert.effective_from ? ` · ${new Date(alert.effective_from).toLocaleString("vi-VN")}` : ""}</p></article>)}</div>}
    </SectionCard>
  </div>;
}
