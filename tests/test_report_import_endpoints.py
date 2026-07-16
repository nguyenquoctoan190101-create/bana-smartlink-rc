from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from main import create_app
from routers.auth import get_supabase_admin, require_admin_xa
from services.supabase_admin import SupabaseAdminError, UserProfile


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "xlsx"
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _admin_app(rest_side_effect):
    app = create_app()
    profile = UserProfile(
        id=str(uuid4()), role="admin_xa", village_id=None, force_password_reset=False
    )
    supabase = MagicMock()
    supabase.as_user.return_value = supabase
    supabase._rest_request = AsyncMock(side_effect=rest_side_effect)
    app.dependency_overrides[require_admin_xa] = lambda: profile
    app.dependency_overrides[get_supabase_admin] = lambda: supabase
    return app, profile, supabase


def test_batch_preview_requires_admin() -> None:
    app = create_app()
    client = TestClient(app)
    path = FIXTURES / "BC_T01_Thôn_Phú_Hòa_1.xlsx"
    with path.open("rb") as source:
        response = client.post("/report-imports/preview", files=[("files", (path.name, source, MIME))])
    assert response.status_code == 401


def test_batch_preview_returns_evidence_and_fails_closed_for_incomplete_fixture_set() -> None:
    app = create_app()
    app.dependency_overrides[require_admin_xa] = lambda: UserProfile(
        id=str(uuid4()), role="admin_xa", village_id=None, force_password_reset=False
    )
    client = TestClient(app)
    handles = []
    try:
        multipart = []
        for path in sorted(FIXTURES.glob("BC_T*.xlsx")):
            handle = path.open("rb")
            handles.append(handle)
            multipart.append(("files", (path.name, handle, MIME)))
        response = client.post("/report-imports/preview", files=multipart)
    finally:
        for handle in handles:
            handle.close()
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["mapping_version"] == "2026-07-15-infographic-v2"
    assert payload["uploaded_village_count"] == 19
    assert payload["missing_villages"] == ["Thôn Thạch Nham Tây", "Thôn Ninh An", "Thôn Sơn Phước"]
    assert payload["unresolved_villages"] == ["Thôn Đông Sơn"]
    assert payload["ready_for_review"] is True
    assert all(len(item["content_sha256"]) == 64 for item in payload["files"])


def test_create_batch_checks_period_scope_and_records_mapping_version() -> None:
    period_id = uuid4()
    async def rest(method, path, payload=None, prefer=None):
        if "user_profiles" in path:
            return [{"commune_id": "ba-na"}]
        if "report_periods" in path:
            return [{"id": str(period_id), "commune_id": "ba-na"}]
        assert method == "POST" and path == "/rest/v1/report_import_batches"
        assert payload["mapping_version"] == "2026-07-15-infographic-v2"
        assert payload["expected_village_count"] == 22
        return [{"id": str(uuid4()), **payload, "status": "draft"}]

    app, _, supabase = _admin_app(rest)
    response = TestClient(app).post(
        "/report-imports/batches",
        headers={"Authorization": "Bearer caller-jwt"},
        json={"period_id": str(period_id)},
    )
    assert response.status_code == 201, response.text
    assert response.json()["mapping_version"] == "2026-07-15-infographic-v2"
    supabase.as_user.assert_called_once_with("caller-jwt")


def test_create_batch_rejects_period_outside_commune() -> None:
    async def rest(method, path, payload=None, prefer=None):
        if "user_profiles" in path:
            return [{"commune_id": "ba-na"}]
        return [{"id": str(uuid4()), "commune_id": "other"}]

    app, _, _ = _admin_app(rest)
    response = TestClient(app).post(
        "/report-imports/batches",
        headers={"Authorization": "Bearer caller-jwt"},
        json={"period_id": str(uuid4())},
    )
    assert response.status_code == 404


def test_get_batch_summary_is_fail_closed_until_every_file_is_accepted() -> None:
    batch_id = uuid4()
    files = [
        {"source_village_name": "Thôn Phú Hòa 1", "mapping_status": "confirmed", "target_village_id": str(uuid4()), "review_status": "accepted"},
        {"source_village_name": "Thôn Đông Sơn", "mapping_status": "pending_official_decision", "target_village_id": None, "review_status": "pending"},
    ]
    async def rest(method, path, payload=None, prefer=None):
        if "report_import_batches" in path:
            return [{"id": str(batch_id), "expected_village_count": 22, "status": "review"}]
        return files

    app, _, _ = _admin_app(rest)
    response = TestClient(app).get(
        f"/report-imports/batches/{batch_id}", headers={"Authorization": "Bearer caller-jwt"}
    )
    assert response.status_code == 200, response.text
    summary = response.json()["summary"]
    assert summary["expected_village_count"] == 22
    assert summary["uploaded_village_count"] == 2
    assert summary["missing_village_count"] == 20
    assert summary["unresolved_villages"] == ["Thôn Đông Sơn"]
    assert summary["pending_review_villages"] == ["Thôn Đông Sơn"]
    assert summary["accepted_villages"] == ["Thôn Phú Hòa 1"]
    assert summary["ready_to_commit"] is False
    assert summary["eligible_target_villages"] == []


def test_get_batch_maps_supabase_failure_to_gateway_error() -> None:
    async def rest(method, path, payload=None, prefer=None):
        raise SupabaseAdminError("down", status_code=503)

    app, _, _ = _admin_app(rest)
    response = TestClient(app).get(
        f"/report-imports/batches/{uuid4()}", headers={"Authorization": "Bearer caller-jwt"}
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Unable to retrieve import batch"


def _valid_values(ct01: int = 100) -> dict[str, int]:
    return {
        "CT01": ct01, "CT02": 350, "CT03": 3, "CT04": 4,
        "CT05": 2, "CT06": 3, "CT07": 60, "CT08": 1,
        "CT09": 90, "CT10": 220, "CT11": 330, "CT12": 6,
        "CT13": 25, "CT14": 0,
    }


def test_review_file_reject_path_records_actor_without_mutating_values() -> None:
    file_id = uuid4()
    source = {"id": str(file_id), "mapping_status": "confirmed"}
    async def rest(method, path, payload=None, prefer=None):
        if method == "GET":
            return [source]
        assert method == "PATCH"
        assert payload["review_status"] == "rejected"
        assert payload["reviewed_by"]
        return [{**source, **payload}]

    app, profile, _ = _admin_app(rest)
    response = TestClient(app).patch(
        f"/report-imports/files/{file_id}/review",
        headers={"Authorization": "Bearer caller-jwt"},
        json={"decision": "rejected", "decision_reason": "Ranh giới chưa có quyết định chính thức."},
    )
    assert response.status_code == 200, response.text
    assert response.json()["review_status"] == "rejected"
    assert response.json()["reviewed_by"] == profile.id
    assert response.json()["review_reason"] == "Ranh giới chưa có quyết định chính thức."


def test_review_file_reject_requires_a_reason() -> None:
    file_id = uuid4()
    async def rest(method, path, payload=None, prefer=None):
        return [{"id": str(file_id), "mapping_status": "pending_official_decision"}]

    app, _, _ = _admin_app(rest)
    response = TestClient(app).patch(
        f"/report-imports/files/{file_id}/review",
        headers={"Authorization": "Bearer caller-jwt"},
        json={"decision": "rejected"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "A rejection reason is required"


def test_review_file_requires_resolution_reason_for_changed_value() -> None:
    file_id = uuid4()
    source = {
        "id": str(file_id), "mapping_status": "confirmed", "validation_flags": [],
        "normalized_values": _valid_values(99), "raw_values": _valid_values(99), "metadata": {},
    }
    async def rest(method, path, payload=None, prefer=None):
        return [source]

    app, _, _ = _admin_app(rest)
    response = TestClient(app).patch(
        f"/report-imports/files/{file_id}/review",
        headers={"Authorization": "Bearer caller-jwt"},
        json={"decision": "accepted", "values": _valid_values(100), "reasons": {}},
    )
    assert response.status_code == 422
    assert "review reason" in response.json()["detail"]


def test_review_file_accepts_corrected_values_and_writes_lineage_resolution() -> None:
    file_id = uuid4()
    source_values = _valid_values(99)
    source = {
        "id": str(file_id), "mapping_status": "confirmed", "validation_flags": [],
        "normalized_values": source_values, "raw_values": source_values, "metadata": {},
    }
    calls = []
    async def rest(method, path, payload=None, prefer=None):
        calls.append((method, path, payload, prefer))
        if method == "GET":
            return [source]
        if path == "/rest/v1/report_import_resolutions":
            return payload
        return [{**source, **payload}]

    app, _, _ = _admin_app(rest)
    response = TestClient(app).patch(
        f"/report-imports/files/{file_id}/review",
        headers={"Authorization": "Bearer caller-jwt"},
        json={
            "decision": "accepted", "values": _valid_values(100),
            "reasons": {"CT01": "Đối chiếu lại biểu giấy có chữ ký."},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["review_status"] == "accepted"
    resolution = next(call[2][0] for call in calls if call[1] == "/rest/v1/report_import_resolutions")
    assert resolution["ct_code"] == "CT01"
    assert resolution["accepted_value"] == 100
    assert resolution["decision"] == "corrected"


def test_phone_flag_requires_valid_replacement_and_audit_reason() -> None:
    file_id = uuid4()
    values = _valid_values()
    source = {
        "id": str(file_id), "mapping_status": "confirmed",
        "validation_flags": [{"ct_code": "PHONE", "error_type": "INVALID"}],
        "normalized_values": values, "raw_values": values, "metadata": {},
    }
    async def rest(method, path, payload=None, prefer=None):
        return [source]

    app, _, _ = _admin_app(rest)
    response = TestClient(app).patch(
        f"/report-imports/files/{file_id}/review",
        headers={"Authorization": "Bearer caller-jwt"},
        json={"decision": "accepted", "values": values, "reasons": {}, "reporter_phone": "BAD"},
    )
    assert response.status_code == 422
    assert "valid reporter phone" in response.json()["detail"]


def test_commit_batch_returns_rpc_result_and_conflict_is_redacted() -> None:
    batch_id = uuid4()
    async def ok(method, path, payload=None, prefer=None):
        assert path == "/rest/v1/rpc/commit_report_import_batch"
        assert UUID(payload["p_batch_id"]) == batch_id
        return [{"batch_id": str(batch_id), "reports_created": 10}]

    app, _, _ = _admin_app(ok)
    response = TestClient(app).post(
        f"/report-imports/batches/{batch_id}/commit", headers={"Authorization": "Bearer caller-jwt"}
    )
    assert response.status_code == 200
    assert response.json()["reports_created"] == 10

    async def conflict(method, path, payload=None, prefer=None):
        raise SupabaseAdminError("raw SQL detail", status_code=400)

    app, _, _ = _admin_app(conflict)
    response = TestClient(app).post(
        f"/report-imports/batches/{batch_id}/commit", headers={"Authorization": "Bearer caller-jwt"}
    )
    assert response.status_code == 409
    assert "raw SQL" not in response.text
