import type { ReportData, ReportPeriod } from "../types";

const CALENDAR_PERIOD_RE = /^(?:th[aá]ng\s*)?(\d{1,2})\s*\/\s*(\d{4})$/iu;

export function normalizeReportPeriodName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function reportPeriodNameIssue(value: string): string | null {
  const normalized = normalizeReportPeriodName(value);
  if (!normalized) return "Vui lòng nhập tên kỳ báo cáo.";

  const match = normalized.match(CALENDAR_PERIOD_RE);
  if (match) {
    const month = Number(match[1]);
    if (month < 1 || month > 12) {
      return "Tháng của kỳ báo cáo phải từ 1 đến 12.";
    }
  }
  return null;
}

export function decorateReportPeriod(period: ReportPeriod): ReportPeriod {
  if (!reportPeriodNameIssue(period.name)) return period;

  return {
    ...period,
    display_name: `Kỳ cần rà soát: ${period.name}`,
    requires_review: true,
  };
}

/**
 * Leadership opens on the newest period that actually has decision-ready
 * evidence. A newer empty period may still be selected elsewhere, but it must
 * not replace the useful executive picture with a screen full of zeroes.
 */
export function preferredLeadershipPeriodId(
  periods: ReportPeriod[],
  reports: ReportData[],
): string {
  const approvedPeriodIds = new Set(
    reports
      .filter(
        (report) =>
          !report.local_only &&
          Boolean(report.period_id) &&
          ["approved", "locked"].includes(report.workflow_status),
      )
      .map((report) => report.period_id as string),
  );
  const candidates = periods.filter((period) =>
    approvedPeriodIds.has(period.id),
  );
  const source = candidates.length ? candidates : periods;
  return [...source].sort((left, right) =>
    (right.due_date || "").localeCompare(left.due_date || ""),
  )[0]?.id || "";
}
