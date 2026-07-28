import { Activity, Baby, HeartPulse, LayoutGrid, Scale } from "lucide-react";
import type { ReportData, ReportPeriod } from "../types";
import { evaluateMetric } from "../lib/metricRegistry";
import { reportToMetricEvaluationReport } from "../lib/reportMetrics";

type DecisionVillage = {
  id: string;
  label: string;
  households: number | null;
  population: number | null;
  poor: number | null;
  nearPoor: number | null;
  children: number | null;
  specialChildren: number | null;
  culturalFamilies: number | null;
  insured: number | null;
  digitalTeam: number | null;
  guided: number | null;
  bhytRate: number | null;
  welfareRate: number | null;
  cultureRate: number | null;
  guidedPerThousand: number | null;
  specialChildrenRate: number | null;
};

type RiskBand = "low" | "medium" | "high" | "missing";

export type SingleVillageTrendPoint = {
  id: string;
  periodKey: string;
  periodLabel: string;
  sortDate: string;
  bhytRate: number | null;
  welfareRate: number | null;
  cultureRate: number | null;
  guidedPerThousand: number | null;
  welfareHouseholds: number | null;
};

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

const shortVillageName = (name: string) => name.replace(/^Thôn\s+/i, "");

const reportMetricValue = (
  report: ReportData,
  metricId: string,
): number | null => {
  const periodId =
    report.period_id || `legacy:${report.report_period}`;
  return evaluateMetric(
    metricId,
    [reportToMetricEvaluationReport(report, periodId)],
    {
      period_id: periodId,
      scope: `village:${report.village_id}`,
      expected_village_ids: [report.village_id],
    },
  ).value;
};

const percent = (value: number | null, digits = 1) => (finite(value) ? `${value.toFixed(digits)}%` : "—");

const riskClass: Record<RiskBand, string> = {
  low: "bg-emerald-50 text-emerald-900",
  medium: "bg-amber-100 text-amber-950",
  high: "bg-rose-100 text-rose-950",
  missing: "bg-slate-100 text-slate-700",
};

const riskLabel: Record<RiskBand, string> = {
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
  missing: "Thiếu dữ liệu",
};

export function buildDecisionVillages(reports: ReportData[], villageName: (id: string) => string): DecisionVillage[] {
  return reports.map((report) => {
    const households = finite(report.CT01) ? report.CT01 : null;
    const population = finite(report.CT02) ? report.CT02 : null;
    const poor = finite(report.CT03) ? report.CT03 : null;
    const nearPoor = finite(report.CT04) ? report.CT04 : null;
    const children = finite(report.CT07) ? report.CT07 : null;
    const specialChildren = finite(report.CT08) ? report.CT08 : null;
    const culturalFamilies = finite(report.CT09) ? report.CT09 : null;
    const insured = finite(report.CT11) ? report.CT11 : null;
    const digitalTeam = finite(report.CT12) ? report.CT12 : null;
    const guided = finite(report.CT13) ? report.CT13 : null;
    const welfareTotal = reportMetricValue(report, "welfare_burden_count");

    return {
      id: report.id,
      label: shortVillageName(villageName(report.village_id)),
      households,
      population,
      poor,
      nearPoor,
      children,
      specialChildren,
      culturalFamilies,
      insured,
      digitalTeam,
      guided,
      bhytRate: reportMetricValue(report, "health_insurance_rate"),
      welfareRate: reportMetricValue(report, "welfare_burden_rate"),
      cultureRate: reportMetricValue(report, "cultural_family_rate"),
      guidedPerThousand: reportMetricValue(report, "guided_people_per_1000"),
      // This registry entry remains draft until a suppression policy is
      // approved, so the evaluator deliberately returns null.
      specialChildrenRate: reportMetricValue(
        report,
        "vulnerable_children_rate",
      ),
    };
  });
}

export function buildSingleVillageTrend(
  reports: ReportData[],
  reportPeriods: ReportPeriod[] = [],
): SingleVillageTrendPoint[] {
  const periodsById = new Map(reportPeriods.map((period) => [period.id, period]));
  const latestByPeriod = new Map<string, ReportData>();

  for (const report of reports) {
    const periodKey = report.period_id
      ? `period:${report.period_id}`
      : `legacy:${report.report_period}`;
    const previous = latestByPeriod.get(periodKey);
    if (!previous || (report.updated_at || "") > (previous.updated_at || "")) {
      latestByPeriod.set(periodKey, report);
    }
  }

  return Array.from(latestByPeriod.entries())
    .map(([periodKey, report]) => {
      const period = report.period_id
        ? periodsById.get(report.period_id)
        : undefined;
      const welfareHouseholds = reportMetricValue(
        report,
        "welfare_burden_count",
      );

      return {
        id: report.id,
        periodKey,
        periodLabel:
          period?.display_name || period?.name || report.report_period,
        sortDate: period?.due_date || report.updated_at || "",
        bhytRate: reportMetricValue(report, "health_insurance_rate"),
        welfareRate: reportMetricValue(report, "welfare_burden_rate"),
        cultureRate: reportMetricValue(report, "cultural_family_rate"),
        guidedPerThousand: reportMetricValue(
          report,
          "guided_people_per_1000",
        ),
        welfareHouseholds,
      };
    })
    .sort(
      (left, right) =>
        left.sortDate.localeCompare(right.sortDate) ||
        left.periodLabel.localeCompare(right.periodLabel, "vi"),
    )
    .slice(-6);
}

function heatRisk(metric: "bhyt" | "welfare" | "culture" | "digital", value: number | null, digitalMax: number): RiskBand {
  if (!finite(value)) return "missing";
  if (metric === "bhyt") return value < 90 ? "high" : value < 95 ? "medium" : "low";
  if (metric === "welfare") return value > 10 ? "high" : value >= 5 ? "medium" : "low";
  if (metric === "culture") return value < 80 ? "high" : value < 90 ? "medium" : "low";
  if (digitalMax <= 0) return "missing";
  return value < digitalMax * 0.5 ? "high" : value < digitalMax * 0.8 ? "medium" : "low";
}

function EmptyChart() {
  return <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">Chưa đủ dữ liệu đã duyệt để lập biểu đồ. Hệ thống không thay dữ liệu thiếu bằng số 0.</div>;
}

function ChartHeader({ icon: Icon, eyebrow, title, description }: { icon: typeof Activity; eyebrow: string; title: string; description: string }) {
  return (
    <header className="flex items-start gap-3">
      <span className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">{eyebrow}</p>
        <h3 className="mt-1 text-base font-bold leading-snug text-slate-900">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
      </div>
    </header>
  );
}

const changeLabel = (
  current: number | null,
  previous: number | null | undefined,
) => {
  if (!finite(current) || !finite(previous)) return "Chưa đủ hai kỳ";
  const change = current - previous;
  if (Math.abs(change) < 0.05) return "Ổn định";
  return `${change > 0 ? "Tăng" : "Giảm"} ${Math.abs(change).toFixed(1)} điểm %`;
};

function SingleVillageInsights({
  reports,
  historicalReports,
  reportPeriods,
  selectedPeriodLabel,
  villageName,
}: {
  reports: ReportData[];
  historicalReports: ReportData[];
  reportPeriods: ReportPeriod[];
  selectedPeriodLabel?: string;
  villageName: (id: string) => string;
}) {
  const trend = buildSingleVillageTrend(historicalReports, reportPeriods);
  const current = buildDecisionVillages(reports, villageName)[0] || null;
  const latest = trend.at(-1);
  const previous = trend.at(-2);
  const scopedReport = reports[0] || historicalReports.at(-1);
  const scopedVillageName = scopedReport
    ? villageName(scopedReport.village_id)
    : "thôn đang chọn";
  const scopedPeriod = scopedReport?.period_id
    ? reportPeriods.find((period) => period.id === scopedReport.period_id)
    : undefined;
  const currentPeriodLabel =
    selectedPeriodLabel ||
    scopedPeriod?.display_name ||
    scopedPeriod?.name ||
    scopedReport?.report_period;

  const currentMetrics = current
    ? [
        {
          label: "Tham gia BHYT",
          value: percent(current.bhytRate),
          note: "Tham chiếu nghiệp vụ: 95%",
        },
        {
          label: "Hộ nghèo và cận nghèo",
          value:
            finite(current.poor) && finite(current.nearPoor)
              ? `${current.poor + current.nearPoor} hộ`
              : "—",
          note: finite(current.welfareRate)
            ? `${percent(current.welfareRate)} tổng số hộ`
            : "Chưa đủ mẫu số",
        },
        {
          label: "Gia đình văn hóa",
          value: percent(current.cultureRate),
          note: "Tỷ lệ trên tổng số hộ",
        },
        {
          label: "Hướng dẫn dịch vụ công",
          value: finite(current.guidedPerThousand)
            ? `${current.guidedPerThousand.toFixed(0)}/1.000 dân`
            : "—",
          note: finite(current.guided)
            ? `${current.guided.toLocaleString("vi-VN")} lượt trong kỳ`
            : "Chưa có dữ liệu",
        },
      ]
    : [];

  return (
    <section
      aria-labelledby="dashboard-insights-title"
      className="decision-dashboard space-y-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
            Theo dõi phạm vi một thôn
          </p>
          <h2
            id="dashboard-insights-title"
            className="mt-1 text-lg font-bold text-slate-900"
          >
            Diễn biến của {scopedVillageName} qua các kỳ
          </h2>
        </div>
        <p className="max-w-xl text-xs leading-relaxed text-slate-500">
          Chỉ dùng báo cáo đã duyệt hoặc đã khóa; dữ liệu thiếu được để trống.
        </p>
      </div>

      <dl
        className="decision-summary-ribbon"
        aria-label="Các tín hiệu theo dõi của thôn"
      >
        <div>
          <dt>Kỳ có căn cứ</dt>
          <dd>{trend.length ? `${trend.length} kỳ` : "—"}</dd>
          <dd className="decision-summary-note">Tối đa sáu kỳ gần nhất</dd>
        </div>
        <div>
          <dt>BHYT kỳ gần nhất</dt>
          <dd>{percent(latest?.bhytRate ?? null)}</dd>
          <dd className="decision-summary-note">
            {changeLabel(latest?.bhytRate ?? null, previous?.bhytRate)}
          </dd>
        </div>
        <div>
          <dt>An sinh kỳ gần nhất</dt>
          <dd>
            {finite(latest?.welfareHouseholds)
              ? `${latest.welfareHouseholds} hộ`
              : "—"}
          </dd>
          <dd className="decision-summary-note">
            {changeLabel(latest?.welfareRate ?? null, previous?.welfareRate)}
          </dd>
        </div>
      </dl>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <article className="decision-chart-card min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs md:p-5 xl:col-span-5">
          <ChartHeader
            icon={LayoutGrid}
            eyebrow="Kỳ đang chọn"
            title={currentPeriodLabel || "Chưa có báo cáo đã duyệt trong kỳ"}
            description="Các tỷ lệ được tính trực tiếp từ báo cáo của thôn, không so sánh hoặc xếp hạng với đơn vị khác."
          />
          {currentMetrics.length ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {currentMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  <dt className="text-xs font-semibold text-slate-600">
                    {metric.label}
                  </dt>
                  <dd className="mt-1 text-lg font-black text-slate-900">
                    {metric.value}
                  </dd>
                  <dd className="mt-1 text-xs text-slate-500">{metric.note}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyChart />
          )}
        </article>

        <article className="decision-chart-card min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-2xs md:p-5 xl:col-span-7">
          <ChartHeader
            icon={Activity}
            eyebrow="Xu hướng qua các kỳ"
            title={
              trend.length > 1
                ? `${trend.length} kỳ gần nhất để đối chiếu biến động`
                : "Cần ít nhất hai kỳ để xác định biến động"
            }
            description="Mỗi hàng là một kỳ báo cáo; thay đổi được trình bày theo thời gian, không suy diễn thành quan hệ nhân quả."
          />
          {trend.length ? (
            <div
              className="table-scroll-region mt-4 overflow-x-auto focus-visible:ring-2 focus-visible:ring-emerald-700"
              role="region"
              tabIndex={0}
              aria-label="Bảng xu hướng theo kỳ; có thể cuộn ngang trên màn hình nhỏ"
            >
              <p className="mb-2 text-xs font-semibold text-slate-500 sm:hidden">
                Vuốt ngang để xem đủ các chỉ tiêu.
              </p>
              <table
                className="w-full min-w-[42rem] text-sm"
                aria-label={`Xu hướng chỉ tiêu của ${scopedVillageName}`}
              >
                <caption className="sr-only">
                  Xu hướng các chỉ tiêu của {scopedVillageName} qua từng kỳ báo
                  cáo
                </caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th scope="col" className="pb-2 pr-3 font-semibold">
                      Kỳ báo cáo
                    </th>
                    <th
                      scope="col"
                      className="px-2 pb-2 text-right font-semibold"
                    >
                      BHYT
                    </th>
                    <th
                      scope="col"
                      className="px-2 pb-2 text-right font-semibold"
                    >
                      Hộ nghèo + cận nghèo
                    </th>
                    <th
                      scope="col"
                      className="px-2 pb-2 text-right font-semibold"
                    >
                      Gia đình văn hóa
                    </th>
                    <th
                      scope="col"
                      className="pl-2 pb-2 text-right font-semibold"
                    >
                      Hướng dẫn/1.000 dân
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((point) => (
                    <tr
                      key={point.periodKey}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <th
                        scope="row"
                        className="max-w-48 py-3 pr-3 text-left font-semibold text-slate-700"
                        title={point.periodLabel}
                      >
                        {point.periodLabel}
                      </th>
                      <td className="px-2 py-3 text-right text-slate-700">
                        {percent(point.bhytRate)}
                      </td>
                      <td className="px-2 py-3 text-right text-slate-700">
                        {finite(point.welfareHouseholds)
                          ? `${point.welfareHouseholds} hộ (${percent(point.welfareRate)})`
                          : "—"}
                      </td>
                      <td className="px-2 py-3 text-right text-slate-700">
                        {percent(point.cultureRate)}
                      </td>
                      <td className="pl-2 py-3 text-right text-slate-700">
                        {finite(point.guidedPerThousand)
                          ? point.guidedPerThousand.toFixed(0)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyChart />
          )}
        </article>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Nguồn: báo cáo đã duyệt hoặc đã khóa thuộc đúng phạm vi thôn đang chọn.
        Các mức tham chiếu chỉ hỗ trợ rà soát; cán bộ cần đối chiếu báo cáo nguồn
        trước khi quyết định.
      </p>
    </section>
  );
}

export default function DashboardInsightCharts({
  reports,
  historicalReports = reports,
  reportPeriods = [],
  villageName,
  singleVillage = false,
  selectedPeriodLabel,
}: {
  reports: ReportData[];
  historicalReports?: ReportData[];
  reportPeriods?: ReportPeriod[];
  villageName: (id: string) => string;
  singleVillage?: boolean;
  selectedPeriodLabel?: string;
}) {
  if (singleVillage) {
    return (
      <SingleVillageInsights
        reports={reports}
        historicalReports={historicalReports}
        reportPeriods={reportPeriods}
        selectedPeriodLabel={selectedPeriodLabel}
        villageName={villageName}
      />
    );
  }

  const villages = buildDecisionVillages(reports, villageName);
  const digitalMax = Math.max(0, ...villages.map((item) => item.guidedPerThousand ?? 0));
  const heatRows = [...villages].sort((left, right) => {
    const attention = (item: DecisionVillage) =>
      [heatRisk("bhyt", item.bhytRate, digitalMax), heatRisk("welfare", item.welfareRate, digitalMax), heatRisk("culture", item.cultureRate, digitalMax), heatRisk("digital", item.guidedPerThousand, digitalMax)].filter(
        (band) => band === "high",
      ).length;
    return attention(right) - attention(left) || left.label.localeCompare(right.label, "vi");
  });
  const highAttentionVillages = heatRows.filter(
    (item) =>
      [heatRisk("bhyt", item.bhytRate, digitalMax), heatRisk("welfare", item.welfareRate, digitalMax), heatRisk("culture", item.cultureRate, digitalMax), heatRisk("digital", item.guidedPerThousand, digitalMax)].filter(
        (band) => band === "high",
      ).length >= 2,
  ).length;

  const bhytRows = villages.filter((item) => finite(item.bhytRate)).sort((left, right) => (left.bhytRate ?? 0) - (right.bhytRate ?? 0));
  const belowBhytTarget = bhytRows.filter((item) => (item.bhytRate ?? 0) < 95).length;

  const welfareRows = villages
    .filter((item) => finite(item.poor) && finite(item.nearPoor))
    .map((item) => ({
      ...item,
      affected: (item.poor ?? 0) + (item.nearPoor ?? 0),
    }))
    .sort((left, right) => right.affected - left.affected);
  const welfareTotal = welfareRows.reduce((sum, item) => sum + item.affected, 0);
  let runningWelfare = 0;
  const paretoRows = welfareRows.map((item) => {
    runningWelfare += item.affected;
    return {
      ...item,
      cumulative: welfareTotal > 0 ? (runningWelfare * 100) / welfareTotal : 0,
    };
  });
  const paretoCutoff = welfareTotal > 0 ? Math.max(1, paretoRows.findIndex((item) => item.cumulative >= 80) + 1) : 0;

  const scatterRows = villages.filter((item) => finite(item.population) && finite(item.guidedPerThousand));
  const scatterLeader = [...scatterRows].sort((left, right) => (right.guidedPerThousand ?? 0) - (left.guidedPerThousand ?? 0))[0];
  const minPopulation = scatterRows.length
    ? Math.min(...scatterRows.map((item) => item.population ?? 0))
    : 0;
  const maxPopulation = Math.max(1, ...scatterRows.map((item) => item.population ?? 0));
  const populationRange = Math.max(1, maxPopulation - minPopulation);
  const minGuidedRate = scatterRows.length
    ? Math.min(...scatterRows.map((item) => item.guidedPerThousand ?? 0))
    : 0;
  const maxGuidedRate = Math.max(1, ...scatterRows.map((item) => item.guidedPerThousand ?? 0));
  const guidedRateRange = Math.max(1, maxGuidedRate - minGuidedRate);
  const maxDigitalTeam = Math.max(1, ...scatterRows.map((item) => item.digitalTeam ?? 0));

  const childrenRows = villages.filter((item) => finite(item.specialChildrenRate)).sort((left, right) => (right.specialChildrenRate ?? 0) - (left.specialChildrenRate ?? 0));
  const childrenLeader = childrenRows[0];

  const chartCard = "decision-chart-card min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-2xs md:p-5";

  return (
    <section aria-labelledby="dashboard-insights-title" className="decision-dashboard space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">Bức tranh điều hành theo thôn</p>
          <h2 id="dashboard-insights-title" className="mt-1 text-lg font-bold text-slate-900">
            Năm góc nhìn để xác định ưu tiên và phân bổ nguồn lực
          </h2>
        </div>
        <p className="max-w-xl text-xs leading-relaxed text-slate-500">Chỉ dùng báo cáo đã duyệt hoặc đã khóa trong phạm vi đang chọn; dữ liệu thiếu được để trống.</p>
      </div>

      <dl className="decision-summary-ribbon" aria-label="Các tín hiệu điều hành nổi bật">
        <div>
          <dt>Phạm vi có căn cứ</dt>
          <dd>{villages.length} thôn</dd>
          <dd className="decision-summary-note">
            Báo cáo đã duyệt hoặc đã khóa
          </dd>
        </div>
        <div>
          <dt>Khoảng trống BHYT</dt>
          <dd>{bhytRows.length ? `${belowBhytTarget} thôn` : "—"}</dd>
          <dd className="decision-summary-note">
            Đối chiếu mức tham chiếu 95%
          </dd>
        </div>
        <div>
          <dt>Tập trung an sinh</dt>
          <dd>{paretoCutoff ? `${paretoCutoff} thôn` : "—"}</dd>
          <dd className="decision-summary-note">
            Đạt khoảng 80% số hộ cần quan tâm
          </dd>
        </div>
      </dl>

      <div className="decision-chart-grid grid items-start gap-4 xl:grid-cols-12">
        <article className={`${chartCard} xl:col-span-7`}>
          <ChartHeader
            icon={LayoutGrid}
            eyebrow="Bản đồ ưu tiên"
            title={heatRows.length ? (highAttentionVillages ? `${highAttentionVillages} thôn cùng có từ hai nội dung cần chú ý cao` : "Chưa có thôn đồng thời nổi lên ở nhiều nội dung") : "Chưa đủ dữ liệu để lập bản đồ ưu tiên"}
            description="Mỗi ô giữ nguyên giá trị nghiệp vụ; màu chỉ giúp quét nhanh mức cần chú ý, không phải điểm xếp hạng tổng hợp."
          />
          {heatRows.length ? (
            <div
              className="table-scroll-region mt-4 overflow-x-auto focus-visible:ring-2 focus-visible:ring-emerald-700"
              role="region"
              tabIndex={0}
              aria-label="Bản đồ nhiệt mức cần chú ý; có thể cuộn ngang trên màn hình nhỏ"
            >
              <p className="mb-2 text-2xs font-semibold text-slate-500 sm:hidden">
                Vuốt ngang để xem đủ bốn nội dung.
              </p>
              <table className="w-full min-w-[42rem] table-fixed text-xs" aria-label="Bản đồ nhiệt mức cần chú ý theo thôn">
                <caption className="sr-only">
                  Mức cần chú ý theo từng chỉ tiêu và từng thôn
                </caption>
                <thead>
                  <tr className="text-left text-slate-500">
                    <th scope="col" className="w-36 pb-2 font-semibold">Thôn</th>
                    <th scope="col" className="px-1 pb-2 text-center font-semibold">BHYT</th>
                    <th scope="col" className="px-1 pb-2 text-center font-semibold">Hộ nghèo + cận nghèo</th>
                    <th scope="col" className="px-1 pb-2 text-center font-semibold">Gia đình văn hóa</th>
                    <th scope="col" className="px-1 pb-2 text-center font-semibold">Hướng dẫn DV công</th>
                  </tr>
                </thead>
                <tbody>
                  {heatRows.map((item) => {
                    const cells = [
                      {
                        key: "bhyt",
                        value: item.bhytRate,
                        label: percent(item.bhytRate),
                        metric: "bhyt" as const,
                      },
                      {
                        key: "welfare",
                        value: item.welfareRate,
                        label: percent(item.welfareRate),
                        metric: "welfare" as const,
                      },
                      {
                        key: "culture",
                        value: item.cultureRate,
                        label: percent(item.cultureRate),
                        metric: "culture" as const,
                      },
                      {
                        key: "digital",
                        value: item.guidedPerThousand,
                        label: finite(item.guidedPerThousand) ? `${item.guidedPerThousand.toFixed(0)}/1.000` : "—",
                        metric: "digital" as const,
                      },
                    ];
                    return (
                      <tr key={item.id}>
                        <th scope="row" className="break-words py-1.5 pr-3 text-left font-semibold leading-snug text-slate-700" title={item.label}>
                          {item.label}
                        </th>
                        {cells.map((cell) => {
                          const band = heatRisk(cell.metric, cell.value, digitalMax);
                          return (
                            <td key={cell.key} className="p-1">
                              <span className={`block rounded-md px-2 py-2 text-center font-bold ${riskClass[band]}`}>
                                <span className="block">{cell.label}</span>
                                <span className="mt-0.5 block text-3xs font-semibold">
                                  Mức {riskLabel[band]}
                                </span>
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-2xs leading-relaxed text-slate-500">Ngưỡng tham chiếu: BHYT 95%; hộ nghèo + cận nghèo 5%/10%; gia đình văn hóa 90%/80%. Dịch vụ công được so sánh tương đối trong kỳ vì chưa có ngưỡng chính thức.</p>
            </div>
          ) : (
            <EmptyChart />
          )}
        </article>

        <article className={`${chartCard} xl:col-span-5`}>
          <ChartHeader
            icon={Scale}
            eyebrow="Tập trung nguồn lực an sinh"
            title={paretoRows.length && welfareTotal > 0 ? `${paretoCutoff} thôn đầu chiếm khoảng ${paretoRows[paretoCutoff - 1]?.cumulative.toFixed(0)}% số hộ cần quan tâm` : "Chưa ghi nhận đủ dữ liệu hộ nghèo và cận nghèo"}
            description="Pareto cho biết nơi tập trung nhiều hộ cần hỗ trợ, không thay thế danh sách nghiệp vụ từng hộ."
          />
          {paretoRows.length && welfareTotal > 0 ? (
            <div className="mt-4">
              <div
                role="img"
                aria-label="Biểu đồ Pareto hộ nghèo và cận nghèo theo thôn"
              >
                <svg viewBox="0 0 440 245" className="h-60 w-full overflow-visible">
                  {[0, 25, 50, 75, 100].map((tick) => {
                    const y = 190 - tick * 1.5;
                    return (
                      <g key={tick}>
                        <line x1="35" x2="420" y1={y} y2={y} stroke="#e2e8f0" />
                        <text x="28" y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                          {tick}%
                        </text>
                      </g>
                    );
                  })}
                  {paretoRows.map((item, index) => {
                    const slot = 365 / Math.max(1, paretoRows.length);
                    const barWidth = Math.max(8, slot * 0.55);
                    const share = (item.affected * 100) / welfareTotal;
                    const x = 45 + index * slot;
                    return (
                      <g key={item.id}>
                        <rect x={x} y={190 - share * 1.5} width={barWidth} height={share * 1.5} rx="2" fill={index < paretoCutoff ? "#b45309" : "#94a3b8"}>
                          <title>{`${item.label}: ${item.affected} hộ (${share.toFixed(1)}%)`}</title>
                        </rect>
                      </g>
                    );
                  })}
                  <polyline
                    fill="none"
                    stroke="#0f766e"
                    strokeWidth="2.5"
                    points={paretoRows
                      .map((item, index) => {
                        const slot = 365 / Math.max(1, paretoRows.length);
                        return `${45 + index * slot + Math.max(8, slot * 0.55) / 2},${190 - item.cumulative * 1.5}`;
                      })
                      .join(" ")}
                  />
                  {paretoRows.map((item, index) => {
                    const slot = 365 / Math.max(1, paretoRows.length);
                    return (
                      <circle key={item.id} cx={45 + index * slot + Math.max(8, slot * 0.55) / 2} cy={190 - item.cumulative * 1.5} r="2.5" fill="#0f766e">
                        <title>{`Lũy kế ${item.cumulative.toFixed(1)}%`}</title>
                      </circle>
                    );
                  })}
                </svg>
              </div>
              <ul
                className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3"
                aria-label="Số hộ cần quan tâm theo từng thôn"
              >
                {paretoRows.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex min-w-0 items-center gap-2 text-xs text-slate-700"
                  >
                    <i
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 shrink-0 rounded-sm ${
                        index < paretoCutoff
                          ? "bg-amber-700"
                          : "bg-slate-400"
                      }`}
                    />
                    <span className="min-w-0 break-words" title={item.label}>
                      {item.label}: <b>{item.affected} hộ</b>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-4 text-2xs text-slate-600">
                <span>
                  <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-700" />
                  Số hộ theo thôn
                </span>
                <span>
                  <i className="mr-1 inline-block h-0.5 w-4 align-middle bg-teal-700" />
                  Tỷ lệ lũy kế
                </span>
              </div>
            </div>
          ) : (
            <EmptyChart />
          )}
        </article>

        <article className={`${chartCard} xl:col-span-6`}>
          <ChartHeader
            icon={HeartPulse}
            eyebrow="Y tế"
            title={bhytRows.length ? (belowBhytTarget ? `${belowBhytTarget} thôn chưa đạt mức tham gia BHYT 95%` : "Tất cả thôn có dữ liệu đều đạt mức BHYT 95%") : "Chưa đủ dữ liệu để đối chiếu BHYT"}
            description="Bullet graph đối chiếu từng thôn với mức tham chiếu 95%; ưu tiên thôn có khoảng cách lớn nhất."
          />
          {bhytRows.length ? (
            <div className="mt-4">
              <div className="space-y-2.5" role="img" aria-label="Biểu đồ bullet tỷ lệ BHYT theo thôn, mức tham chiếu 95 phần trăm">
                {bhytRows.map((item) => (
                  <div key={item.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
                    <span className="truncate font-semibold text-slate-700" title={item.label}>
                      {item.label}
                    </span>
                    <span className="relative h-3 rounded-sm bg-slate-100">
                      <span className={`absolute inset-y-0 left-0 rounded-sm ${(item.bhytRate ?? 0) < 95 ? "bg-amber-500" : "bg-emerald-700"}`} style={{ width: `${Math.min(100, item.bhytRate ?? 0)}%` }} />
                      <span className="absolute -inset-y-1 w-0.5 bg-slate-900" style={{ left: "95%" }} />
                    </span>
                    <strong className="text-right text-slate-700">{percent(item.bhytRate, 2)}</strong>
                  </div>
                ))}
              </div>
              <ul className="sr-only" aria-label="Dữ liệu tỷ lệ BHYT theo từng thôn">
                {bhytRows.map((item) => (
                  <li key={item.id}>
                    {item.label}: {percent(item.bhytRate, 2)}
                  </li>
                ))}
              </ul>
              <p className="pt-1 text-2xs text-slate-500">Vạch đen: mức tham chiếu 95%.</p>
            </div>
          ) : (
            <EmptyChart />
          )}
        </article>

        <article className={`${chartCard} xl:col-span-6`}>
          <ChartHeader
            icon={Activity}
            eyebrow="Dịch vụ công"
            title={scatterLeader ? `${scatterLeader.label} có cường độ hướng dẫn cao nhất: ${scatterLeader.guidedPerThousand?.toFixed(0)} lượt/1.000 dân` : "Chưa đủ dữ liệu để so sánh cường độ hướng dẫn"}
            description="Vị trí thể hiện quy mô dân số và số lượt hướng dẫn/1.000 dân; kích thước điểm thể hiện số thành viên tổ công nghệ số."
          />
          {scatterRows.length ? (
            <div className="mt-3">
              <div role="img" aria-label="Biểu đồ phân tán quy mô dân số và số lượt hướng dẫn dịch vụ công trên một nghìn dân">
                <svg viewBox="0 0 440 245" className="h-60 w-full">
                {[0, 0.5, 1].map((tick) => {
                  const y = 200 - tick * 160;
                  const label = minGuidedRate + guidedRateRange * tick;
                  return (
                    <g key={tick}>
                      <line x1="48" x2="420" y1={y} y2={y} stroke="#e2e8f0" />
                      <text x="42" y={y + 3} textAnchor="end" className="fill-slate-500 text-[11px]">
                        {label.toFixed(0)}
                      </text>
                    </g>
                  );
                })}
                <line x1="45" x2="45" y1="30" y2="200" stroke="#94a3b8" />
                <line x1="45" x2="420" y1="200" y2="200" stroke="#94a3b8" />
                {scatterRows.map((item) => {
                  const x = 55 + (((item.population ?? 0) - minPopulation) / populationRange) * 350;
                  const y = 195 - (((item.guidedPerThousand ?? 0) - minGuidedRate) / guidedRateRange) * 150;
                  const radius = 4 + ((item.digitalTeam ?? 0) / maxDigitalTeam) * 5;
                  return (
                    <g key={item.id}>
                      <circle cx={x} cy={y} r={radius} fill={item.id === scatterLeader?.id ? "#b45309" : "#047857"} fillOpacity="0.78" stroke="white" strokeWidth="1.5">
                        <title>{`${item.label}: ${item.population?.toLocaleString("vi-VN")} dân; ${item.guidedPerThousand?.toFixed(0)} lượt/1.000 dân; ${item.digitalTeam ?? "—"} thành viên`}</title>
                      </circle>
                      {item.id === scatterLeader?.id && (
                        <text x={Math.min(390, x + 8)} y={Math.max(22, y - 8)} className="fill-amber-800 text-[11px] font-bold">
                          {item.label}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x="55" y="216" textAnchor="start" className="fill-slate-500 text-[11px]">
                  {minPopulation.toLocaleString("vi-VN")}
                </text>
                <text x="405" y="216" textAnchor="end" className="fill-slate-500 text-[11px]">
                  {maxPopulation.toLocaleString("vi-VN")}
                </text>
                <text x="232" y="232" textAnchor="middle" className="fill-slate-600 text-[11px]">
                  Quy mô dân số →
                </text>
                <text x="12" y="120" transform="rotate(-90 12 120)" textAnchor="middle" className="fill-slate-600 text-[11px]">
                  Lượt hướng dẫn/1.000 dân →
                </text>
                </svg>
              </div>
              <ul className="sr-only" aria-label="Dữ liệu hướng dẫn dịch vụ công theo từng thôn">
                {scatterRows.map((item) => (
                  <li key={item.id}>
                    {item.label}: {item.population?.toLocaleString("vi-VN")} dân;{" "}
                    {item.guidedPerThousand?.toFixed(0)} lượt hướng dẫn trên 1.000
                    dân; {item.digitalTeam ?? "chưa có dữ liệu"} thành viên tổ
                    công nghệ số
                  </li>
                ))}
              </ul>
              <p className="text-2xs leading-relaxed text-slate-500">Biểu đồ giúp phát hiện khác biệt theo quy mô; mối liên hệ quan sát được không đồng nghĩa quan hệ nhân quả.</p>
            </div>
          ) : (
            <EmptyChart />
          )}
        </article>

        <article className={`${chartCard} xl:col-span-12`}>
          <ChartHeader
            icon={Baby}
            eyebrow="Trẻ em cần quan tâm"
            title={childrenLeader ? `${childrenLeader.label} có tỷ trọng trẻ em hoàn cảnh đặc biệt cao nhất: ${percent(childrenLeader.specialChildrenRate)}` : "Chưa đủ dữ liệu về trẻ em có hoàn cảnh đặc biệt"}
            description="Cơ cấu 100% so sánh tỷ trọng trong tổng số trẻ em; số tuyệt đối được ghi bên phải để tránh hiểu sai do quy mô thôn."
          />
          {childrenRows.length ? (
            <div className="mt-4">
              <div className="grid gap-x-6 gap-y-2.5 md:grid-cols-2" role="img" aria-label="Biểu đồ cơ cấu một trăm phần trăm trẻ em hoàn cảnh đặc biệt theo thôn">
                {childrenRows.map((item) => (
                  <div key={item.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-xs">
                    <span className="truncate font-semibold text-slate-700" title={item.label}>
                      {item.label}
                    </span>
                    <span className="flex h-3 overflow-hidden rounded-sm bg-emerald-100">
                      <span
                        className="bg-rose-600"
                        style={{
                          width: `${Math.min(100, item.specialChildrenRate ?? 0)}%`,
                        }}
                      />
                    </span>
                    <strong className="text-right text-slate-700">
                      {item.specialChildren ?? 0}/{item.children ?? 0} trẻ
                    </strong>
                  </div>
                ))}
                <div className="md:col-span-2 flex gap-4 pt-1 text-2xs text-slate-500">
                  <span>
                    <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-600" />
                    Hoàn cảnh đặc biệt
                  </span>
                  <span>
                    <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-100" />
                    Nhóm còn lại
                  </span>
                </div>
              </div>
              <ul className="sr-only" aria-label="Dữ liệu trẻ em hoàn cảnh đặc biệt theo từng thôn">
                {childrenRows.map((item) => (
                  <li key={item.id}>
                    {item.label}: {item.specialChildren ?? 0} trên{" "}
                    {item.children ?? 0} trẻ, tương ứng{" "}
                    {percent(item.specialChildrenRate)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyChart />
          )}
        </article>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">Nguồn: báo cáo đã duyệt/đã khóa trong kỳ, thôn và quyền truy cập đang chọn. Các ngưỡng chỉ nhằm hỗ trợ rà soát; quyết định cần mở báo cáo nguồn và căn cứ nghiệp vụ liên quan.</p>
    </section>
  );
}
