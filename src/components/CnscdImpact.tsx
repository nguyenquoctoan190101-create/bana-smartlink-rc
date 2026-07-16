import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Users } from "lucide-react";
import { apiFetch } from "../lib/apiClient";

interface CnscdImpactProps {
  selectedPeriod: string;
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
  submitted_report_count: number;
  assisted_report_count: number;
  ct13_total: number | null;
  difference: number | null;
  absolute_difference: number | null;
  missing_ct13_report_count: number;
  villages: VillageImpact[];
  interpretation: string;
}

const showNumber = (value: number | null, unit = "") =>
  value === null ? "—" : `${value.toLocaleString("vi-VN")}${unit}`;

export default function CnscdImpact({ selectedPeriod }: CnscdImpactProps) {
  const [data, setData] = useState<CnscdImpactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(
          `/api/cnscd-impact?period_id=${encodeURIComponent(selectedPeriod)}`,
          { signal: controller.signal, headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error("Không thể tải dữ liệu hiệu quả CNSCĐ.");
        setData((await response.json()) as CnscdImpactData);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Không thể tải dữ liệu.");
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selectedPeriod, reloadKey]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-slate-600" role="status">Đang tải dữ liệu hiệu quả CNSCĐ…</p>;
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

  const complete = data.missing_ct13_report_count === 0;
  return (
    <section className="space-y-5" aria-labelledby="cnscd-title">
      <header>
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Điều hành theo bằng chứng</p>
        <h1 id="cnscd-title" className="mt-1 text-2xl font-bold text-slate-950">Hiệu quả hỗ trợ của Tổ CNSCĐ</h1>
        <p className="mt-2 text-sm text-slate-600">{data.period_name} · Phạm vi toàn xã · Nguồn: báo cáo đã được quyền xem</p>
      </header>

      {!complete && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-sm text-amber-950">Chưa tính tổng hoặc độ lệch vì {data.missing_ct13_report_count} báo cáo thiếu CT13. Giá trị thiếu không được quy đổi thành 0.</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Báo cáo đã nộp", data.submitted_report_count.toLocaleString("vi-VN"), "báo cáo"],
          ["Có CNSCĐ hỗ trợ", data.assisted_report_count.toLocaleString("vi-VN"), "báo cáo"],
          ["Tổng CT13 tự khai", showNumber(data.ct13_total), data.ct13_total === null ? "Chưa đủ dữ liệu" : "lượt"],
          ["Chênh lệch đối chiếu", showNumber(data.difference), data.difference === null ? "Chưa đủ dữ liệu" : "lượt"],
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
          <h2 className="font-semibold text-slate-950">Đối chiếu theo thôn</h2>
          <p className="mt-1 text-sm text-slate-600">Dấu “—” nghĩa là chưa có dữ liệu, không phải số 0.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700"><tr><th className="px-5 py-3">Thôn</th><th className="px-5 py-3">Trạng thái báo cáo</th><th className="px-5 py-3 text-right">CNSCĐ hỗ trợ</th><th className="px-5 py-3 text-right">CT13 tự khai</th><th className="px-5 py-3 text-right">Chênh lệch</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.villages.map((item) => (
                <tr key={item.village_id}>
                  <td className="px-5 py-3 font-semibold text-slate-900">{item.village_name}</td>
                  <td className="px-5 py-3">{item.report_id ? <span className="inline-flex items-center gap-1 text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Đã nộp</span> : <span className="text-slate-500">Chưa nộp</span>}</td>
                  <td className="px-5 py-3 text-right">{item.report_id ? item.assisted_report_count : "—"}</td>
                  <td className="px-5 py-3 text-right">{showNumber(item.ct13_value)}</td>
                  <td className="px-5 py-3 text-right">{showNumber(item.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <Users className="h-5 w-5 shrink-0" aria-hidden="true" /><p>{data.interpretation}</p>
      </div>
    </section>
  );
}
