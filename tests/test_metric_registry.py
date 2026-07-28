from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

from services.metric_registry import (
    EvaluationContext,
    MetricRegistryError,
    PUBLIC_RAW_METRIC_IDS,
    evaluate_metric,
    is_evaluation_report,
    load_metric_registry,
    parse_metric_registry,
)


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "config" / "metric_registry.json"
CASES_PATH = Path(__file__).with_name("fixtures") / "metric_cases.json"


def _registry_payload() -> dict:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def test_registry_loads_exact_public_boundary() -> None:
    registry = load_metric_registry()

    assert registry.schema_version == 1
    assert registry.public_raw_metric_ids == PUBLIC_RAW_METRIC_IDS
    assert len(registry.metrics) == 23
    assert len({metric.metric_id for metric in registry.metrics}) == 23
    assert all(
        metric.kind == "raw"
        and metric.metric_id in PUBLIC_RAW_METRIC_IDS
        for metric in registry.metrics
        if metric.public
    )


def test_registry_rejects_unknown_root_keys() -> None:
    payload = _registry_payload()
    payload["undocumented_policy"] = True

    with pytest.raises(MetricRegistryError, match="undocumented_policy"):
        parse_metric_registry(payload)


def test_registry_rejects_formula_strings() -> None:
    payload = _registry_payload()
    payload["metrics"][0]["numerator"] = "CT01 + CT02"

    with pytest.raises(MetricRegistryError, match="expression object"):
        parse_metric_registry(payload)


def test_registry_requires_complete_target_governance_and_direction() -> None:
    incomplete = _registry_payload()
    incomplete["metrics"][0]["target_source"] = "Văn bản chưa đủ metadata"
    with pytest.raises(MetricRegistryError, match="target metadata"):
        parse_metric_registry(incomplete)

    neutral = _registry_payload()
    neutral["metrics"][0].update(
        {
            "target": 95,
            "target_source": "Quyết định đã phê duyệt",
            "owner": "Cơ quan có thẩm quyền",
            "effective_from": "2026-07-01",
            "tolerance": 0.1,
            "target_scope": "commune",
            "rounding_rule": {"decimals": 1, "mode": "half_up"},
        }
    )
    with pytest.raises(MetricRegistryError, match="higher or lower"):
        parse_metric_registry(neutral)


def test_registry_rejects_a_public_derived_metric() -> None:
    payload = _registry_payload()
    derived = next(
        metric
        for metric in payload["metrics"]
        if metric["metric_id"] == "health_insurance_rate"
    )
    derived["public"] = True
    derived["roles"].append("dan")

    with pytest.raises(MetricRegistryError, match="fixed raw allowlist"):
        parse_metric_registry(payload)


def test_shared_metric_cases_match_python_evaluator() -> None:
    fixture = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    assert fixture["schema_version"] == 1
    assert fixture["registry_version"] == load_metric_registry().registry_version
    assert len(fixture["cases"]) == 15

    for case in fixture["cases"]:
        context = EvaluationContext(
            period_id=case["context"]["period_id"],
            scope=case["context"]["scope"],
            expected_village_ids=tuple(
                case["context"]["expected_village_ids"]
            ),
        )
        actual = evaluate_metric(
            case["metric_id"],
            deepcopy(case["reports"]),
            context,
        ).to_dict()
        assert actual == case["expected"], case["case_id"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("version", 0),
        ("workflow_status", "published"),
        ("values", {"CT99": 1}),
        ("values", {"CT01": -1}),
        ("values", {"CT01": 1.5}),
        ("values", {"CT01": True}),
    ],
)
def test_strict_report_guard_rejects_invalid_inputs(
    field: str,
    value: object,
) -> None:
    report = {
        "report_id": "r-a",
        "village_id": "village-a",
        "period_id": "period-2026-07",
        "workflow_status": "approved",
        "version": 1,
        "values": {"CT01": 1},
    }
    report[field] = value

    assert not is_evaluation_report(report)

