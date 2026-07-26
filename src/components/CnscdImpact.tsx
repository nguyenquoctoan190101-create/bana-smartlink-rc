import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Users } from "lucide-react";
import { apiFetch, toUserFacingError } from "../lib/apiClient";

interface CnscdImpactProps {
  selectedPeriod: string;
  periods?: Array<{ id: string; name: string; display_name?: string }>;
}

interface VillageImpact {
  village_id: string;
  village_name: string;
  report_id: string | null;
  assisted_report_count: number;
  ct13_value: number | null;
  difference: number | null;
  absolute_difference: number | null;
}

interface CnscdImpactData {
  period_id: string;
  period_name: string;
  has_report_data: boolean;
  submitted_report_count: number;
  assisted_report_count: number;
  ct13_total: number | null;
  difference: number | null;
  absolute_difference: number | null;
  missing_ct13_report_count: number;
  villages: VillageImpact[];
  interpretation: string;
}
const EMPTY_PERIODS: Array<{ id: string; name: string; display_name?: string }> = [];

const showNumber = (value: number | null, unit = "") =>
  value === null ? "—" : `${value.toLocaleString("vi-VN")}${unit}`;

export default function CnscdImpact({ selectedPeriod, periods = EMPTY_PERIODS }: CnscdImpactProps) {
  const [activePeriodId, setActivePeriodId] = useState(selectedPeriod);
  const [data, setData] = useState<CnscdImpactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (
      !activePeriodId ||
      (periods.length > 0 &&
        !periods.some((period) => period.id === activePeriodId))
    ) {
      setActivePeriodId(selectedPeriod || periods[0]?.id || "");
    }
  }, [activePeriodId, periods, selectedPeriod]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(
          `/api/cnscd-impact?period_id=${encodeURIComponent(activePeriodId)}`,
          { signal: controller.signal, headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error("Không thể tải dữ liệu hỗ trợ lập báo cáo của Tổ công nghệ số cộng đồng.");
        setData((await response.json()) as CnscdImpactData);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(toUserFacingError(reason, "Không thể tải dữ liệu."));
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [activePeriodId, reloadKey]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-slate-600" role="status">Đang tải dữ liệu hỗ trợ lập báo cáo của Tổ công nghệ số cộng đồng…</p>;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" aria-hidden="true" />
          <div className="space-y-3">
            <div><h2 className="font-semibold text-red-950">Không tải được dữ liệu</h2><p className="text-sm text-red-800">{error}</p></div>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-300 bg-white px-4 font-semibold text-red-900" onClick={() => setReloadKey((value) => value + 1)}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  const complete = data.has_report_data && data.missing_ct13_report_count === 0;
  return (
    <section className="space-y-5" aria-labelledby="cnscd-title">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">THEO DÕI HỖ TRỢ</p>
          <h1 id="cnscd-title" className="mt-1 text-2xl font-bold text-slate-950">Tình hình hỗ trợ lập báo cáo</h1>
          <p className="mt-2 text-sm text-slate-600">{data.period_name} · Phạm vi toàn xã · Nguồn: báo cáo đã được quyền xem</p>
        </div>
        {periods.length > 0 ? (
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700 lg:w-80">
            Kỳ theo dõi
            <select
              value={activePeriodId}
              onChange={(event) => setActivePeriodId(event.target.value)}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.display_name || period.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {!data.has_report_data && (
        <div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4" role="status">
          <AlertTriangle className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />
          <p className="text-sm text-slate-800">Kỳ này chưa có báo cáo được nộp. Các chỉ số đối chiếu được để trống, không quy đổi thành 0.</p>
        </div>
      )}

      {data.has_report_data && !complete && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-sm text-amber-950">Chưa tổng hợp CT13 vì {data.missing_ct13_report_count} báo cáo còn thiếu chỉ tiêu này. Giá trị thiếu không được quy đổi thành 0.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Báo cáo đã nộp", data.submitted_report_count.toLocaleString("vi-VN"), "báo cáo"],
          ["Có Tổ công nghệ số hỗ trợ", data.has_report_data ? data.assisted_report_count.toLocaleString("vi-VN") : "—", data.has_report_data ? "báo cáo" : "Chưa có báo cáo"],
          ["Người được hướng dẫn sử dụng dịch vụ công trực tuyến", showNumber(data.ct13_total), data.ct13_total === null ? "Chưa đủ dữ liệu" : "người"],
        ].map(([label, value, context]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{context}</p>
          </article>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h2 className="font-semibold text-slate-950">Tổng hợp theo thôn</h2>
          <p className="mt-1 text-sm text-slate-600">Dấu “—” nghĩa là chưa có dữ liệu, không phải số 0.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700"><tr><th className="px-5 py-3">Thôn</th><th className="px-5 py-3">Trạng thái báo cáo</th><th className="px-5 py-3 text-right">Báo cáo có hỗ trợ</th><th className="px-5 py-3 text-right">Số người được hướng dẫn (CT13)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.villages.map((item) => (
                <tr key={item.village_id}>
                  <td className="px-5 py-3 font-semibold text-slate-900">{item.village_name}</td>
                  <td className="px-5 py-3">{item.report_id ? <span className="inline-flex items-center gap-1 text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Đã nộp</span> : <span className="text-slate-500">Chưa nộp</span>}</td>
                  <td className="px-5 py-3 text-right">{item.report_id ? item.assisted_report_count : "—"}</td>
                  <td className="px-5 py-3 text-right">{showNumber(item.ct13_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <Users className="h-5 w-5 shrink-0" aria-hidden="true" /><p>Số báo cáo có hỗ trợ và số người được hướng dẫn là hai chỉ tiêu khác đơn vị, được hiển thị riêng và không dùng để tính chênh lệch.</p>
      </div>
    </section>
  );
}
