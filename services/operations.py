"""Small, deterministic operations helpers.

This module intentionally does not call an LLM.  It turns already-authorized
report rows into quality evidence and safe draft text; an LLM may later explain
the same facts, but cannot decide validity, approval, publication, or writes.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date
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


def build_safe_period_brief(
    period_name: str,
    snapshots: Iterable[dict[str, Any]],
    *,
    actions: Iterable[dict[str, Any]] = (),
    as_of: date | None = None,
) -> tuple[str, list[dict[str, Any]], float]:
    """Generate a structured, citation-backed decision brief.

    Only aggregate quality and workflow facts are used. Indicator values,
    contact data and other PII are deliberately excluded. The result remains
    advisory: it describes evidence and a next review step but never approves,
    assigns or publishes anything.
    """
    entries = sorted(
        snapshots,
        key=lambda item: str(item.get("report_id", "")),
    )
    if not entries:
        return ("Chưa đủ dữ liệu để tạo tóm tắt. Hãy chọn kỳ có báo cáo được quyền xem.", [], 0.0)

    action_entries = list(actions)
    today = as_of or date.today()
    blocked = [item for item in entries if item["quality_status"] == "blocked"]
    needs_review = [
        item for item in entries if item["quality_status"] == "needs_review"
    ]
    ready = [item for item in entries if item["quality_status"] == "ready"]
    late = [item for item in entries if item["timeliness_status"] == "late"]
    open_actions = [
        item
        for item in action_entries
        if str(item.get("status")) not in {"completed", "cancelled"}
    ]
    overdue_actions = []
    for item in open_actions:
        due_value = item.get("due_date")
        if not due_value:
            continue
        try:
            if date.fromisoformat(str(due_value)[:10]) < today:
                overdue_actions.append(item)
        except ValueError:
            continue

    average = round(sum(float(item["quality_score"]) for item in entries) / len(entries), 1)

    if blocked:
        priority = "Khẩn"
        conclusion = (
            f"Chưa nên dùng toàn bộ dữ liệu kỳ {period_name} làm căn cứ quyết định: "
            f"{len(blocked)} báo cáo đã duyệt vẫn có lỗi chặn."
        )
        recommended_action = (
            "Phân công đối chiếu từng báo cáo có lỗi chặn với tài liệu nguồn, "
            "cập nhật kết quả kiểm tra rồi tạo lại bản tóm tắt."
        )
    elif overdue_actions:
        priority = "Khẩn"
        conclusion = (
            f"Cần xử lý {len(overdue_actions)} việc quá hạn trước khi mở thêm đầu việc "
            f"từ dữ liệu kỳ {period_name}."
        )
        recommended_action = (
            "Xác nhận người chịu trách nhiệm và mốc hoàn thành cho các việc quá hạn; "
            "ghi kết quả vào hàng việc."
        )
    elif needs_review or late:
        priority = "Cao"
        conclusion = (
            f"Dữ liệu kỳ {period_name} cần rà soát có trọng tâm trước khi sử dụng: "
            f"{len(needs_review)} báo cáo còn cảnh báo và {len(late)} báo cáo nộp muộn."
        )
        recommended_action = (
            "Mở danh sách báo cáo cần xem, đối chiếu cảnh báo và nguồn nhập; "
            "người có thẩm quyền quyết định chấp nhận hoặc yêu cầu bổ sung."
        )
    else:
        priority = "Theo dõi"
        conclusion = (
            f"{len(ready)}/{len(entries)} báo cáo đã duyệt của kỳ {period_name} "
            "đạt điều kiện chất lượng hiện hành."
        )
        recommended_action = (
            "Người có thẩm quyền xác nhận phạm vi và căn cứ trước khi dùng số liệu "
            "để giao việc hoặc công bố."
        )

    basis = (
        f"{len(entries)} báo cáo đã duyệt/khóa; điểm chất lượng trung bình {average}%; "
        f"{len(blocked)} lỗi chặn; {len(needs_review)} báo cáo còn cảnh báo; "
        f"{len(late)} báo cáo nộp muộn; {len(open_actions)} việc đang mở, "
        f"trong đó {len(overdue_actions)} việc quá hạn."
    )
    limitation = (
        "Chỉ tổng hợp trạng thái chất lượng, nguồn và tiến độ trong phạm vi được quyền xem; "
        "không đọc giá trị chỉ tiêu nhạy cảm, không tự phê duyệt, giao việc hoặc công bố."
    )
    content = "\n".join(
        (
            f"Kết luận: {conclusion}",
            f"Mức ưu tiên: {priority}",
            f"Hành động đề xuất: {recommended_action}",
            f"Căn cứ: {basis}",
            f"Giới hạn: {limitation}",
        )
    )
    citations = [
        {
            "kind": "quality_snapshot",
            "id": item["report_id"],
            "label": (
                f"{item['village_name']} · bộ quy tắc "
                f"{item['lineage']['rule_version']}"
            ),
            "village_name": item["village_name"],
            "workflow_status": item["workflow_status"],
            "quality_status": item["quality_status"],
            "quality_score": item["quality_score"],
            "unresolved_flag_count": item["unresolved_flag_count"],
            "outlier_count": item["outlier_count"],
            "timeliness_status": item["timeliness_status"],
            "report_source": item["lineage"]["report_source"],
            "report_version": item["lineage"]["report_version"],
            "rule_version": item["lineage"]["rule_version"],
        }
        for item in entries
    ]
    citations.append(
        {
            "kind": "decision_metrics",
            "id": f"period:{period_name}",
            "label": "Chỉ số tổng hợp dùng để tạo bản tóm tắt",
            "report_count": len(entries),
            "ready_report_count": len(ready),
            "average_quality_score": average,
            "blocked_report_count": len(blocked),
            "review_report_count": len(needs_review),
            "late_report_count": len(late),
            "open_action_count": len(open_actions),
            "overdue_action_count": len(overdue_actions),
            "generator_version": "deterministic-evidence-v2",
        }
    )
    ready_ratio = len(ready) / len(entries)
    confidence = round(
        min(1.0, max(0.0, (average / 100 * 0.7) + (ready_ratio * 0.3))),
        2,
    )
    return content, citations, confidence


__all__ = ["MATURITY_DIMENSIONS", "RULE_VERSION", "build_safe_period_brief", "quality_snapshot", "validate_maturity_scores"]
