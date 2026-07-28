import { describe, expect, it } from "vitest";
import type { ReportData } from "../types";
import { reportToMetricEvaluationReport } from "./reportMetrics";

const report = (overrides: Partial<ReportData> = {}): ReportData => ({
  id: "report-1",
  village_id: "village-1",
  reporter_name: "",
  reporter_phone: "",
  report_period: "Tháng 7/2026",
  workflow_status: "approved",
  timeliness_status: "on_time",
  publication_status: "private",
  updated_at: "2026-07-20T00:00:00Z",
  CT01: 100,
  CT02: 400,
  CT03: 5,
  CT04: 6,
  CT05: 1,
  CT06: 2,
  CT07: 80,
  CT08: 1,
  CT09: 90,
  CT10: 250,
  CT11: 360,
  CT12: 5,
  CT13: 20,
  CT14: 0,
  ...overrides,
});

describe("report metric adapter", () => {
  it("preserves an authoritative period id and report version", () => {
    expect(reportToMetricEvaluationReport(
      report({ period_id: "period-real", version: 7 }),
      "period-selected",
    )).toMatchObject({
      report_id: "report-1",
      period_id: "period-real",
      version: 7,
      values: { CT01: 100, CT14: 0 },
    });
  });

  it("uses only the caller-resolved identity for a legacy row", () => {
    expect(reportToMetricEvaluationReport(
      report({ period_id: undefined }),
      "legacy:Tháng 7/2026",
    )).toMatchObject({
      period_id: "legacy:Tháng 7/2026",
      version: 1,
    });
  });
});
