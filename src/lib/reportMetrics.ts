import {
  INDICATOR_CODES,
  workflowStatusOf,
  type IndicatorCode,
  type ReportData,
} from "../types";
import type {
  MetricEvaluationReport,
} from "./metricRegistry";

/**
 * Adapt the frontend report view model to the shared metric-evaluation grain.
 *
 * Legacy rows may not carry period_id. Callers must pass the already-resolved
 * selected period identity after filtering those rows to one unambiguous
 * period; this helper never tries to resolve a display name on its own.
 */
export function reportToMetricEvaluationReport(
  report: ReportData,
  resolvedPeriodId: string,
): MetricEvaluationReport {
  const values = Object.fromEntries(
    INDICATOR_CODES.map((code) => [code, report[code]]),
  ) as Record<IndicatorCode, number | null>;

  return {
    report_id: report.id,
    village_id: report.village_id,
    period_id: report.period_id || resolvedPeriodId,
    workflow_status: workflowStatusOf(report),
    version:
      typeof report.version === "number"
      && Number.isInteger(report.version)
      && report.version > 0
        ? report.version
        : 1,
    values,
  };
}
