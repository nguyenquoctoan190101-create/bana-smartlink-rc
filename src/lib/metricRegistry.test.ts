import { describe, expect, it } from "vitest";
import {
  evaluateMetric,
  evaluateMetrics,
  isMetricEvaluationReport,
  metricRegistry,
  MetricRegistryError,
  parseMetricRegistry,
  type MetricEvaluationReport,
  type MetricEvaluationContext,
  type MetricEvaluationResult,
} from "./metricRegistry";
import type { IndicatorCode, WorkflowStatus } from "../types";
import metricCasesFixture from "../../tests/fixtures/metric_cases.json";

const report = (
  id: string,
  villageId: string,
  values: Partial<Record<IndicatorCode, number | null>>,
  options: {
    periodId?: string;
    workflowStatus?: WorkflowStatus;
    version?: number;
  } = {},
): MetricEvaluationReport => ({
  report_id: id,
  village_id: villageId,
  period_id: options.periodId ?? "period-2026-07",
  workflow_status: options.workflowStatus ?? "approved",
  version: options.version ?? 1,
  values,
});

const context = (expectedVillageIds: string[] = ["village-a", "village-b"]) => ({
  period_id: "period-2026-07",
  scope: "commune:ba-na",
  expected_village_ids: expectedVillageIds,
});

describe("metric registry runtime contract", () => {
  it("loads the bundled exact schema and the fixed public raw allowlist", () => {
    expect(metricRegistry.schema_version).toBe(1);
    expect(metricRegistry.registry_version).not.toBe("");
    expect(metricRegistry.public_raw_metric_ids).toEqual(["CT01", "CT02", "CT09", "CT12", "CT13"]);
    expect(new Set(metricRegistry.metrics.map((metric) => metric.metric_id)).size).toBe(metricRegistry.metrics.length);
  });

  it("rejects unknown registry keys instead of silently widening the contract", () => {
    expect(() => parseMetricRegistry({
      ...structuredClone(metricRegistry),
      undocumented_policy: true,
    })).toThrow(/thừa undocumented_policy/);
  });

  it("rejects formula strings so metric expressions cannot be evaluated as code", () => {
    const clone = structuredClone(metricRegistry) as unknown as {
      metrics: Array<Record<string, unknown>>;
    };
    clone.metrics[0].numerator = "CT01 + CT02";
    expect(() => parseMetricRegistry(clone)).toThrow(MetricRegistryError);
  });

  it("rejects target metadata unless the whole governance bundle is present", () => {
    const clone = structuredClone(metricRegistry) as unknown as {
      metrics: Array<Record<string, unknown>>;
    };
    clone.metrics[0].target_source = "Một văn bản chưa có target";
    expect(() => parseMetricRegistry(clone)).toThrow(/metadata mục tiêu/);
  });

  it("does not permit a governed target with neutral direction", () => {
    const clone = structuredClone(metricRegistry) as unknown as {
      metrics: Array<Record<string, unknown>>;
    };
    Object.assign(clone.metrics[0], {
      target: 95,
      target_source: "Quyết định đã phê duyệt",
      owner: "Cơ quan có thẩm quyền",
      effective_from: "2026-07-01",
      tolerance: 0.1,
      target_scope: "commune",
      rounding_rule: { decimals: 1, mode: "half_up" },
    });
    expect(() => parseMetricRegistry(clone)).toThrow(/hướng higher hoặc lower/);
  });

  it("rejects a derived metric that tries to cross the public raw boundary", () => {
    const clone = structuredClone(metricRegistry) as unknown as {
      metrics: Array<Record<string, unknown>>;
    };
    const derived = clone.metrics.find(
      (metric) => metric.metric_id === "health_insurance_rate",
    )!;
    derived.public = true;
    derived.roles = [...derived.roles as string[], "dan"];

    expect(() => parseMetricRegistry(clone)).toThrow(
      /allowlist raw cố định/,
    );
  });
});

describe("evaluateMetric", () => {
  it("returns a typed missing-metric result instead of inventing a definition", () => {
    expect(evaluateMetric(
      "unknown_metric",
      [report("r-a", "village-a", { CT01: 10 })],
      context(["village-a"]),
    )).toMatchObject({
      metric_id: "unknown_metric",
      value: null,
      unit: null,
      reason: "metric_not_found",
      scope: "commune:ba-na",
    });
  });

  it("uses only approved/locked reports and calculates a ratio of sums", () => {
    const result = evaluateMetric("health_insurance_rate", [
      report("r-a", "village-a", { CT02: 100, CT11: 90 }, { workflowStatus: "approved", version: 4 }),
      report("r-b", "village-b", { CT02: 2, CT11: 1 }, { workflowStatus: "locked", version: 7 }),
      report("r-draft", "village-draft", { CT02: 1, CT11: 1 }, { workflowStatus: "draft", version: 99 }),
    ], context());

    expect(result).toMatchObject({
      value: (91 / 102) * 100,
      numerator: 91,
      denominator: 102,
      included_count: 2,
      expected_count: 2,
      missing_count: 0,
      coverage_status: "complete",
      reason: null,
      period_id: "period-2026-07",
    });
    expect(result.value).not.toBe(((90 / 100) * 100 + (1 / 2) * 100) / 2);
    expect(result.source_report_versions).toEqual([
      { report_id: "r-a", village_id: "village-a", version: 4, workflow_status: "approved" },
      { report_id: "r-b", village_id: "village-b", version: 7, workflow_status: "locked" },
    ]);
  });

  it("keeps a real zero distinct from missing data", () => {
    const zero = evaluateMetric(
      "guided_people_count",
      [report("r-zero", "village-a", { CT13: 0 })],
      context(["village-a"]),
    );
    const missing = evaluateMetric(
      "guided_people_count",
      [report("r-missing", "village-a", { CT13: null })],
      context(["village-a"]),
    );

    expect(zero).toMatchObject({ value: 0, numerator: 0, reason: null });
    expect(missing).toMatchObject({
      value: null,
      numerator: null,
      coverage_status: "partial",
      reason: "partial_coverage",
    });
  });

  it("does not calculate a ratio when the denominator is zero", () => {
    expect(evaluateMetric(
      "poverty_household_rate",
      [report("r-zero-denominator", "village-a", { CT01: 0, CT03: 0 })],
      context(["village-a"]),
    )).toMatchObject({
      value: null,
      numerator: 0,
      denominator: 0,
      reason: "zero_denominator",
    });
  });

  it("rejects negative indicator values instead of using them in an aggregate", () => {
    expect(evaluateMetric(
      "guided_people_count",
      [report("r-negative", "village-a", { CT13: -1 })],
      context(["village-a"]),
    )).toMatchObject({ value: null, reason: "invalid_value" });
  });

  it("calculates an available partial slice but exposes coverage and reason", () => {
    expect(evaluateMetric(
      "poverty_household_rate",
      [report("r-a", "village-a", { CT01: 50, CT03: 5 })],
      context(["village-a", "village-b"]),
    )).toMatchObject({
      value: 10,
      included_count: 1,
      expected_count: 2,
      missing_count: 1,
      coverage_status: "partial",
      reason: "partial_coverage",
    });
  });

  it("fails closed for mixed periods", () => {
    expect(evaluateMetric("guided_people_count", [
      report("r-a", "village-a", { CT13: 3 }),
      report("r-b", "village-b", { CT13: 4 }, { periodId: "period-2026-06" }),
    ], context())).toMatchObject({ value: null, reason: "period_mismatch" });
  });

  it("fails closed for more than one final report in a village-period grain", () => {
    expect(evaluateMetric("guided_people_count", [
      report("r-a-v1", "village-a", { CT13: 3 }, { workflowStatus: "approved", version: 1 }),
      report("r-a-v2", "village-a", { CT13: 4 }, { workflowStatus: "locked", version: 2 }),
    ], context(["village-a"]))).toMatchObject({
      value: null,
      included_count: 2,
      reason: "duplicate_village_period",
    });
  });

  it("fails closed when a final report is outside the declared village scope", () => {
    expect(evaluateMetric(
      "guided_people_count",
      [report("r-outside", "village-outside", { CT13: 3 })],
      context(["village-a"]),
    )).toMatchObject({ value: null, reason: "scope_mismatch" });
  });

  it("refuses non-aggregatable case-workflow metrics", () => {
    expect(evaluateMetric(
      "CT14",
      [report("r-a", "village-a", { CT14: 1 })],
      context(["village-a"]),
    )).toMatchObject({ value: null, reason: "aggregation_not_supported" });
  });

  it("returns invalid_context for duplicate expected villages", () => {
    expect(evaluateMetric(
      "CT01",
      [report("r-a", "village-a", { CT01: 10 })],
      context(["village-a", "village-a"]),
    )).toMatchObject({ value: null, reason: "invalid_context" });
  });

  it("returns invalid_report for broken provenance instead of fabricating a version", () => {
    const invalid = { ...report("r-a", "village-a", { CT01: 10 }), version: 0 };
    expect(evaluateMetric(
      "CT01",
      [invalid] as MetricEvaluationReport[],
      context(["village-a"]),
    )).toMatchObject({
      value: null,
      included_count: 0,
      coverage_status: "unavailable",
      reason: "invalid_report",
      source_report_versions: [],
    });
  });

  it("refuses registry metrics that are not approved", () => {
    expect(evaluateMetric(
      "vulnerable_children_rate",
      [report("r-a", "village-a", { CT07: 20, CT08: 2 })],
      context(["village-a"]),
    )).toMatchObject({ value: null, reason: "metric_not_approved" });
  });

  it("reports no eligible data when the slice contains only drafts", () => {
    expect(evaluateMetric(
      "guided_people_count",
      [report("r-draft", "village-a", { CT13: 8 }, { workflowStatus: "draft" })],
      context(["village-a"]),
    )).toMatchObject({
      value: null,
      included_count: 0,
      expected_count: 1,
      missing_count: 1,
      coverage_status: "unavailable",
      reason: "no_eligible_reports",
      source_report_versions: [],
    });
  });
});

describe("evaluateMetrics", () => {
  it("matches independent evaluation while preparing shared evidence once", () => {
    const reports = [
      report("r-b", "village-b", { CT01: 40, CT02: 120, CT03: 4, CT11: 110 }, { workflowStatus: "locked", version: 2 }),
      report("r-a", "village-a", { CT01: 60, CT02: 180, CT03: 6, CT11: 170 }, { workflowStatus: "approved", version: 3 }),
      report("r-draft", "village-a", { CT01: 999 }, { workflowStatus: "draft" }),
    ];
    const metricIds = [
      "CT01",
      "CT02",
      "poverty_household_rate",
      "health_insurance_rate",
      "CT14",
      "unknown_metric",
    ];

    const batch = evaluateMetrics(metricIds, reports, context());
    for (const metricId of metricIds) {
      expect(batch.get(metricId)).toEqual(
        evaluateMetric(metricId, reports, context()),
      );
    }

    expect(batch.get("CT01")?.source_report_versions).toBe(
      batch.get("health_insurance_rate")?.source_report_versions,
    );
  });

  it("validates each report envelope once for the whole metric batch", () => {
    let envelopeValidationCount = 0;
    const trackedReports = [
      report("r-a", "village-a", { CT01: 60, CT02: 180, CT03: 6 }),
      report("r-b", "village-b", { CT01: 40, CT02: 120, CT03: 4 }),
    ].map(
      (item) =>
        new Proxy(item, {
          ownKeys(target) {
            envelopeValidationCount += 1;
            return Reflect.ownKeys(target);
          },
        }),
    );

    evaluateMetrics(
      ["CT01", "CT02", "CT03", "poverty_household_rate"],
      trackedReports,
      context(),
    );

    expect(envelopeValidationCount).toBe(trackedReports.length);
  });
});

describe("isMetricEvaluationReport", () => {
  it("accepts finite values and preserves null", () => {
    expect(isMetricEvaluationReport(report("r-a", "village-a", { CT01: 0, CT02: null }))).toBe(true);
  });

  it("rejects unknown indicators, non-finite numbers and unknown workflow states", () => {
    expect(isMetricEvaluationReport({ ...report("r-a", "village-a", {}), values: { CT99: 1 } })).toBe(false);
    expect(isMetricEvaluationReport({ ...report("r-a", "village-a", {}), values: { CT01: Number.NaN } })).toBe(false);
    expect(isMetricEvaluationReport({ ...report("r-a", "village-a", {}), workflow_status: "published" })).toBe(false);
  });
});

describe("shared Python/TypeScript parity fixture", () => {
  it.each(metricCasesFixture.cases)(
    "$case_id",
    (metricCase) => {
      const actual = evaluateMetric(
        metricCase.metric_id,
        metricCase.reports as MetricEvaluationReport[],
        metricCase.context as MetricEvaluationContext,
      );

      expect(actual).toEqual(
        metricCase.expected as MetricEvaluationResult,
      );
    },
  );
});
