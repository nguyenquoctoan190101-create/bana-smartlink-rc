from __future__ import annotations

from services.operations import build_safe_period_brief, quality_snapshot, validate_maturity_scores


def test_quality_snapshot_preserves_missing_values_and_blocks_deterministic_errors() -> None:
    result = quality_snapshot(
        {"id": "r1", "village_id": "v1", "village_name": "Thôn A", "timeliness_status": "late", "report_source": "excel", "version": 3},
        [{"ct_code": "CT01", "value": 10}, {"ct_code": "CT04", "value": None}],
        [{"ct_code": "CT04", "error_type": "BLANK", "resolved": False}],
    )
    assert result["completeness_percent"] == round(100 / 14, 1)
    assert result["quality_status"] == "blocked"
    assert result["lineage"] == {"report_source": "excel", "report_version": 3, "rule_version": "2026-07-14"}


def test_safe_period_brief_contains_only_summary_evidence_not_indicator_values_or_pii() -> None:
    snapshot = quality_snapshot(
        {"id": "r1", "village_id": "v1", "village_name": "Thôn A", "timeliness_status": "on_time"},
        [{"ct_code": "CT14", "value": 999}],
        [],
    )
    content, citations, confidence = build_safe_period_brief("Quý 3", [snapshot])
    assert "CT14" not in content
    assert "999" not in content
    assert citations[0]["id"] == "r1"
    assert confidence > 0


def test_maturity_requires_exact_six_contextual_dimensions() -> None:
    valid = {key: 3 for key in ("strategy", "process", "data", "people", "security", "governance")}
    assert validate_maturity_scores(valid) == valid
    try:
        validate_maturity_scores({"strategy": 3})
    except ValueError as exc:
        assert "exactly" in str(exc)
    else:
        raise AssertionError("Partial maturity score should be rejected")
