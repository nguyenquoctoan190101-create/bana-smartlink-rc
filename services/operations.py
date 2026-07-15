"""Small, deterministic operations helpers.

This module intentionally does not call an LLM.  It turns already-authorized
report rows into quality evidence and safe draft text; an LLM may later explain
the same facts, but cannot decide validity, approval, publication, or writes.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

ALL_CT_CODES = {f"CT{number:02d}" for number in range(1, 15)}
PUBLIC_CT_CODES = {"CT01", "CT02", "CT09", "CT12", "CT13"}
RULE_VERSION = "2026-07-14"
MATURITY_DIMENSIONS = (
    "strategy",
    "process",
    "data",
    "people",
    "security",
    "governance",
)


def quality_snapshot(report: dict[str, Any], values: Iterable[dict[str, Any]], flags: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Produce an evidence-bearing quality result without coercing null to zero."""
    values_by_code = {str(row.get("ct_code")): row.get("value") for row in values}
    present = sum(1 for code in ALL_CT_CODES if values_by_code.get(code) is not None)
    unresolved = [row for row in flags if not bool(row.get("resolved", False))]
    blocking = [row for row in unresolved if str(row.get("error_type")) in {"BLANK", "TEXT", "SEP", "LOGIC", "BADPHONE"}]
    outliers = [row for row in unresolved if str(row.get("error_type")) == "OUTLIER"]
    completeness = round(present * 100 / len(ALL_CT_CODES), 1)
    validity = 0.0 if blocking else 100.0
    timeliness = 100.0 if report.get("timeliness_status") == "on_time" else 0.0
    score = round((completeness * 0.5) + (validity * 0.35) + (timeliness * 0.15), 1)
    quality_status = "blocked" if blocking else "needs_review" if unresolved else "ready"
    return {
        "report_id": str(report["id"]),
        "village_id": str(report["village_id"]),
        "village_name": str(report.get("village_name") or report["village_id"]),
        "workflow_status": str(report.get("workflow_status", "draft")),
        "timeliness_status": str(report.get("timeliness_status", "not_submitted")),
        "quality_status": quality_status,
        "quality_score": score,
        "completeness_percent": completeness,
        "validity_percent": validity,
        "timeliness_percent": timeliness,
        "unresolved_flag_count": len(unresolved),
        "outlier_count": len(outliers),
        "lineage": {
            "report_source": str(report.get("report_source", "manual")),
            "report_version": int(report.get("version", 1)),
            "rule_version": RULE_VERSION,
        },
    }


def validate_maturity_scores(scores: dict[str, int]) -> dict[str, int]:
    if set(scores) != set(MATURITY_DIMENSIONS):
        raise ValueError("Scores must contain exactly the six maturity dimensions")
    normalized: dict[str, int] = {}
    for dimension, value in scores.items():
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
            raise ValueError(f"Score for {dimension} must be an integer from 1 to 5")
        normalized[dimension] = value
    return normalized


def build_safe_period_brief(period_name: str, snapshots: Iterable[dict[str, Any]]) -> tuple[str, list[dict[str, str]], float]:
    """Generate a citation-backed draft that excludes CT14 and all PII by design."""
    entries = list(snapshots)
    if not entries:
        return ("Chưa đủ dữ liệu để tạo tóm tắt. Hãy chọn kỳ có báo cáo được quyền xem.", [], 0.0)
    blocked = [item for item in entries if item["quality_status"] == "blocked"]
    late = [item for item in entries if item["timeliness_status"] == "late"]
    average = round(sum(float(item["quality_score"]) for item in entries) / len(entries), 1)
    content = (
        f"Bản nháp điều hành kỳ {period_name}: {len(entries)} báo cáo trong phạm vi được quyền xem, "
        f"điểm chất lượng trung bình {average}%. "
        f"Có {len(blocked)} báo cáo bị chặn bởi lỗi xác định và {len(late)} báo cáo nộp muộn. "
        "Đề nghị người có thẩm quyền rà soát danh sách việc trước khi giao hoặc công bố."
    )
    citations = [
        {"kind": "quality_snapshot", "id": item["report_id"], "label": f"{item['village_name']} · rule {item['lineage']['rule_version']}"}
        for item in entries
    ]
    confidence = 0.9 if all(item["quality_status"] == "ready" for item in entries) else 0.75
    return content, citations, confidence


__all__ = ["MATURITY_DIMENSIONS", "RULE_VERSION", "build_safe_period_brief", "quality_snapshot", "validate_maturity_scores"]
