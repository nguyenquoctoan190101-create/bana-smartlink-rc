import rawRegistry from "../../config/metric_registry.json";
import {
  INDICATOR_CODES,
  PUBLIC_INDICATOR_CODES,
  type IndicatorCode,
  type UserRole,
  type WorkflowStatus,
} from "../types";

export type MetricKind = "raw" | "derived";
export type MetricAggregation = "sum" | "ratio_of_sums" | "count" | "none";
export type MetricDirection = "higher" | "lower" | "neutral";
export type MetricStatus = "draft" | "approved" | "retired";
export type MetricUsage = "dashboard" | "case_workflow_only";

export type MetricExpression =
  | { readonly op: "field"; readonly code: IndicatorCode }
  | { readonly op: "add"; readonly args: readonly MetricExpression[] };

export interface MetricDefinition {
  readonly metric_id: string;
  readonly kind: MetricKind;
  readonly label_vi: string;
  readonly description_vi: string;
  readonly unit: string;
  readonly display_unit_vi: string;
  readonly aggregation: MetricAggregation;
  readonly numerator: MetricExpression;
  readonly denominator: MetricExpression | null;
  readonly scale: number;
  readonly direction: MetricDirection;
  readonly target: number | null;
  readonly target_source: string | null;
  readonly owner: string | null;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly tolerance: number | null;
  readonly target_scope: string | null;
  readonly rounding_rule: {
    readonly decimals: number;
    readonly mode: "half_up";
  } | null;
  readonly roles: readonly UserRole[];
  readonly public: boolean;
  readonly suppression_rule: Readonly<Record<string, unknown>> | null;
  readonly comparability_rule: Readonly<Record<string, unknown>> | null;
  readonly freshness_sla: Readonly<Record<string, unknown>> | null;
  readonly source_system: string;
  readonly status: MetricStatus;
  readonly usage: MetricUsage;
  readonly interpretation_limit_vi: string;
}

export interface MetricRegistry {
  readonly schema_version: 1;
  readonly registry_version: string;
  readonly public_raw_metric_ids: readonly string[];
  readonly metrics: readonly MetricDefinition[];
}

export interface MetricEvaluationReport {
  readonly report_id: string;
  readonly village_id: string;
  readonly period_id: string;
  readonly workflow_status: WorkflowStatus;
  readonly version: number;
  readonly values: Readonly<Partial<Record<IndicatorCode, number | null>>>;
}

export interface MetricEvaluationContext {
  readonly period_id: string;
  readonly scope: string;
  readonly expected_village_ids: readonly string[];
}

export type MetricCoverageStatus = "complete" | "partial" | "unavailable";

export type MetricEvaluationReason =
  | "metric_not_found"
  | "metric_not_approved"
  | "aggregation_not_supported"
  | "invalid_context"
  | "invalid_report"
  | "no_eligible_reports"
  | "period_mismatch"
  | "duplicate_village_period"
  | "scope_mismatch"
  | "partial_coverage"
  | "invalid_value"
  | "zero_denominator"
  ;

export interface MetricSourceReportVersion {
  readonly report_id: string;
  readonly village_id: string;
  readonly version: number;
  readonly workflow_status: "approved" | "locked";
}

export interface MetricEvaluationResult {
  readonly metric_id: string;
  readonly value: number | null;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly unit: string | null;
  readonly included_count: number;
  readonly expected_count: number;
  readonly missing_count: number;
  readonly coverage_status: MetricCoverageStatus;
  readonly reason: MetricEvaluationReason | null;
  readonly registry_version: string;
  readonly period_id: string;
  readonly scope: string;
  readonly source_report_versions: readonly MetricSourceReportVersion[];
}

const REGISTRY_KEYS = [
  "schema_version",
  "registry_version",
  "public_raw_metric_ids",
  "metrics",
] as const;

const METRIC_KEYS = [
  "metric_id",
  "kind",
  "label_vi",
  "description_vi",
  "unit",
  "display_unit_vi",
  "aggregation",
  "numerator",
  "denominator",
  "scale",
  "direction",
  "target",
  "target_source",
  "owner",
  "effective_from",
  "effective_to",
  "tolerance",
  "target_scope",
  "rounding_rule",
  "roles",
  "public",
  "suppression_rule",
  "comparability_rule",
  "freshness_sla",
  "source_system",
  "status",
  "usage",
  "interpretation_limit_vi",
] as const;

const USER_ROLES = ["admin_xa", "can_bo_thon", "to_cnscd", "lanh_dao", "dan"] as const;
const WORKFLOW_STATUSES = new Set<WorkflowStatus>(["draft", "submitted", "needs_revision", "approved", "locked"]);
const FINAL_WORKFLOW_STATUSES = new Set<WorkflowStatus>(["approved", "locked"]);
const INDICATOR_CODE_SET = new Set<string>(INDICATOR_CODES);
const FIXED_PUBLIC_RAW_METRIC_IDS = [...PUBLIC_INDICATOR_CODES];
const FIXED_PUBLIC_RAW_METRIC_ID_SET = new Set<string>(
  FIXED_PUBLIC_RAW_METRIC_IDS,
);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class MetricRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricRegistryError";
  }
}

function fail(path: string, message: string): never {
  throw new MetricRegistryError(`${path}: ${message}`);
}

function exactObject(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "phải là object");
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const extra = actualKeys.filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(record, key));
  if (extra.length || missing.length) {
    return fail(
      path,
      `sai contract${missing.length ? `; thiếu ${missing.join(", ")}` : ""}${extra.length ? `; thừa ${extra.join(", ")}` : ""}`,
    );
  }
  return record;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") return fail(path, "phải là chuỗi không rỗng");
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : nonEmptyString(value, path);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(path, "phải là số hữu hạn");
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : finiteNumber(value, path);
}

function parseRoundingRule(value: unknown, path: string): MetricDefinition["rounding_rule"] {
  if (value === null) return null;
  const record = exactObject(value, path, ["decimals", "mode"]);
  const decimals = finiteNumber(record.decimals, `${path}.decimals`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    fail(`${path}.decimals`, "phải là số nguyên từ 0 đến 12");
  }
  if (record.mode !== "half_up") fail(`${path}.mode`, "chỉ hỗ trợ half_up");
  return { decimals, mode: "half_up" };
}

function parseInactiveStructuredRule(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> | null {
  if (value !== null) fail(path, "schema version 1 chưa bật policy này; giá trị phải là null");
  return null;
}

function enumValue<const T extends readonly string[]>(value: unknown, path: string, allowed: T): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return fail(path, `phải thuộc ${allowed.join(" | ")}`);
  }
  return value as T[number];
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return fail(path, "phải là array");
  const result = value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) return fail(path, "không được có phần tử trùng");
  return result;
}

function parseExpression(value: unknown, path: string, depth = 0): MetricExpression {
  if (depth > 8) return fail(path, "biểu thức lồng quá sâu");
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path, "phải là biểu thức object");
  const op = (value as Record<string, unknown>).op;
  if (op === "field") {
    const record = exactObject(value, path, ["op", "code"]);
    const code = nonEmptyString(record.code, `${path}.code`);
    if (!INDICATOR_CODE_SET.has(code)) return fail(`${path}.code`, "không phải CT01–CT14");
    return { op: "field", code: code as IndicatorCode };
  }
  if (op === "add") {
    const record = exactObject(value, path, ["op", "args"]);
    if (!Array.isArray(record.args) || record.args.length < 2) return fail(`${path}.args`, "phải có ít nhất hai biểu thức");
    return {
      op: "add",
      args: record.args.map((item, index) => parseExpression(item, `${path}.args[${index}]`, depth + 1)),
    };
  }
  return fail(`${path}.op`, "chỉ hỗ trợ field hoặc add");
}

function parseRoles(value: unknown, path: string): UserRole[] {
  const roles = stringArray(value, path);
  return roles.map((role, index) => enumValue(role, `${path}[${index}]`, USER_ROLES));
}

function parseMetric(value: unknown, path: string): MetricDefinition {
  const record = exactObject(value, path, METRIC_KEYS);
  const metric: MetricDefinition = {
    metric_id: nonEmptyString(record.metric_id, `${path}.metric_id`),
    kind: enumValue(record.kind, `${path}.kind`, ["raw", "derived"] as const),
    label_vi: nonEmptyString(record.label_vi, `${path}.label_vi`),
    description_vi: nonEmptyString(record.description_vi, `${path}.description_vi`),
    unit: nonEmptyString(record.unit, `${path}.unit`),
    display_unit_vi: nonEmptyString(record.display_unit_vi, `${path}.display_unit_vi`),
    aggregation: enumValue(record.aggregation, `${path}.aggregation`, ["sum", "ratio_of_sums", "count", "none"] as const),
    numerator: parseExpression(record.numerator, `${path}.numerator`),
    denominator: record.denominator === null ? null : parseExpression(record.denominator, `${path}.denominator`),
    scale: finiteNumber(record.scale, `${path}.scale`),
    direction: enumValue(record.direction, `${path}.direction`, ["higher", "lower", "neutral"] as const),
    target: nullableNumber(record.target, `${path}.target`),
    target_source: nullableString(record.target_source, `${path}.target_source`),
    owner: nullableString(record.owner, `${path}.owner`),
    effective_from: nullableString(record.effective_from, `${path}.effective_from`),
    effective_to: nullableString(record.effective_to, `${path}.effective_to`),
    tolerance: nullableNumber(record.tolerance, `${path}.tolerance`),
    target_scope: nullableString(record.target_scope, `${path}.target_scope`),
    rounding_rule: parseRoundingRule(record.rounding_rule, `${path}.rounding_rule`),
    roles: parseRoles(record.roles, `${path}.roles`),
    public: record.public === true ? true : record.public === false ? false : fail(`${path}.public`, "phải là boolean"),
    suppression_rule: parseInactiveStructuredRule(record.suppression_rule, `${path}.suppression_rule`),
    comparability_rule: parseInactiveStructuredRule(record.comparability_rule, `${path}.comparability_rule`),
    freshness_sla: parseInactiveStructuredRule(record.freshness_sla, `${path}.freshness_sla`),
    source_system: nonEmptyString(record.source_system, `${path}.source_system`),
    status: enumValue(record.status, `${path}.status`, ["draft", "approved", "retired"] as const),
    usage: enumValue(record.usage, `${path}.usage`, ["dashboard", "case_workflow_only"] as const),
    interpretation_limit_vi: nonEmptyString(record.interpretation_limit_vi, `${path}.interpretation_limit_vi`),
  };

  if (metric.scale <= 0) fail(`${path}.scale`, "phải lớn hơn 0");
  if (metric.aggregation === "ratio_of_sums" && metric.denominator === null) {
    fail(`${path}.denominator`, "ratio_of_sums bắt buộc có mẫu số");
  }
  if (metric.aggregation !== "ratio_of_sums" && metric.denominator !== null) {
    fail(`${path}.denominator`, `${metric.aggregation} không được có mẫu số`);
  }
  if (metric.kind === "raw") {
    if (!INDICATOR_CODE_SET.has(metric.metric_id)) fail(`${path}.metric_id`, "metric raw phải dùng mã CT01–CT14");
    if (metric.numerator.op !== "field" || metric.numerator.code !== metric.metric_id) {
      fail(`${path}.numerator`, "metric raw phải trỏ đúng field cùng mã");
    }
  }
  if (metric.public !== metric.roles.includes("dan")) {
    fail(`${path}.roles`, "vai trò dan phải khớp cờ public");
  }
  if (
    metric.public
    && (
      metric.kind !== "raw"
      || !FIXED_PUBLIC_RAW_METRIC_ID_SET.has(metric.metric_id)
    )
  ) {
    fail(
      `${path}.public`,
      "metric public chỉ được thuộc allowlist raw cố định",
    );
  }
  if (metric.effective_from !== null && !DATE_PATTERN.test(metric.effective_from)) {
    fail(`${path}.effective_from`, "phải có dạng YYYY-MM-DD");
  }
  if (metric.effective_to !== null && !DATE_PATTERN.test(metric.effective_to)) {
    fail(`${path}.effective_to`, "phải có dạng YYYY-MM-DD");
  }
  const targetMetadata = [
    metric.target_source,
    metric.owner,
    metric.effective_from,
    metric.tolerance,
    metric.target_scope,
    metric.rounding_rule,
  ];
  if (metric.target === null && targetMetadata.some((item) => item !== null)) {
    fail(`${path}.target`, "metadata mục tiêu không được tồn tại khi chưa có target");
  }
  if (metric.target !== null && targetMetadata.some((item) => item === null)) {
    fail(`${path}.target`, "target phải có đủ nguồn, owner, hiệu lực, dung sai, phạm vi và làm tròn");
  }
  if (metric.target !== null && metric.direction === "neutral") {
    fail(`${path}.direction`, "target bắt buộc có hướng higher hoặc lower");
  }
  return metric;
}

/** Parse and validate the bundled registry without trusting JSON inference. */
export function parseMetricRegistry(value: unknown): MetricRegistry {
  const record = exactObject(value, "metric_registry", REGISTRY_KEYS);
  if (record.schema_version !== 1) fail("metric_registry.schema_version", "chỉ hỗ trợ schema version 1");
  const registryVersion = nonEmptyString(record.registry_version, "metric_registry.registry_version");
  const publicRawMetricIds = stringArray(record.public_raw_metric_ids, "metric_registry.public_raw_metric_ids");
  if (
    publicRawMetricIds.length !== FIXED_PUBLIC_RAW_METRIC_IDS.length
    || publicRawMetricIds.some(
      (metricId, index) =>
        metricId !== FIXED_PUBLIC_RAW_METRIC_IDS[index],
    )
  ) {
    fail(
      "metric_registry.public_raw_metric_ids",
      "phải bằng allowlist public raw cố định",
    );
  }
  if (!Array.isArray(record.metrics) || record.metrics.length === 0) fail("metric_registry.metrics", "phải là array không rỗng");
  const metrics = record.metrics.map((metric, index) => parseMetric(metric, `metric_registry.metrics[${index}]`));
  const ids = metrics.map((metric) => metric.metric_id);
  if (new Set(ids).size !== ids.length) fail("metric_registry.metrics", "metric_id phải duy nhất");
  for (const metricId of publicRawMetricIds) {
    const metric = metrics.find((candidate) => candidate.metric_id === metricId);
    if (!metric || metric.kind !== "raw" || !metric.public || metric.status !== "approved") {
      fail("metric_registry.public_raw_metric_ids", `${metricId} phải là metric raw, public và approved`);
    }
  }
  const actualPublicRawIds = metrics
    .filter((metric) => metric.kind === "raw" && metric.public && metric.status === "approved")
    .map((metric) => metric.metric_id);
  if (
    actualPublicRawIds.length !== publicRawMetricIds.length
    || actualPublicRawIds.some((metricId) => !publicRawMetricIds.includes(metricId))
  ) {
    fail("metric_registry.public_raw_metric_ids", "phải liệt kê đúng toàn bộ metric raw public đã approved");
  }
  return {
    schema_version: 1,
    registry_version: registryVersion,
    public_raw_metric_ids: publicRawMetricIds,
    metrics,
  };
}

export const metricRegistry = parseMetricRegistry(rawRegistry);

const metricById = new Map(metricRegistry.metrics.map((metric) => [metric.metric_id, metric]));

export function getMetricDefinition(metricId: string, registry: MetricRegistry = metricRegistry): MetricDefinition {
  const metric = registry === metricRegistry
    ? metricById.get(metricId)
    : registry.metrics.find((candidate) => candidate.metric_id === metricId);
  if (!metric) throw new MetricRegistryError(`Không có metric ${metricId} trong registry`);
  return metric;
}

type ExpressionResult =
  | { readonly state: "value"; readonly value: number }
  | { readonly state: "missing" }
  | { readonly state: "invalid" };

function expressionValue(
  expression: MetricExpression,
  values: Readonly<Partial<Record<IndicatorCode, number | null>>>,
): ExpressionResult {
  if (expression.op === "field") {
    const value = (values as Readonly<Record<string, unknown>>)[expression.code];
    if (value === null || value === undefined) return { state: "missing" };
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || !Number.isInteger(value)
      || value < 0
    ) return { state: "invalid" };
    return { state: "value", value };
  }
  let total = 0;
  let missing = false;
  for (const argument of expression.args) {
    const result = expressionValue(argument, values);
    if (result.state === "invalid") return result;
    if (result.state === "missing") missing = true;
    else total += result.value;
  }
  return missing ? { state: "missing" } : { state: "value", value: total };
}

function sourceVersions(reports: readonly MetricEvaluationReport[]): MetricSourceReportVersion[] {
  return reports
    .map((report) => ({
      report_id: report.report_id,
      village_id: report.village_id,
      version: report.version,
      workflow_status: report.workflow_status as "approved" | "locked",
    }))
    .sort(
      (left, right) => left.village_id.localeCompare(right.village_id)
        || left.report_id.localeCompare(right.report_id),
    );
}

function aggregateExpression(
  expression: MetricExpression,
  reports: readonly MetricEvaluationReport[],
): ExpressionResult {
  let total = 0;
  let missing = false;
  for (const report of reports) {
    const result = expressionValue(expression, report.values);
    if (result.state === "invalid") return result;
    if (result.state === "missing") missing = true;
    else total += result.value;
  }
  return missing ? { state: "missing" } : { state: "value", value: total };
}

/**
 * Deterministic frontend counterpart of the server semantic evaluator.
 * It never substitutes missing data with zero and never averages ratios.
 */
export function evaluateMetric(
  metricId: string,
  reports: readonly MetricEvaluationReport[],
  context: MetricEvaluationContext,
  registry: MetricRegistry = metricRegistry,
): MetricEvaluationResult {
  const contextRecord = context as unknown as Record<string, unknown>;
  const periodId = typeof contextRecord?.period_id === "string" ? contextRecord.period_id.trim() : "";
  const scope = typeof contextRecord?.scope === "string" ? contextRecord.scope.trim() : "";
  const rawExpectedVillageIds = contextRecord?.expected_village_ids;
  const validExpectedVillageIds = Array.isArray(rawExpectedVillageIds)
    && rawExpectedVillageIds.every((item) => typeof item === "string" && item.trim() !== "");
  const expectedVillageIds = validExpectedVillageIds
    ? rawExpectedVillageIds as string[]
    : [];
  const metric = registry.metrics.find((candidate) => candidate.metric_id === metricId);
  const validReports = reports.every(hasMetricEvaluationReportEnvelope);
  const eligible = validReports
    ? reports.filter((report) => FINAL_WORKFLOW_STATUSES.has(report.workflow_status))
    : [];
  const expectedSet = new Set(expectedVillageIds);
  const includedVillages = new Set(eligible.map((report) => report.village_id));
  const missingCount = expectedVillageIds.filter((villageId) => !includedVillages.has(villageId)).length;
  const coverageStatus: MetricCoverageStatus = eligible.length === 0
    ? "unavailable"
    : missingCount > 0
      ? "partial"
      : "complete";
  const base = {
    metric_id: metricId,
    unit: metric?.unit ?? null,
    included_count: eligible.length,
    expected_count: expectedVillageIds.length,
    missing_count: missingCount,
    coverage_status: coverageStatus,
    registry_version: registry.registry_version,
    period_id: periodId,
    scope,
    source_report_versions: sourceVersions(eligible),
  } as const;
  const blocked = (reason: MetricEvaluationReason, numerator: number | null = null, denominator: number | null = null): MetricEvaluationResult => ({
    ...base,
    value: null,
    numerator,
    denominator,
    reason,
  });

  if (
    periodId === ""
    || scope === ""
    || !validExpectedVillageIds
    || new Set(expectedVillageIds).size !== expectedVillageIds.length
  ) return blocked("invalid_context");
  if (!metric) return blocked("metric_not_found");
  if (!validReports) return blocked("invalid_report");
  if (metric.status !== "approved") return blocked("metric_not_approved");
  if (eligible.length === 0) return blocked("no_eligible_reports");
  if (eligible.some((report) => report.period_id !== periodId)) return blocked("period_mismatch");
  const scopeKeys = eligible.map((report) => `${report.village_id}\u0000${report.period_id}`);
  if (new Set(scopeKeys).size !== scopeKeys.length) return blocked("duplicate_village_period");
  if (eligible.some((report) => !expectedSet.has(report.village_id))) return blocked("scope_mismatch");
  if (metric.aggregation === "none") return blocked("aggregation_not_supported");

  const numeratorResult = aggregateExpression(metric.numerator, eligible);
  if (numeratorResult.state === "invalid") return blocked("invalid_value");
  if (numeratorResult.state === "missing") {
    return { ...blocked("partial_coverage"), coverage_status: "partial" };
  }
  const numerator = numeratorResult.value;
  let denominator: number | null = null;
  if (metric.denominator !== null) {
    const denominatorResult = aggregateExpression(metric.denominator, eligible);
    if (denominatorResult.state === "invalid") return blocked("invalid_value", numerator);
    if (denominatorResult.state === "missing") {
      return { ...blocked("partial_coverage", numerator), coverage_status: "partial" };
    }
    denominator = denominatorResult.value;
    if (denominator === 0) return blocked("zero_denominator", numerator, denominator);
  }

  const value = metric.aggregation === "ratio_of_sums"
    ? (numerator / (denominator as number)) * metric.scale
    : numerator * metric.scale;
  return {
    ...base,
    value,
    numerator,
    denominator,
    reason: coverageStatus === "partial" ? "partial_coverage" : null,
  };
}

const METRIC_REPORT_KEYS = [
  "report_id",
  "village_id",
  "period_id",
  "workflow_status",
  "version",
  "values",
] as const;

function hasMetricEvaluationReportEnvelope(value: unknown): value is MetricEvaluationReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  const keys = Object.keys(report);
  if (
    keys.length !== METRIC_REPORT_KEYS.length
    || keys.some((key) => !METRIC_REPORT_KEYS.includes(key as (typeof METRIC_REPORT_KEYS)[number]))
    || typeof report.report_id !== "string"
    || report.report_id.trim() === ""
    || typeof report.village_id !== "string"
    || report.village_id.trim() === ""
    || typeof report.period_id !== "string"
    || report.period_id.trim() === ""
    || typeof report.workflow_status !== "string"
    || !WORKFLOW_STATUSES.has(report.workflow_status as WorkflowStatus)
    || typeof report.version !== "number"
    || !Number.isInteger(report.version)
    || report.version < 1
    || typeof report.values !== "object"
    || report.values === null
    || Array.isArray(report.values)
  ) return false;
  const values = report.values as Record<string, unknown>;
  return Object.keys(values).every((code) => INDICATOR_CODE_SET.has(code));
}

/** Strict guard for callers that need a fully usable report before evaluation. */
export function isMetricEvaluationReport(value: unknown): value is MetricEvaluationReport {
  if (!hasMetricEvaluationReportEnvelope(value)) return false;
  return Object.values(value.values).every((fieldValue) => (
    fieldValue === null
    || (
      typeof fieldValue === "number"
      && Number.isFinite(fieldValue)
      && Number.isInteger(fieldValue)
      && fieldValue >= 0
    )
  ));
}
