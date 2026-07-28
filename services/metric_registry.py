"""Versioned semantic metric registry and deterministic aggregate evaluator.

This module is intentionally independent from validation_rules.json. Validation
decides whether a report can advance through workflow; this registry defines
how approved evidence may be aggregated for dashboards and exports.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
import json
import math
from pathlib import Path
import re
from typing import Any, Mapping, Sequence


REGISTRY_PATH = (
    Path(__file__).resolve().parents[1] / "config" / "metric_registry.json"
)
INDICATOR_CODES = tuple(f"CT{index:02d}" for index in range(1, 15))
INDICATOR_CODE_SET = frozenset(INDICATOR_CODES)
PUBLIC_RAW_METRIC_IDS = ("CT01", "CT02", "CT09", "CT12", "CT13")
WORKFLOW_STATUSES = frozenset(
    {"draft", "submitted", "needs_revision", "approved", "locked"}
)
FINAL_WORKFLOW_STATUSES = frozenset({"approved", "locked"})
USER_ROLES = frozenset(
    {"admin_xa", "can_bo_thon", "to_cnscd", "lanh_dao", "dan"}
)
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

REGISTRY_KEYS = frozenset(
    {"schema_version", "registry_version", "public_raw_metric_ids", "metrics"}
)
METRIC_KEYS = frozenset(
    {
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
    }
)
METRIC_REPORT_KEYS = frozenset(
    {
        "report_id",
        "village_id",
        "period_id",
        "workflow_status",
        "version",
        "values",
    }
)


class MetricRegistryError(ValueError):
    """Raised when the registry violates its exact semantic contract."""


@dataclass(frozen=True)
class MetricDefinition:
    metric_id: str
    kind: str
    label_vi: str
    description_vi: str
    unit: str
    display_unit_vi: str
    aggregation: str
    numerator: Mapping[str, Any]
    denominator: Mapping[str, Any] | None
    scale: int | float
    direction: str
    target: int | float | None
    target_source: str | None
    owner: str | None
    effective_from: str | None
    effective_to: str | None
    tolerance: int | float | None
    target_scope: str | None
    rounding_rule: Mapping[str, Any] | None
    roles: tuple[str, ...]
    public: bool
    suppression_rule: None
    comparability_rule: None
    freshness_sla: None
    source_system: str
    status: str
    usage: str
    interpretation_limit_vi: str


@dataclass(frozen=True)
class MetricRegistry:
    schema_version: int
    registry_version: str
    public_raw_metric_ids: tuple[str, ...]
    metrics: tuple[MetricDefinition, ...]

    def get(self, metric_id: str) -> MetricDefinition | None:
        return next(
            (metric for metric in self.metrics if metric.metric_id == metric_id),
            None,
        )


@dataclass(frozen=True)
class EvaluationContext:
    period_id: str
    scope: str
    expected_village_ids: tuple[str, ...]


@dataclass(frozen=True)
class EvaluationReport:
    report_id: str
    village_id: str
    period_id: str
    workflow_status: str
    version: int
    values: Mapping[str, int | float | None]


@dataclass(frozen=True)
class SourceReportVersion:
    report_id: str
    village_id: str
    version: int
    workflow_status: str


@dataclass(frozen=True)
class MetricEvaluationResult:
    metric_id: str
    value: int | float | None
    numerator: int | float | None
    denominator: int | float | None
    unit: str | None
    included_count: int
    expected_count: int
    missing_count: int
    coverage_status: str
    reason: str | None
    registry_version: str
    period_id: str
    scope: str
    source_report_versions: tuple[SourceReportVersion, ...]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["source_report_versions"] = [
            asdict(item) for item in self.source_report_versions
        ]
        return payload


def _fail(path: str, message: str) -> None:
    raise MetricRegistryError(f"{path}: {message}")


def _exact_mapping(
    value: Any,
    path: str,
    keys: frozenset[str] | set[str],
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        _fail(path, "must be an object")
    actual = set(value)
    missing = sorted(keys - actual)
    extra = sorted(actual - keys)
    if missing or extra:
        detail = []
        if missing:
            detail.append(f"missing {', '.join(missing)}")
        if extra:
            detail.append(f"extra {', '.join(extra)}")
        _fail(path, f"invalid exact contract; {'; '.join(detail)}")
    return value


def _non_empty_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(path, "must be a non-empty string")
    return value


def _nullable_string(value: Any, path: str) -> str | None:
    return None if value is None else _non_empty_string(value, path)


def _finite_number(value: Any, path: str) -> int | float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        _fail(path, "must be a finite number")
    return value


def _nullable_number(value: Any, path: str) -> int | float | None:
    return None if value is None else _finite_number(value, path)


def _enum(value: Any, path: str, allowed: set[str]) -> str:
    if not isinstance(value, str) or value not in allowed:
        _fail(path, f"must be one of {' | '.join(sorted(allowed))}")
    return value


def _string_array(value: Any, path: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        _fail(path, "must be an array")
    result = tuple(
        _non_empty_string(item, f"{path}[{index}]")
        for index, item in enumerate(value)
    )
    if len(set(result)) != len(result):
        _fail(path, "must not contain duplicates")
    return result


def _parse_expression(
    value: Any,
    path: str,
    depth: int = 0,
) -> Mapping[str, Any]:
    if depth > 8:
        _fail(path, "expression nesting is too deep")
    if not isinstance(value, Mapping):
        _fail(path, "must be an expression object")
    operation = value.get("op")
    if operation == "field":
        record = _exact_mapping(value, path, {"op", "code"})
        code = _non_empty_string(record["code"], f"{path}.code")
        if code not in INDICATOR_CODE_SET:
            _fail(f"{path}.code", "must be CT01-CT14")
        return {"op": "field", "code": code}
    if operation == "add":
        record = _exact_mapping(value, path, {"op", "args"})
        arguments = record["args"]
        if not isinstance(arguments, list) or len(arguments) < 2:
            _fail(f"{path}.args", "must contain at least two expressions")
        return {
            "op": "add",
            "args": tuple(
                _parse_expression(
                    argument,
                    f"{path}.args[{index}]",
                    depth + 1,
                )
                for index, argument in enumerate(arguments)
            ),
        }
    _fail(f"{path}.op", "supports only field or add")


def _parse_rounding_rule(
    value: Any,
    path: str,
) -> Mapping[str, Any] | None:
    if value is None:
        return None
    record = _exact_mapping(value, path, {"decimals", "mode"})
    decimals = record["decimals"]
    if (
        isinstance(decimals, bool)
        or not isinstance(decimals, int)
        or not 0 <= decimals <= 12
    ):
        _fail(f"{path}.decimals", "must be an integer from 0 to 12")
    if record["mode"] != "half_up":
        _fail(f"{path}.mode", "supports only half_up")
    return {"decimals": decimals, "mode": "half_up"}


def _parse_metric(value: Any, path: str) -> MetricDefinition:
    record = _exact_mapping(value, path, METRIC_KEYS)
    roles = _string_array(record["roles"], f"{path}.roles")
    for index, role in enumerate(roles):
        _enum(role, f"{path}.roles[{index}]", set(USER_ROLES))
    public = record["public"]
    if not isinstance(public, bool):
        _fail(f"{path}.public", "must be boolean")
    for policy_name in (
        "suppression_rule",
        "comparability_rule",
        "freshness_sla",
    ):
        if record[policy_name] is not None:
            _fail(
                f"{path}.{policy_name}",
                "schema version 1 requires null for this inactive policy",
            )

    metric = MetricDefinition(
        metric_id=_non_empty_string(
            record["metric_id"], f"{path}.metric_id"
        ),
        kind=_enum(record["kind"], f"{path}.kind", {"raw", "derived"}),
        label_vi=_non_empty_string(record["label_vi"], f"{path}.label_vi"),
        description_vi=_non_empty_string(
            record["description_vi"], f"{path}.description_vi"
        ),
        unit=_non_empty_string(record["unit"], f"{path}.unit"),
        display_unit_vi=_non_empty_string(
            record["display_unit_vi"], f"{path}.display_unit_vi"
        ),
        aggregation=_enum(
            record["aggregation"],
            f"{path}.aggregation",
            {"sum", "ratio_of_sums", "count", "none"},
        ),
        numerator=_parse_expression(
            record["numerator"], f"{path}.numerator"
        ),
        denominator=(
            None
            if record["denominator"] is None
            else _parse_expression(
                record["denominator"], f"{path}.denominator"
            )
        ),
        scale=_finite_number(record["scale"], f"{path}.scale"),
        direction=_enum(
            record["direction"],
            f"{path}.direction",
            {"higher", "lower", "neutral"},
        ),
        target=_nullable_number(record["target"], f"{path}.target"),
        target_source=_nullable_string(
            record["target_source"], f"{path}.target_source"
        ),
        owner=_nullable_string(record["owner"], f"{path}.owner"),
        effective_from=_nullable_string(
            record["effective_from"], f"{path}.effective_from"
        ),
        effective_to=_nullable_string(
            record["effective_to"], f"{path}.effective_to"
        ),
        tolerance=_nullable_number(
            record["tolerance"], f"{path}.tolerance"
        ),
        target_scope=_nullable_string(
            record["target_scope"], f"{path}.target_scope"
        ),
        rounding_rule=_parse_rounding_rule(
            record["rounding_rule"], f"{path}.rounding_rule"
        ),
        roles=roles,
        public=public,
        suppression_rule=None,
        comparability_rule=None,
        freshness_sla=None,
        source_system=_non_empty_string(
            record["source_system"], f"{path}.source_system"
        ),
        status=_enum(
            record["status"],
            f"{path}.status",
            {"draft", "approved", "retired"},
        ),
        usage=_enum(
            record["usage"],
            f"{path}.usage",
            {"dashboard", "case_workflow_only"},
        ),
        interpretation_limit_vi=_non_empty_string(
            record["interpretation_limit_vi"],
            f"{path}.interpretation_limit_vi",
        ),
    )

    if metric.scale <= 0:
        _fail(f"{path}.scale", "must be greater than zero")
    if (
        metric.aggregation == "ratio_of_sums"
        and metric.denominator is None
    ):
        _fail(
            f"{path}.denominator",
            "ratio_of_sums requires a denominator",
        )
    if (
        metric.aggregation != "ratio_of_sums"
        and metric.denominator is not None
    ):
        _fail(
            f"{path}.denominator",
            f"{metric.aggregation} must not have a denominator",
        )
    if metric.kind == "raw":
        if metric.metric_id not in INDICATOR_CODE_SET:
            _fail(f"{path}.metric_id", "raw metric must use CT01-CT14")
        if (
            metric.numerator.get("op") != "field"
            or metric.numerator.get("code") != metric.metric_id
        ):
            _fail(
                f"{path}.numerator",
                "raw metric must reference its matching field",
            )
    if metric.public != ("dan" in metric.roles):
        _fail(f"{path}.roles", "dan role must match public flag")
    if metric.public and (
        metric.kind != "raw"
        or metric.metric_id not in PUBLIC_RAW_METRIC_IDS
    ):
        _fail(
            f"{path}.public",
            "public metrics are restricted to the fixed raw allowlist",
        )
    for field_name, value_to_check in (
        ("effective_from", metric.effective_from),
        ("effective_to", metric.effective_to),
    ):
        if value_to_check is not None and not DATE_PATTERN.fullmatch(
            value_to_check
        ):
            _fail(f"{path}.{field_name}", "must use YYYY-MM-DD")

    target_metadata = (
        metric.target_source,
        metric.owner,
        metric.effective_from,
        metric.tolerance,
        metric.target_scope,
        metric.rounding_rule,
    )
    if metric.target is None and any(
        item is not None for item in target_metadata
    ):
        _fail(
            f"{path}.target",
            "target metadata must be null when target is absent",
        )
    if metric.target is not None and any(
        item is None for item in target_metadata
    ):
        _fail(
            f"{path}.target",
            "target requires source, owner, effective date, tolerance, "
            "scope and rounding",
        )
    if metric.target is not None and metric.direction == "neutral":
        _fail(
            f"{path}.direction",
            "target requires higher or lower direction",
        )
    return metric


def parse_metric_registry(value: Any) -> MetricRegistry:
    record = _exact_mapping(value, "metric_registry", REGISTRY_KEYS)
    if isinstance(record["schema_version"], bool) or record[
        "schema_version"
    ] != 1:
        _fail("metric_registry.schema_version", "supports only version 1")
    registry_version = _non_empty_string(
        record["registry_version"], "metric_registry.registry_version"
    )
    public_raw_metric_ids = _string_array(
        record["public_raw_metric_ids"],
        "metric_registry.public_raw_metric_ids",
    )
    if public_raw_metric_ids != PUBLIC_RAW_METRIC_IDS:
        _fail(
            "metric_registry.public_raw_metric_ids",
            "must equal the fixed public raw allowlist",
        )
    raw_metrics = record["metrics"]
    if not isinstance(raw_metrics, list) or not raw_metrics:
        _fail("metric_registry.metrics", "must be a non-empty array")
    metrics = tuple(
        _parse_metric(metric, f"metric_registry.metrics[{index}]")
        for index, metric in enumerate(raw_metrics)
    )
    ids = tuple(metric.metric_id for metric in metrics)
    if len(set(ids)) != len(ids):
        _fail("metric_registry.metrics", "metric_id must be unique")
    actual_public_raw_ids = tuple(
        metric.metric_id
        for metric in metrics
        if metric.kind == "raw"
        and metric.public
        and metric.status == "approved"
    )
    if actual_public_raw_ids != PUBLIC_RAW_METRIC_IDS:
        _fail(
            "metric_registry.public_raw_metric_ids",
            "must list every approved public raw metric exactly",
        )
    return MetricRegistry(
        schema_version=1,
        registry_version=registry_version,
        public_raw_metric_ids=public_raw_metric_ids,
        metrics=metrics,
    )


@lru_cache(maxsize=4)
def load_metric_registry(
    path: Path = REGISTRY_PATH,
) -> MetricRegistry:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MetricRegistryError(
            f"Unable to load metric registry at {path}"
        ) from exc
    return parse_metric_registry(payload)


def _report_mapping(
    report: EvaluationReport | Mapping[str, Any],
) -> Mapping[str, Any]:
    if isinstance(report, EvaluationReport):
        return {
            "report_id": report.report_id,
            "village_id": report.village_id,
            "period_id": report.period_id,
            "workflow_status": report.workflow_status,
            "version": report.version,
            "values": report.values,
        }
    return report


def _valid_report_envelope(report: Any) -> bool:
    if not isinstance(report, (EvaluationReport, Mapping)):
        return False
    record = _report_mapping(report)
    if set(record) != METRIC_REPORT_KEYS:
        return False
    if not isinstance(record["report_id"], str) or not record[
        "report_id"
    ].strip():
        return False
    if not isinstance(record["village_id"], str) or not record[
        "village_id"
    ].strip():
        return False
    if not isinstance(record["period_id"], str) or not record[
        "period_id"
    ].strip():
        return False
    if record["workflow_status"] not in WORKFLOW_STATUSES:
        return False
    version = record["version"]
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        return False
    values = record["values"]
    if not isinstance(values, Mapping):
        return False
    return all(code in INDICATOR_CODE_SET for code in values)


def is_evaluation_report(report: Any) -> bool:
    if not _valid_report_envelope(report):
        return False
    values = _report_mapping(report)["values"]
    return all(
        value is None
        or (
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(value)
            and float(value).is_integer()
            and value >= 0
        )
        for value in values.values()
    )


def _expression_value(
    expression: Mapping[str, Any],
    values: Mapping[str, Any],
) -> tuple[str, int | float | None]:
    if expression["op"] == "field":
        value = values.get(expression["code"])
        if value is None:
            return ("missing", None)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not float(value).is_integer()
            or value < 0
        ):
            return ("invalid", None)
        return ("value", value)

    total: int | float = 0
    missing = False
    for argument in expression["args"]:
        state, value = _expression_value(argument, values)
        if state == "invalid":
            return ("invalid", None)
        if state == "missing":
            missing = True
        else:
            total += value  # type: ignore[operator]
    return ("missing", None) if missing else ("value", total)


def _aggregate_expression(
    expression: Mapping[str, Any],
    reports: Sequence[Mapping[str, Any]],
) -> tuple[str, int | float | None]:
    total: int | float = 0
    missing = False
    for report in reports:
        state, value = _expression_value(expression, report["values"])
        if state == "invalid":
            return ("invalid", None)
        if state == "missing":
            missing = True
        else:
            total += value  # type: ignore[operator]
    return ("missing", None) if missing else ("value", total)


def evaluate_metric(
    metric_id: str,
    reports: Sequence[EvaluationReport | Mapping[str, Any]],
    context: EvaluationContext,
    registry: MetricRegistry | None = None,
) -> MetricEvaluationResult:
    registry = registry or load_metric_registry()
    period_id = (
        context.period_id.strip()
        if isinstance(context.period_id, str)
        else ""
    )
    scope = context.scope.strip() if isinstance(context.scope, str) else ""
    raw_expected = context.expected_village_ids
    valid_expected = (
        isinstance(raw_expected, (tuple, list))
        and all(
            isinstance(item, str) and bool(item.strip())
            for item in raw_expected
        )
    )
    expected = tuple(raw_expected) if valid_expected else ()
    report_records = [
        _report_mapping(report)
        for report in reports
        if isinstance(report, (EvaluationReport, Mapping))
    ]
    valid_reports = len(report_records) == len(reports) and all(
        _valid_report_envelope(report) for report in report_records
    )
    eligible = (
        [
            report
            for report in report_records
            if report["workflow_status"] in FINAL_WORKFLOW_STATUSES
        ]
        if valid_reports
        else []
    )
    expected_set = set(expected)
    included_villages = {
        str(report["village_id"]) for report in eligible
    }
    missing_count = sum(
        village_id not in included_villages for village_id in expected
    )
    coverage_status = (
        "unavailable"
        if not eligible
        else "partial"
        if missing_count > 0
        else "complete"
    )
    metric = registry.get(metric_id)
    source_versions = tuple(
        SourceReportVersion(
            report_id=str(report["report_id"]),
            village_id=str(report["village_id"]),
            version=int(report["version"]),
            workflow_status=str(report["workflow_status"]),
        )
        for report in sorted(
            eligible,
            key=lambda item: (
                str(item["village_id"]),
                str(item["report_id"]),
            ),
        )
    )

    base = {
        "metric_id": metric_id,
        "unit": metric.unit if metric else None,
        "included_count": len(eligible),
        "expected_count": len(expected),
        "missing_count": missing_count,
        "coverage_status": coverage_status,
        "registry_version": registry.registry_version,
        "period_id": period_id,
        "scope": scope,
        "source_report_versions": source_versions,
    }

    def blocked(
        reason: str,
        numerator: int | float | None = None,
        denominator: int | float | None = None,
        *,
        forced_coverage: str | None = None,
    ) -> MetricEvaluationResult:
        result_base = {
            **base,
            "coverage_status": forced_coverage or coverage_status,
        }
        return MetricEvaluationResult(
            **result_base,
            value=None,
            numerator=numerator,
            denominator=denominator,
            reason=reason,
        )

    if (
        not period_id
        or not scope
        or not valid_expected
        or len(set(expected)) != len(expected)
    ):
        return blocked("invalid_context")
    if metric is None:
        return blocked("metric_not_found")
    if not valid_reports:
        return blocked("invalid_report")
    if metric.status != "approved":
        return blocked("metric_not_approved")
    if not eligible:
        return blocked("no_eligible_reports")
    if any(report["period_id"] != period_id for report in eligible):
        return blocked("period_mismatch")
    grain = [
        (str(report["village_id"]), str(report["period_id"]))
        for report in eligible
    ]
    if len(set(grain)) != len(grain):
        return blocked("duplicate_village_period")
    if any(report["village_id"] not in expected_set for report in eligible):
        return blocked("scope_mismatch")
    if metric.aggregation == "none":
        return blocked("aggregation_not_supported")

    numerator_state, numerator_value = _aggregate_expression(
        metric.numerator,
        eligible,
    )
    if numerator_state == "invalid":
        return blocked("invalid_value")
    if numerator_state == "missing":
        return blocked(
            "partial_coverage",
            forced_coverage="partial",
        )
    numerator = numerator_value
    denominator: int | float | None = None
    if metric.denominator is not None:
        denominator_state, denominator_value = _aggregate_expression(
            metric.denominator,
            eligible,
        )
        if denominator_state == "invalid":
            return blocked("invalid_value", numerator)
        if denominator_state == "missing":
            return blocked(
                "partial_coverage",
                numerator,
                forced_coverage="partial",
            )
        denominator = denominator_value
        if denominator == 0:
            return blocked("zero_denominator", numerator, denominator)

    if metric.aggregation == "ratio_of_sums":
        value = (numerator / denominator) * metric.scale  # type: ignore[operator]
    else:
        value = numerator * metric.scale  # type: ignore[operator]
    return MetricEvaluationResult(
        **base,
        value=value,
        numerator=numerator,
        denominator=denominator,
        reason=(
            "partial_coverage"
            if coverage_status == "partial"
            else None
        ),
    )
