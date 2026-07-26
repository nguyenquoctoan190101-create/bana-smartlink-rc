from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import create_app
from routers.auth import (
    require_admin_or_leader,
    require_admin_xa,
    require_lanh_dao,
)
from routers.reports import get_report_repository
from services.supabase_admin import SupabaseAdminError, UserProfile


def _profile(role: str) -> UserProfile:
    return UserProfile(
        id=str(uuid4()),
        role=role,
        village_id=None,
        force_password_reset=False,
        display_name="Người kiểm thử",
    )


def _client(dependency, profile: UserProfile, supabase) -> TestClient:
    app = create_app()
    app.dependency_overrides[dependency] = lambda: profile
    app.dependency_overrides[get_report_repository] = lambda: SimpleNamespace(
        _supabase=supabase
    )
    return TestClient(app)


def test_admin_creates_update_request_with_reason_and_proposal() -> None:
    period_id = uuid4()
    village_id = uuid4()
    supabase = SimpleNamespace(
        _rest_request=AsyncMock(return_value=[{"id": str(uuid4())}])
    )
    client = _client(require_admin_xa, _profile("admin_xa"), supabase)

    response = client.post(
        f"/report-periods/{period_id}/change-requests",
        json={
            "request_kind": "update",
            "reason": "Điều chỉnh theo văn bản rà soát đã ký.",
            "proposed_name": "Tháng 08/2026",
            "proposed_due_date": "2026-08-31T17:00:00+07:00",
            "proposed_village_ids": [str(village_id)],
        },
    )

    assert response.status_code == 201, response.text
    call = supabase._rest_request.await_args
    assert call.args[:2] == (
        "POST",
        "/rest/v1/rpc/create_report_period_change_request",
    )
    assert call.args[2]["p_period_id"] == str(period_id)
    assert call.args[2]["p_reason"].startswith("Điều chỉnh")
    assert call.args[2]["p_proposed_village_ids"] == [str(village_id)]


def test_delete_request_rejects_proposed_update_fields() -> None:
    supabase = SimpleNamespace(_rest_request=AsyncMock())
    client = _client(require_admin_xa, _profile("admin_xa"), supabase)
    response = client.post(
        f"/report-periods/{uuid4()}/change-requests",
        json={
            "request_kind": "delete",
            "reason": "Kỳ được lập trùng và cần lưu trữ.",
            "proposed_name": "Tên không hợp lệ cho yêu cầu xóa",
        },
    )
    assert response.status_code == 422
    supabase._rest_request.assert_not_awaited()


def test_leader_decides_request_with_recorded_reason() -> None:
    request_id = uuid4()
    supabase = SimpleNamespace(
        _rest_request=AsyncMock(return_value=[{"id": str(uuid4()), "decision": "approved"}])
    )
    client = _client(require_lanh_dao, _profile("lanh_dao"), supabase)
    response = client.post(
        f"/report-periods/change-requests/{request_id}/decision",
        json={"decision": "approved", "reason": "Đủ căn cứ và đúng phạm vi."},
    )
    assert response.status_code == 200, response.text
    assert supabase._rest_request.await_args.args == (
        "POST",
        "/rest/v1/rpc/decide_report_period_change_request",
        {
            "p_request_id": str(request_id),
            "p_decision": "approved",
            "p_reason": "Đủ căn cứ và đúng phạm vi.",
        },
    )


def test_list_change_requests_joins_decision_and_actor_names() -> None:
    request_id = str(uuid4())
    period_id = str(uuid4())
    admin_id = str(uuid4())
    leader_id = str(uuid4())
    supabase = SimpleNamespace(
        _rest_request=AsyncMock(
            side_effect=[
                [{
                    "id": request_id,
                    "period_id": period_id,
                    "request_kind": "delete",
                    "reason": "Kỳ trùng cần lưu trữ.",
                    "before_snapshot": {"name": "Kỳ trùng", "due_date": "2026-08-01T00:00:00Z", "village_ids": []},
                    "proposed_snapshot": None,
                    "requested_by": admin_id,
                    "requested_at": "2026-07-26T00:00:00Z",
                }],
                [{
                    "id": str(uuid4()),
                    "request_id": request_id,
                    "decision": "rejected",
                    "reason": "Cần đối chiếu thêm.",
                    "decided_by": leader_id,
                    "decided_at": "2026-07-26T01:00:00Z",
                }],
                [
                    {"id": admin_id, "display_name": "Quản trị xã"},
                    {"id": leader_id, "display_name": "Lãnh đạo xã"},
                ],
                [{"id": period_id, "name": "Kỳ trùng", "archived_at": None}],
            ]
        )
    )
    client = _client(require_admin_or_leader, _profile("lanh_dao"), supabase)
    response = client.get("/report-periods/change-requests")
    assert response.status_code == 200, response.text
    row = response.json()[0]
    assert row["status"] == "rejected"
    assert row["requester_name"] == "Quản trị xã"
    assert row["decision"]["decider_name"] == "Lãnh đạo xã"


def test_pending_request_conflict_is_exposed_as_http_409() -> None:
    supabase = SimpleNamespace(
        _rest_request=AsyncMock(
            side_effect=SupabaseAdminError(
                "period_change_request_pending",
                status_code=409,
                error_code="23505",
            )
        )
    )
    client = _client(require_admin_xa, _profile("admin_xa"), supabase)
    response = client.post(
        f"/report-periods/{uuid4()}/change-requests",
        json={
            "request_kind": "delete",
            "reason": "Kỳ này đang có yêu cầu chờ duyệt.",
        },
    )
    assert response.status_code == 409


def test_leader_dependency_rejects_every_other_role() -> None:
    for role in ("admin_xa", "can_bo_thon", "to_cnscd"):
        with pytest.raises(HTTPException) as error:
            asyncio.run(require_lanh_dao(_profile(role)))
        assert error.value.status_code == 403
