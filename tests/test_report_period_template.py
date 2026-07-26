from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from main import create_app
from routers.auth import require_admin_xa, require_authenticated_user
from routers.reports import get_report_repository
from services.supabase_admin import UserProfile


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "xlsx" / "BC_T01_Thôn_Phú_Hòa_1.xlsx"
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _admin() -> UserProfile:
    return UserProfile(
        id=str(uuid4()),
        role="admin_xa",
        village_id=None,
        force_password_reset=False,
    )


def test_template_upload_persists_private_object_and_hash_metadata() -> None:
    period_id = uuid4()
    content = FIXTURE.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    supabase = SimpleNamespace()
    supabase.upload_storage_object = AsyncMock(return_value=None)
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": str(period_id), "commune_id": "ba-na"}],
        [{"id": str(period_id)}],
    ])

    app = create_app()
    app.dependency_overrides[require_admin_xa] = _admin
    app.dependency_overrides[get_report_repository] = lambda: SimpleNamespace(_supabase=supabase)
    try:
        client = TestClient(app)
        response = client.post(
            f"/report-periods/{period_id}/template",
            files={"file": (FIXTURE.name, content, MIME)},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["period_id"] == str(period_id)
    assert payload["template_sha256"] == digest
    assert payload["template_size_bytes"] == len(content)
    assert payload["template_path"] == f"ba-na/{period_id}/{digest}.xlsx"
    supabase.upload_storage_object.assert_awaited_once_with(
        "report-templates",
        payload["template_path"],
        content,
        MIME,
    )
    rpc_call = supabase._rest_request.await_args_list[1]
    assert rpc_call.args[:2] == (
        "POST",
        "/rest/v1/rpc/attach_report_period_template",
    )
    assert rpc_call.args[2]["p_template_sha256"] == digest


def test_template_upload_rejects_non_xlsx_before_storage() -> None:
    app = create_app()
    app.dependency_overrides[require_admin_xa] = _admin
    app.dependency_overrides[get_report_repository] = lambda: SimpleNamespace(_supabase=SimpleNamespace())
    try:
        client = TestClient(app)
        response = client.post(
            f"/report-periods/{uuid4()}/template",
            files={"file": ("template.txt", b"not a workbook", "text/plain")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_period_list_includes_the_explicit_village_scope() -> None:
    supabase = SimpleNamespace()
    supabase._rest_request = AsyncMock(return_value=[{
        "id": "period-1",
        "name": "Tháng 7/2026",
        "due_date": "2026-07-31T17:00:00+07:00",
        "report_period_villages": [{"village_id": "village-1"}, {"village_id": "village-2"}],
    }])
    app = create_app()
    app.dependency_overrides[require_authenticated_user] = _admin
    app.dependency_overrides[get_report_repository] = lambda: SimpleNamespace(_supabase=supabase)
    try:
        client = TestClient(app)
        response = client.get("/report-periods")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert response.json()[0]["village_ids"] == ["village-1", "village-2"]
    assert "report_period_villages(village_id)" in supabase._rest_request.await_args.args[1]
    assert "archived_at=is.null" in supabase._rest_request.await_args.args[1]
