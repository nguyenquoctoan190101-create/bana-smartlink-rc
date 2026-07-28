import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Users } from "lucide-react";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import type { UserRole } from "../types";

interface CnscdImpactProps {
  selectedPeriod: string;
  periods?: Array<{ id: string; name: string; display_name?: string }>;
  role?: UserRole;
  onNavigate?: (target: "report-form" | "operations") => void;
}

interface VillageImpact {
  village_id: string;
  village_name: string;
  report_id: string | null;
  assisted_report_count: number;
  ct02_value: number | null;
  ct13_value: number | null;
  guided_people_per_1000: number | null;
  data_status: "not_submitted" | "incomplete" | "complete";
  next_action:
    | "create_report"
    | "complete_report"
    | "record_assistance"
    | "view_work_queue";
}

interface CnscdImpactData {
  period_id: string;
  period_name: string;
  scope: "commune" | "assigned_villages";
  scope_village_count: number;
  has_report_data: boolean;
  submitted_report_count: number;
  assisted_report_count: number;
  ct02_total: number | null;
  ct13_total: number | null;
  guided_people_per_1000: number | null;
  metric_registry_version: string;
  metric_interpretation_limit: string;
  missing_ct02_report_count: number;
  missing_ct13_report_count: number;
  zero_ct02_report_count: number;
  villages: VillageImpact[];
  interpretation: string;
}
const EMPTY_PERIODS: Array<{ id: string; name: string; display_name?: string }> = [];

const showNumber = (value: number | null, unit = "") =>
  value === null ? "—" : `${value.toLocaleString("vi-VN")}${unit}`;

const showRate = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

const dataStatusLabels: Record<VillageImpact["data_status"], string> = {
  not_submitted: "Chưa có báo cáo trên máy chủ",
  incomplete: "Đã có báo cáo, thiếu CT02/CT13",
  complete: "Đã có đủ CT02 và CT13",
};

const actionLabels: Record<VillageImpact["next_action"], string> = {
  create_report: "Lập báo cáo",
  complete_report: "Bổ sung CT02/CT13",
  record_assistance: "Ghi nhận hỗ trợ",
  view_work_queue: "Xem hàng việc",
};

const dataStatuses = new Set<VillageImpact["data_status"]>([
  "not_submitted",
  "incomplete",
  "complete",
]);
const nextActions = new Set<VillageImpact["next_action"]>([
  "create_report",
  "complete_report",
  "record_assistance",
  "view_work_queue",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isVillageImpact(value: unknown): value is VillageImpact {
  return (
    isRecord(value) &&
    typeof value.village_id === "string" &&
    typeof value.village_name === "string" &&
    (value.report_id === null || typeof value.report_id === "string") &&
    typeof value.assisted_report_count === "number" &&
    isNullableFiniteNumber(value.ct02_value) &&
    isNullableFiniteNumber(value.ct13_value) &&
    isNullableFiniteNumber(value.guided_people_per_1000) &&
    typeof value.data_status === "string" &&
    dataStatuses.has(value.data_status as VillageImpact["data_status"]) &&
    typeof value.next_action === "string" &&
    nextActions.has(value.next_action as VillageImpact["next_action"])
  );
}

function isCnscdImpactData(value: unknown): value is CnscdImpactData {
  return (
    isRecord(value) &&
    typeof value.period_id === "string" &&
    typeof value.period_name === "string" &&
    (value.scope === "commune" || value.scope === "assigned_villages") &&
    typeof value.scope_village_count === "number" &&
    typeof value.has_report_data === "boolean" &&
    typeof value.submitted_report_count === "number" &&
    typeof value.assisted_report_count === "number" &&
    isNullableFiniteNumber(value.ct02_total) &&
    isNullableFiniteNumber(value.ct13_total) &&
    isNullableFiniteNumber(value.guided_people_per_1000) &&
    typeof value.metric_registry_version === "string" &&
    typeof value.metric_interpretation_limit === "string" &&
    typeof value.missing_ct02_report_count === "number" &&
    typeof value.missing_ct13_report_count === "number" &&
    typeof value.zero_ct02_report_count === "number" &&
    Array.isArray(value.villages) &&
    value.villages.every(isVillageImpact) &&
    typeof value.interpretation === "string"
  );
}

export default function CnscdImpact({
  selectedPeriod,
  periods = EMPTY_PERIODS,
  role = "lanh_dao",
  onNavigate,
}: CnscdImpactProps) {
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
        const payload: unknown = await response.json();
        if (!isCnscdImpactData(payload)) {
          throw new Error("Phản hồi dữ liệu CNSCĐ không đúng hợp đồng.");
        }
        setData(payload);
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

  const complete =
    data.has_report_data &&
    data.missing_ct02_report_count === 0 &&
    data.missing_ct13_report_count === 0 &&
    data.zero_ct02_report_count === 0;
  const scopeLabel =
    data.scope === "assigned_villages"
      ? `${data.scope_village_count} thôn được phân công`
      : `${data.scope_village_count} thôn toàn xã`;
  const assistanceRate =
    data.submitted_report_count > 0
      ? Math.round(
          (data.assisted_report_count / data.submitted_report_count) * 100,
        )
      : null;
  const navigateForAction = (item: VillageImpact) => {
    if (!onNavigate) return;
    if (
      role === "to_cnscd" &&
      item.next_action !== "view_work_queue"
    ) {
      onNavigate("report-form");
      return;
    }
    onNavigate("operations");
  };
  return (
    <section className="space-y-5" aria-labelledby="cnscd-title">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">THEO DÕI HỖ TRỢ</p>
          <h1 id="cnscd-title" className="mt-1 text-2xl font-bold text-slate-950">Kết quả hỗ trợ chuyển đổi số</h1>
          <p className="mt-2 text-sm text-slate-600">
            {data.period_name} · Phạm vi: {scopeLabel} · Nguồn: báo cáo đã
            đồng bộ trong quyền truy cập
          </p>
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
          <p className="text-sm text-amber-950">
            Chưa tổng hợp tỷ lệ trên 1.000 dân vì còn{" "}
            {data.missing_ct02_report_count} báo cáo thiếu CT02,{" "}
            {data.missing_ct13_report_count} báo cáo thiếu CT13 và{" "}
            {data.zero_ct02_report_count} báo cáo có CT02 bằng 0. Giá trị thiếu
            không được quy đổi thành 0.
          </p>
        </div>
      )}

      <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <Users className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          “Báo cáo có hỗ trợ” ghi nhận việc Tổ công nghệ số tham gia lập báo
          cáo. Chỉ số trên 1.000 dân dùng công thức đã quản trị: tổng CT13 chia
          tổng CT02 rồi nhân 1.000 trong cùng kỳ và phạm vi.{" "}
          {data.metric_interpretation_limit}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {[
          ["Báo cáo đã nộp", data.submitted_report_count.toLocaleString("vi-VN"), "báo cáo"],
          ["Có Tổ công nghệ số hỗ trợ", data.has_report_data ? data.assisted_report_count.toLocaleString("vi-VN") : "—", data.has_report_data ? "báo cáo" : "Chưa có báo cáo"],
          ["Tỷ lệ báo cáo có hỗ trợ", assistanceRate === null ? "—" : `${assistanceRate}%`, assistanceRate === null ? "Chưa có mẫu số" : `${data.assisted_report_count}/${data.submitted_report_count} báo cáo đã nộp`],
          ["Dân số trong báo cáo (CT02)", showNumber(data.ct02_total), data.ct02_total === null ? "Chưa đủ dữ liệu" : "người"],
          ["Người được hướng dẫn sử dụng dịch vụ công trực tuyến", showNumber(data.ct13_total), data.ct13_total === null ? "Chưa đủ dữ liệu" : "người"],
          ["Người được hướng dẫn trên 1.000 dân", showRate(data.guided_people_per_1000), data.guided_people_per_1000 === null ? "Chưa đủ CT02/CT13" : `người/1.000 dân/kỳ · bộ chỉ số phiên bản ${data.metric_registry_version}`],
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
        <div className="table-scroll-region overflow-x-auto focus-visible:ring-2 focus-visible:ring-emerald-700" role="region" tabIndex={0} aria-label="Bảng kết quả hỗ trợ theo thôn; có thể cuộn ngang trên màn hình nhỏ">
          <span className="sticky left-3 z-10 my-2 ml-3 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-900 lg:hidden">
            Vuốt ngang để xem thêm →
          </span>
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Kết quả hỗ trợ, CT02, CT13 và tỷ lệ trên 1.000 dân theo từng thôn
            </caption>
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th scope="col" className="px-5 py-3">Thôn</th>
                <th scope="col" className="px-5 py-3">Trạng thái báo cáo</th>
                <th scope="col" className="px-5 py-3 text-right">Có hỗ trợ</th>
                <th scope="col" className="px-5 py-3 text-right">CT02</th>
                <th scope="col" className="px-5 py-3 text-right">CT13</th>
                <th scope="col" className="px-5 py-3 text-right">CT13/1.000 dân</th>
                <th scope="col" className="px-5 py-3">Đồng bộ dữ liệu</th>
                <th scope="col" className="px-5 py-3">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.villages.map((item) => (
                <tr key={item.village_id}>
                  <th scope="row" className="px-5 py-3 text-left font-semibold text-slate-900">{item.village_name}</th>
                  <td className="px-5 py-3">{item.report_id ? <span className="inline-flex items-center gap-1 text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Đã nộp</span> : <span className="text-slate-500">Chưa nộp</span>}</td>
                  <td className="px-5 py-3 text-right">{item.report_id ? item.assisted_report_count : "—"}</td>
                  <td className="px-5 py-3 text-right">{showNumber(item.ct02_value)}</td>
                  <td className="px-5 py-3 text-right">{showNumber(item.ct13_value)}</td>
                  <td className="px-5 py-3 text-right">{showRate(item.guided_people_per_1000)}</td>
                  <td className="px-5 py-3">{dataStatusLabels[item.data_status]}</td>
                  <td className="px-5 py-3">
                    {onNavigate ? (
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center rounded-lg border border-emerald-300 bg-white px-3 font-semibold text-emerald-900 hover:bg-emerald-50"
                        onClick={() => navigateForAction(item)}
                      >
                        {role === "to_cnscd"
                          ? actionLabels[item.next_action]
                          : "Xem hàng việc"}
                      </button>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
