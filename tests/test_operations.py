from __future__ import annotations

from datetime import date
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from routers.operations import (
    ActionUpdateRequest,
    AiDraftCreateRequest,
    AiDraftReviewRequest,
    create_ai_draft,
)
from services.operations import build_safe_period_brief, quality_snapshot, validate_maturity_scores
from services.supabase_admin import UserProfile


def test_terminal_action_requires_a_recorded_outcome() -> None:
    with pytest.raises(ValidationError, match="completion result or cancellation reason"):
        ActionUpdateRequest(status="completed")
    with pytest.raises(ValidationError, match="completion result or cancellation reason"):
        ActionUpdateRequest(status="cancelled", outcome="  ")
    assert ActionUpdateRequest(status="completed", outcome="Đã kiểm tra hồ sơ").outcome == "Đã kiểm tra hồ sơ"


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
    content, citations, confidence = build_safe_period_brief(
        "Quý 3",
        [snapshot],
        actions=[
            {
                "id": "action-1",
                "status": "pending",
                "priority": "high",
                "due_date": "2026-07-01",
                "owner_phone": "0901234567",
            }
        ],
        as_of=date(2026, 7, 28),
    )
    assert "CT14" not in content
    assert "999" not in content
    assert "0901234567" not in content
    assert content.splitlines()[0].startswith("Kết luận:")
    assert "Mức ưu tiên: Khẩn" in content
    assert "Hành động đề xuất:" in content
    assert "Căn cứ:" in content
    assert "Giới hạn:" in content
    assert citations[0]["id"] == "r1"
    assert citations[0]["quality_score"] == snapshot["quality_score"]
    assert citations[-1]["generator_version"] == "deterministic-evidence-v2"
    assert citations[-1]["overdue_action_count"] == 1
    assert all("owner_phone" not in citation for citation in citations)
    assert confidence > 0


def test_reviewing_decision_brief_requires_meaningful_notes() -> None:
    with pytest.raises(ValidationError, match="at least 10"):
        AiDraftReviewRequest(decision="accepted", notes="Đồng ý")
    request = AiDraftReviewRequest(
        decision="rejected",
        notes="Cần đối chiếu lại nguồn báo cáo.",
    )
    assert request.notes == "Cần đối chiếu lại nguồn báo cáo."


class _FakeOperationsClient:
    def __init__(self, *, workflow_status: str = "approved") -> None:
        self.workflow_status = workflow_status
        self.latest_drafts: list[dict] = []
        self.calls: list[tuple[str, str, object, str | None]] = []

    def as_user(self, access_token: str) -> "_FakeOperationsClient":
        assert access_token == "caller-token"
        return self

    async def _rest_request(
        self,
        method: str,
        path: str,
        payload=None,
        prefer: str | None = None,
    ) -> list[dict]:
        self.calls.append((method, path, payload, prefer))
        if "user_profiles" in path:
            return [{"commune_id": "ba_na"}]
        if "report_periods" in path:
            return [{"id": "period-1", "name": "Tháng 7/2026", "commune_id": "ba_na"}]
        if "/rest/v1/reports?" in path:
            return [
                {
                    "id": "report-1",
                    "village_id": "village-1",
                    "workflow_status": self.workflow_status,
                    "timeliness_status": "on_time",
                    "report_source": "excel",
                    "version": 3,
                }
            ]
        if "report_values" in path:
            return [
                {"report_id": "report-1", "ct_code": f"CT{index:02d}", "value": index}
                for index in range(1, 15)
            ]
        if "report_validation_flags" in path:
            return []
        if "/rest/v1/villages?" in path:
            return [{"id": "village-1", "name": "Thôn An Sơn"}]
        if "/rest/v1/action_items?" in path:
            return [
                {
                    "id": "action-1",
                    "status": "pending",
                    "priority": "normal",
                    "due_date": None,
                }
            ]
        if method == "GET" and "/rest/v1/ai_action_drafts?" in path:
            return self.latest_drafts
        if method == "POST" and path == "/rest/v1/ai_action_drafts":
            row = {"id": "draft-1", **payload}
            self.latest_drafts = [
                {
                    "id": row["id"],
                    "status": "pending_review",
                    "content": row["content"],
                    "citations": row["citations"],
                }
            ]
            return [row]
        raise AssertionError(f"Unexpected request: {method} {path}")


@pytest.mark.asyncio
async def test_create_decision_brief_persists_structured_v2_evidence() -> None:
    client = _FakeOperationsClient()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)

    result = await create_ai_draft(
        AiDraftCreateRequest(period_id=UUID("11111111-1111-4111-8111-111111111111")),
        profile,
        client,  # type: ignore[arg-type]
        "Bearer caller-token",
    )

    assert result["model_provider"] == "deterministic-evidence-v2"
    assert "Kết luận:" in result["content"]
    assert "Hành động đề xuất:" in result["content"]
    assert result["citations"][0]["village_name"] == "Thôn An Sơn"
    assert result["citations"][-1]["generator_version"] == "deterministic-evidence-v2"
    assert all("value" not in citation for citation in result["citations"])


@pytest.mark.asyncio
async def test_create_decision_brief_rejects_unapproved_evidence() -> None:
    client = _FakeOperationsClient(workflow_status="submitted")
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)

    with pytest.raises(HTTPException) as caught:
        await create_ai_draft(
            AiDraftCreateRequest(period_id=UUID("11111111-1111-4111-8111-111111111111")),
            profile,
            client,  # type: ignore[arg-type]
            "Bearer caller-token",
        )

    assert caught.value.status_code == 409
    assert "Chưa có báo cáo đã duyệt" in str(caught.value.detail)
    assert not any(
        method == "POST" and path == "/rest/v1/ai_action_drafts"
        for method, path, _, _ in client.calls
    )


@pytest.mark.asyncio
async def test_create_decision_brief_blocks_pending_and_unchanged_duplicates() -> None:
    client = _FakeOperationsClient()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    request = AiDraftCreateRequest(
        period_id=UUID("11111111-1111-4111-8111-111111111111")
    )
    first = await create_ai_draft(
        request,
        profile,
        client,  # type: ignore[arg-type]
        "Bearer caller-token",
    )

    with pytest.raises(HTTPException) as pending:
        await create_ai_draft(
            request,
            profile,
            client,  # type: ignore[arg-type]
            "Bearer caller-token",
        )
    assert pending.value.status_code == 409
    assert "đang chờ duyệt" in str(pending.value.detail)

    client.latest_drafts = [
        {
            "id": first["id"],
            "status": "accepted",
            "content": first["content"],
            "citations": first["citations"],
        }
    ]
    with pytest.raises(HTTPException) as unchanged:
        await create_ai_draft(
            request,
            profile,
            client,  # type: ignore[arg-type]
            "Bearer caller-token",
        )
    assert unchanged.value.status_code == 409
    assert "Căn cứ chưa thay đổi" in str(unchanged.value.detail)


def test_maturity_requires_exact_six_contextual_dimensions() -> None:
    valid = {key: 3 for key in ("strategy", "process", "data", "people", "security", "governance")}
    assert validate_maturity_scores(valid) == valid
    try:
        validate_maturity_scores({"strategy": 3})
    except ValueError as exc:
        assert "exactly" in str(exc)
    else:
        raise AssertionError("Partial maturity score should be rejected")
