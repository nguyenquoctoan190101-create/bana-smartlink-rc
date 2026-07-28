from __future__ import annotations

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from main import app
from routers.auth import get_settings, get_supabase_admin
from routers.operations import (
    ActionUpdateRequest,
    AiDraftCreateRequest,
    AiDraftReviewRequest,
    create_ai_draft,
    get_quality_center,
    list_ai_drafts,
    list_actions,
    review_ai_draft,
    _present_action_queue,
)
from services.decision_ai import DecisionAiAttempt
from services.operations import build_safe_period_brief, quality_snapshot, validate_maturity_scores
from services.settings import Settings
from services.supabase_admin import SupabaseAdminError, UserProfile


def test_terminal_action_requires_a_recorded_outcome() -> None:
    with pytest.raises(ValidationError, match="completion result or cancellation reason"):
        ActionUpdateRequest(status="completed")
    with pytest.raises(ValidationError, match="completion result or cancellation reason"):
        ActionUpdateRequest(status="cancelled", outcome="  ")
    assert ActionUpdateRequest(status="completed", outcome="Đã kiểm tra hồ sơ").outcome == "Đã kiểm tra hồ sơ"


def test_action_queue_contract_orders_work_and_exposes_accountability() -> None:
    owner_id = "11111111-1111-4111-8111-111111111111"
    profile = UserProfile(
        owner_id,
        "can_bo_thon",
        "village-1",
        False,
        display_name="Nguyễn Văn An",
    )
    rows = [
        {
            "id": "33333333-3333-4333-8333-333333333333",
            "source_type": "trend_alert",
            "source_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "title": "Việc sắp đến hạn",
            "priority": "critical",
            "status": "pending",
            "owner_id": None,
            "due_date": "2026-07-30",
            "created_at": "2026-07-28T10:00:00+07:00",
        },
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "manual",
            "source_id": None,
            "title": "Việc đến hạn hôm nay",
            "priority": "normal",
            "status": "in_progress",
            "owner_id": owner_id,
            "owner": {"display_name": "Nguyễn Văn An"},
            "due_date": "2026-07-29",
            "created_at": "2026-07-25T23:30:00+07:00",
        },
        {
            "id": "11111111-2222-4111-8111-111111111111",
            "source_type": "proposal",
            "source_id": None,
            "title": "Việc quá hạn",
            "priority": "high",
            "status": "pending",
            "owner_id": owner_id,
            "due_date": "2026-07-27",
            "created_at": "2026-07-24T20:00:00Z",
        },
    ]

    result = _present_action_queue(
        rows,
        profile,
        now=datetime(2026, 7, 29, 1, tzinfo=timezone.utc),
    )

    assert [item.title for item in result] == [
        "Việc quá hạn",
        "Việc đến hạn hôm nay",
        "Việc sắp đến hạn",
    ]
    assert result[0].due_state == "overdue"
    assert result[0].owner_label == "Nguyễn Văn An"
    assert result[0].age_days == 4
    assert result[0].evidence_status == "missing"
    assert result[0].can_update is True
    assert result[0].next_action == "start"
    assert result[1].due_state == "due_today"
    assert result[1].evidence_status == "manual"
    assert result[1].next_action == "complete"
    assert result[2].owner_label == "Chưa phân công"
    assert result[2].evidence_status == "linked"
    assert result[2].can_update is False
    assert result[2].next_action is None
    leader_result = _present_action_queue(
        rows,
        UserProfile(owner_id, "lanh_dao", None, False),
        now=datetime(2026, 7, 29, 1, tzinfo=timezone.utc),
    )
    assert all(item.can_update is False for item in leader_result)
    assert all(item.next_action is None for item in leader_result)


class _FakeActionQueueClient:
    def __init__(self) -> None:
        self.path = ""

    def as_user(self, access_token: str) -> "_FakeActionQueueClient":
        assert access_token == "caller-token"
        return self

    async def _rest_request(self, method: str, path: str) -> list[dict]:
        assert method == "GET"
        self.path = path
        return [
            {
                "id": "11111111-2222-4111-8111-111111111111",
                "source_type": "manual",
                "source_id": None,
                "title": "Đối chiếu hồ sơ",
                "priority": "normal",
                "status": "pending",
                "owner_id": None,
                "due_date": None,
                "created_at": "2026-07-29T00:00:00Z",
            }
        ]


@pytest.mark.asyncio
async def test_action_queue_endpoint_uses_minimized_explicit_selection() -> None:
    client = _FakeActionQueueClient()
    profile = UserProfile(str(uuid4()), "lanh_dao", None, False)
    period_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")

    result = await list_actions(
        period_id,
        profile,
        client,  # type: ignore[arg-type]
        "Bearer caller-token",
    )

    assert len(result) == 1
    assert "select=*" not in client.path
    assert "owner:user_profiles!action_items_owner_id_fkey(display_name)" in client.path
    assert f"period_id=eq.{period_id}" in client.path


def test_quality_snapshot_preserves_missing_values_and_blocks_deterministic_errors() -> None:
    result = quality_snapshot(
        {"id": "r1", "village_id": "v1", "village_name": "Thôn A", "timeliness_status": "late", "report_source": "excel", "version": 3},
        [{"ct_code": "CT01", "value": 10}, {"ct_code": "CT04", "value": None}],
        [{"ct_code": "CT04", "error_type": "BLANK", "resolved": False}],
    )
    assert result["completeness_percent"] == round(100 / 14, 1)
    assert result["completeness_numerator"] == 1
    assert result["completeness_denominator"] == 14
    assert result["blocking_flag_count"] == 1
    assert "quality_score" not in result
    assert result["quality_status"] == "blocked"
    assert result["lineage"] == {"report_source": "excel", "report_version": 3, "rule_version": "2026-07-29"}


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
    assert "đầy đủ 1/14 trường" in content
    assert "điểm chất lượng" not in content
    assert citations[0]["id"] == "r1"
    assert citations[0]["completeness_numerator"] == 1
    assert citations[0]["completeness_denominator"] == 14
    assert "quality_score" not in citations[0]
    assert citations[-1]["generator_version"] == "deterministic-evidence-v3"
    assert citations[-1]["complete_field_count"] == 1
    assert citations[-1]["expected_field_count"] == 14
    assert citations[-1]["blocking_flag_count"] == 0
    assert citations[-1]["overdue_action_count"] == 1
    assert all("owner_phone" not in citation for citation in citations)
    assert confidence == 0


def test_reviewing_decision_brief_requires_meaningful_notes() -> None:
    with pytest.raises(ValidationError, match="at least 10"):
        AiDraftReviewRequest(decision="accepted", notes="Đồng ý")
    request = AiDraftReviewRequest(
        decision="rejected",
        notes="Cần đối chiếu lại nguồn báo cáo.",
    )
    assert request.notes == "Cần đối chiếu lại nguồn báo cáo."


class _FakeOperationsClient:
    def __init__(
        self,
        *,
        workflow_status: str = "approved",
        create_error: SupabaseAdminError | None = None,
    ) -> None:
        self.workflow_status = workflow_status
        self.create_error = create_error
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
            if "status=eq.accepted" in path:
                return [
                    draft
                    for draft in self.latest_drafts
                    if draft.get("status") == "accepted"
                ]
            return self.latest_drafts
        if method == "POST" and path == "/rest/v1/ai_action_drafts":
            if self.create_error is not None:
                raise self.create_error
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
async def test_quality_endpoint_exposes_three_dimensions_without_composite_score() -> None:
    client = _FakeOperationsClient()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)

    result = await get_quality_center(
        UUID("11111111-1111-4111-8111-111111111111"),
        profile,
        client,  # type: ignore[arg-type]
        "Bearer caller-token",
    )

    assert result["rule_version"] == "2026-07-29"
    assert "average_quality_score" not in result
    assert len(result["reports"]) == 1
    report = result["reports"][0]
    assert report["completeness_numerator"] == 14
    assert report["completeness_denominator"] == 14
    assert report["validity_percent"] == 100
    assert report["blocking_flag_count"] == 0
    assert report["timeliness_percent"] == 100
    assert "quality_score" not in report


def test_leader_can_list_but_cannot_create_decision_drafts() -> None:
    leader = UserProfile(
        str(uuid4()),
        "lanh_dao",
        None,
        False,
        commune_id="ba_na",
    )
    supabase = _FakeOperationsClient()
    supabase.latest_drafts = [
        {
            "id": "draft-pending",
            "status": "pending_review",
            "content": "Unreviewed decision support.",
            "citations": [],
        },
        {
            "id": "draft-accepted",
            "status": "accepted",
            "content": "Reviewed decision support.",
            "citations": [],
            "reviewed_by": "admin-1",
            "reviewed_at": "2026-07-28T10:00:00Z",
            "review_notes": "Evidence was checked by the administrator.",
        },
        {
            "id": "draft-legacy-accepted",
            "status": "accepted",
            "content": "Legacy review without notes.",
            "citations": [],
            "reviewed_by": "admin-1",
            "reviewed_at": "2026-07-20T10:00:00Z",
            "review_notes": None,
        },
        {
            "id": "draft-short-note-accepted",
            "status": "accepted",
            "content": "Legacy review with a short note.",
            "citations": [],
            "reviewed_by": "admin-1",
            "reviewed_at": "2026-07-21T10:00:00Z",
            "review_notes": "too short",
        },
        {
            "id": "draft-rejected",
            "status": "rejected",
            "content": "Rejected decision support.",
            "citations": [],
        },
    ]

    async def get_user_profile(user_id: str) -> UserProfile:
        assert user_id == leader.id
        return leader

    supabase.get_user_profile = get_user_profile  # type: ignore[attr-defined]
    settings = Settings(
        _env_file=None,
        supabase_jwt_secret="test-secret",
        mfa_enforcement_enabled=False,
    )
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_supabase_admin] = lambda: supabase
    try:
        with patch(
            "routers.auth.verify_supabase_jwt",
            return_value={"sub": leader.id, "aal": "aal1"},
        ), TestClient(app) as client:
            headers = {"Authorization": "Bearer caller-token"}
            listed = client.get("/api/operations/ai-drafts", headers=headers)
            created = client.post(
                "/api/operations/ai-drafts",
                headers=headers,
                json={
                    "period_id": "11111111-1111-4111-8111-111111111111",
                    "kind": "period_brief",
                },
            )
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)

    assert listed.status_code == 200
    assert [draft["id"] for draft in listed.json()] == ["draft-accepted"]
    assert any(
        method == "GET"
        and path
        == (
            "/rest/v1/ai_action_drafts?select=*"
            "&status=eq.accepted"
            "&reviewed_by=not.is.null"
            "&reviewed_at=not.is.null"
            "&review_notes=not.is.null"
            "&order=created_at.desc"
        )
        for method, path, _, _ in supabase.calls
    )
    assert created.status_code == 403
    assert created.json()["message"] == "Only admin_xa can access this resource"
    assert not any(
        method == "POST" and path == "/rest/v1/ai_action_drafts"
        for method, path, _, _ in supabase.calls
    )


@pytest.mark.asyncio
async def test_admin_lists_decision_drafts_without_status_filter() -> None:
    client = _FakeOperationsClient()
    client.latest_drafts = [
        {"id": "draft-pending", "status": "pending_review"},
        {"id": "draft-accepted", "status": "accepted"},
        {"id": "draft-rejected", "status": "rejected"},
    ]
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)

    result = await list_ai_drafts(
        profile,
        client,  # type: ignore[arg-type]
        "Bearer caller-token",
    )

    assert [draft["status"] for draft in result] == [
        "pending_review",
        "accepted",
        "rejected",
    ]
    assert client.calls == [
        (
            "GET",
            "/rest/v1/ai_action_drafts?select=*&order=created_at.desc",
            None,
            None,
        )
    ]


@pytest.mark.asyncio
async def test_create_decision_brief_persists_structured_v3_evidence() -> None:
    client = _FakeOperationsClient()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)

    result = await create_ai_draft(
        AiDraftCreateRequest(period_id=UUID("11111111-1111-4111-8111-111111111111")),
        profile,
        client,  # type: ignore[arg-type]
        "Bearer caller-token",
    )

    assert result["model_provider"] == "deterministic-evidence-v3"
    assert "Kết luận:" in result["content"]
    assert "Hành động đề xuất:" in result["content"]
    assert result["citations"][0]["village_name"] == "Thôn An Sơn"
    assert result["citations"][-1]["generator_version"] == "deterministic-evidence-v3"
    assert all("value" not in citation for citation in result["citations"])


@pytest.mark.asyncio
async def test_create_decision_brief_maps_pending_unique_conflict_to_409() -> None:
    client = _FakeOperationsClient(
        create_error=SupabaseAdminError(
            "duplicate row details must stay private",
            status_code=409,
            error_code="23505",
        )
    )
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)

    with pytest.raises(HTTPException) as caught:
        await create_ai_draft(
            AiDraftCreateRequest(
                period_id=UUID("11111111-1111-4111-8111-111111111111")
            ),
            profile,
            client,  # type: ignore[arg-type]
            "Bearer caller-token",
        )

    assert caught.value.status_code == 409
    assert "đang chờ duyệt" in str(caught.value.detail)
    assert "duplicate row details" not in str(caught.value.detail)
    assert caught.value.__context__ is None


@pytest.mark.asyncio
async def test_review_decision_brief_leaves_reviewer_and_time_to_database() -> None:
    class _ReviewClient:
        def __init__(self) -> None:
            self.payload: dict | None = None

        def as_user(self, access_token: str) -> "_ReviewClient":
            assert access_token == "caller-token"
            return self

        async def _rest_request(
            self,
            method: str,
            path: str,
            payload=None,
            prefer: str | None = None,
        ) -> list[dict]:
            assert method == "PATCH"
            assert "status=eq.pending_review" in path
            assert prefer == "return=representation"
            self.payload = payload
            return [{"id": "draft-1", **payload}]

    client = _ReviewClient()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    result = await review_ai_draft(
        UUID("11111111-1111-4111-8111-111111111111"),
        AiDraftReviewRequest(
            decision="accepted",
            notes="Đủ căn cứ để dùng làm tài liệu tham khảo.",
        ),
        profile,
        client,  # type: ignore[arg-type]
        "Bearer caller-token",
    )

    assert result["status"] == "accepted"
    assert client.payload == {
        "status": "accepted",
        "review_notes": "Đủ căn cứ để dùng làm tài liệu tham khảo.",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error_code", "upstream_status", "expected_status"),
    [
        ("42501", 400, 403),
        (None, 401, 403),
        (None, 403, 403),
        ("23514", 400, 409),
        (None, None, 503),
        ("XX000", 500, 503),
    ],
)
async def test_review_decision_brief_maps_and_redacts_database_error_context(
    error_code: str | None,
    upstream_status: int | None,
    expected_status: int,
) -> None:
    class _ReviewErrorClient:
        def as_user(self, access_token: str) -> "_ReviewErrorClient":
            assert access_token == "caller-token"
            return self

        async def _rest_request(self, *args, **kwargs) -> list[dict]:
            raise SupabaseAdminError(
                "private provider response",
                status_code=upstream_status,
                error_code=error_code,
            )

    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    with pytest.raises(HTTPException) as caught:
        await review_ai_draft(
            UUID("11111111-1111-4111-8111-111111111111"),
            AiDraftReviewRequest(
                decision="accepted",
                notes="Đủ căn cứ để dùng làm tài liệu tham khảo.",
            ),
            profile,
            _ReviewErrorClient(),  # type: ignore[arg-type]
            "Bearer caller-token",
        )

    assert caught.value.status_code == expected_status
    assert "private provider response" not in str(caught.value.detail)
    assert caught.value.__context__ is None


@pytest.mark.asyncio
async def test_create_decision_brief_persists_grounded_ai_enrichment() -> None:
    client = _FakeOperationsClient()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    attempt = DecisionAiAttempt(
        status="enhanced",
        model_provider="openai-responses:gpt-5.6-sol",
        citation={
            "kind": "ai_enrichment",
            "id": "decision-ai-analysis",
            "status": "grounded",
            "analysis": {"executive_assessment": "Cần rà soát nguồn."},
        },
    )
    settings = Settings(
        _env_file=None,
        feature_decision_ai=True,
        decision_ai_provider="openai",
        openai_api_key="test-key",
    )
    with patch("routers.operations.get_settings", return_value=settings), patch(
        "routers.operations.enrich_decision_brief",
        new=AsyncMock(return_value=attempt),
    ):
        result = await create_ai_draft(
            AiDraftCreateRequest(
                period_id=UUID("11111111-1111-4111-8111-111111111111")
            ),
            profile,
            client,  # type: ignore[arg-type]
            "Bearer caller-token",
        )

    assert result["model_provider"] == "openai-responses:gpt-5.6-sol"
    assert result["citations"][-1]["kind"] == "ai_enrichment"
    assert result["citations"][-1]["status"] == "grounded"


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
            "content": "Cách diễn đạt AI có thể thay đổi nhưng căn cứ không đổi.",
            "citations": [
                *first["citations"],
                {
                    "kind": "ai_enrichment",
                    "id": "decision-ai-analysis",
                    "analysis": {"executive_assessment": "Nội dung khác"},
                },
            ],
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
