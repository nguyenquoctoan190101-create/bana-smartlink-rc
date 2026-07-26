import { Activity, HeartPulse, Landmark, type LucideIcon } from "lucide-react";
import type { ReportData } from "../types";

type InsightRow = {
  id: string;
  label: string;
  value: number;
  display: string;
  secondaryValue?: number;
  secondaryDisplay?: string;
  tone?: "good" | "attention";
};

export type DashboardInsight = {
  id: "health" | "welfare" | "digital";
  eyebrow: string;
  title: string;
  description: string;
  rows: InsightRow[];
  max: number;
  icon: LucideIcon;
};

const finite = (value: number | null | undefined): value is number => (
  typeof value === "number" && Number.isFinite(value)
);

const shortVillageName = (name: string) => name.replace(/^Thôn\s+/i, "");

export function buildDashboardInsights(
  reports: ReportData[],
  villageName: (id: string) => string,
): DashboardInsight[] {
  const healthRows: InsightRow[] = reports.flatMap((report) => {
    if (!finite(report.CT02) || report.CT02 <= 0 || !finite(report.CT11)) return [];
    const rate = Math.min(100, Math.max(0, report.CT11 * 100 / report.CT02));
    return [{
      id: report.id,
      label: shortVillageName(villageName(report.village_id)),
      value: rate,
      display: `${rate.toFixed(1)}%`,
      tone: rate >= 95 ? "good" as const : "attention" as const,
    }];
  });
  const healthAttention = healthRows.filter((row) => row.tone === "attention").length;

  const welfareRows: InsightRow[] = reports.flatMap((report) => {
    if (!finite(report.CT03) && !finite(report.CT04)) return [];
    const poor = finite(report.CT03) ? report.CT03 : 0;
    const nearPoor = finite(report.CT04) ? report.CT04 : 0;
    return [{
      id: report.id,
      label: shortVillageName(villageName(report.village_id)),
      value: poor,
      display: `${poor} hộ nghèo`,
      secondaryValue: nearPoor,
      secondaryDisplay: `${nearPoor} hộ cận nghèo`,
      tone: poor + nearPoor > 0 ? "attention" as const : "good" as const,
    }];
  });
  const welfareMax = welfareRows.reduce(
    (current, row) => row.value + (row.secondaryValue ?? 0) > current.value + (current.secondaryValue ?? 0) ? row : current,
    welfareRows[0] ?? { id: "", label: "", value: 0, display: "" },
  );

  const digitalRows: InsightRow[] = reports.flatMap((report) => {
    if (!finite(report.CT13)) return [];
    return [{
      id: report.id,
      label: shortVillageName(villageName(report.village_id)),
      value: report.CT13,
      display: `${report.CT13.toLocaleString("vi-VN")} người`,
    }];
  });
  const digitalMax = digitalRows.reduce(
    (current, row) => row.value > current.value ? row : current,
    digitalRows[0] ?? { id: "", label: "", value: 0, display: "" },
  );

  return [
    {
      id: "health",
      eyebrow: "Y tế",
      title: healthRows.length
        ? healthAttention
          ? `${healthAttention} thôn còn dưới mức tham gia BHYT 95%`
          : "Các thôn đều đạt mức tham gia BHYT từ 95%"
        : "Chưa đủ dữ liệu để đối chiếu tỷ lệ BHYT",
      description: "Tỷ lệ người tham gia BHYT trên tổng nhân khẩu của từng thôn.",
      rows: healthRows,
      max: 100,
      icon: HeartPulse,
    },
    {
      id: "welfare",
      eyebrow: "An sinh",
      title: welfareRows.length
        ? `${welfareMax.label} có nhiều hộ nghèo và cận nghèo nhất`
        : "Chưa đủ dữ liệu để đối chiếu hộ cần quan tâm",
      description: "So sánh số hộ nghèo và cận nghèo; không thay thế danh sách nghiệp vụ.",
      rows: welfareRows,
      max: Math.max(1, ...welfareRows.map((row) => row.value + (row.secondaryValue ?? 0))),
      icon: Landmark,
    },
    {
      id: "digital",
      eyebrow: "Dịch vụ công",
      title: digitalRows.length
        ? `${digitalMax.label} ghi nhận nhiều người được hướng dẫn nhất`
        : "Chưa đủ dữ liệu về hỗ trợ dịch vụ công",
      description: "Số người được hướng dẫn sử dụng dịch vụ công trực tuyến trong kỳ.",
      rows: digitalRows,
      max: Math.max(1, ...digitalRows.map((row) => row.value)),
      icon: Activity,
    },
  ];
}

export default function DashboardInsightCharts({
  reports,
  villageName,
}: {
  reports: ReportData[];
  villageName: (id: string) => string;
}) {
  const insights = buildDashboardInsights(reports, villageName);

  return (
    <section aria-labelledby="dashboard-insights-title" className="space-y-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">Điểm cần chú ý theo thôn</p>
        <h2 id="dashboard-insights-title" className="mt-1 text-lg font-bold text-slate-900">
          Ba góc nhìn giúp xác định nơi cần ưu tiên
        </h2>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {insights.map((insight) => {
          const Icon = insight.icon;
          return (
            <article key={insight.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
              <header className="flex items-start gap-3">
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-3xs font-black uppercase tracking-[0.14em] text-emerald-800">{insight.eyebrow}</p>
                  <h3 className="mt-1 text-sm font-bold leading-snug text-slate-900">{insight.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{insight.description}</p>
                </div>
              </header>

              {insight.rows.length ? (
                <div className="mt-5 space-y-2.5" role="img" aria-label={`${insight.title}. ${insight.description}`}>
                  {insight.rows.map((row) => {
                    const primaryWidth = Math.max(2, Math.min(100, row.value * 100 / insight.max));
                    const secondaryWidth = Math.max(
                      0,
                      Math.min(100 - primaryWidth, (row.secondaryValue ?? 0) * 100 / insight.max),
                    );
                    return (
                      <div key={row.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
                        <span className="truncate font-semibold text-slate-700" title={row.label}>{row.label}</span>
                        <span className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className={row.tone === "attention" ? "bg-amber-500" : "bg-emerald-700"}
                            style={{ width: `${primaryWidth}%` }}
                          />
                          {secondaryWidth > 0 && (
                            <span className="bg-rose-500" style={{ width: `${secondaryWidth}%` }} />
                          )}
                        </span>
                        <span className="text-right font-bold text-slate-700">{row.display}</span>
                        {row.secondaryDisplay && (
                          <span className="col-start-2 col-span-2 -mt-1 text-[10px] text-slate-500">
                            {row.secondaryDisplay}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Chọn kỳ có báo cáo để hiển thị biểu đồ. Dữ liệu thiếu không được quy đổi thành số 0.
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Nguồn: các báo cáo trong kỳ, phạm vi và quyền truy cập đang chọn. Màu chỉ dùng để đánh dấu trạng thái hoặc nội dung cần chú ý.
      </p>
    </section>
  );
}
