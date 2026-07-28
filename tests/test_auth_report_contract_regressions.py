from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from main import app
from routers.auth import (
    get_settings,
    get_supabase_admin,
    require_admin_xa,
    require_authenticated_user,
)
from routers.reports import get_report_repository
from services.settings import Settings
from services.supabase_admin import SupabaseAdminError, UserProfile


JWT_SECRET = "endpoint-test-jwt-secret-with-at-least-32-bytes"


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _jwt(user_id: str) -> str:
    header = _b64url(json.dumps({"alg": "HS256"}).encode("utf-8"))
    payload = _b64url(
        json.dumps({"sub": user_id, "exp": int(time.time()) + 300}).encode("utf-8")
    )
    signature = hmac.new(
        JWT_SECRET.encode("utf-8"),
        f"{header}.{payload}".encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{header}.{payload}.{_b64url(signature)}"


class _FakeUserClient:
    def __init__(self, events: list[tuple], fail_password: bool = False) -> None:
        self.events = events
        self.fail_password = fail_password

    async def update_current_user_password(self, password: str) -> None:
        self.events.append(("password", password))
        if self.fail_password:
            raise SupabaseAdminError("provider failure")


class _FakeAdminClient:
    def __init__(
        self,
        profile: UserProfile,
        *,
        fail_password: bool = False,
        fail_profile_update: bool = False,
        fail_assignments: bool = False,
        village_valid: bool = True,
    ) -> None:
        self.profile = profile
        self.events: list[tuple] = []
        self.access_token: str | None = None
        self.user_client = _FakeUserClient(self.events, fail_password)
        self.fail_profile_update = fail_profile_update
        self.fail_assignments = fail_assignments
        self.village_valid = village_valid

    async def get_user_profile(self, user_id: str) -> UserProfile | None:
        assert user_id == self.profile.id
        return self.profile

    def as_user(self, access_token: str) -> _FakeUserClient:
        self.access_token = access_token
        return self.user_client

    async def update_user_profile_force_reset(self, user_id: str, value: bool) -> None:
        self.events.append(("force_password_reset", user_id, value))
        if self.fail_profile_update:
            raise SupabaseAdminError("profile failure")

    async def create_auth_user(self, **kwargs) -> str:
        self.events.append(("create_auth_user", kwargs))
        return str(uuid4())

    async def village_in_commune(self, village_id: str, commune_id: str) -> bool:
        self.events.append(("village_in_commune", village_id, commune_id))
        return self.village_valid

    async def create_user_profile(self, **kwargs) -> UserProfile:
        self.events.append(("create_user_profile", kwargs))
        return UserProfile(
            id=kwargs["user_id"],
            role=kwargs["role"],
            village_id=kwargs["village_id"],
            force_password_reset=kwargs["force_password_reset"],
            display_name=kwargs["display_name"],
            phone=kwargs["phone"],
            commune_id=kwargs["commune_id"],
        )

    async def create_user_village_assignments(
        self,
        user_id: str,
        village_ids: list[str],
        assigned_by: str,
    ) -> None:
        self.events.append(
            (
                "create_user_village_assignments",
                {
                    "user_id": user_id,
                    "village_ids": village_ids,
                    "assigned_by": assigned_by,
                },
            )
        )
        if self.fail_assignments:
            raise SupabaseAdminError("assignment failure")

    async def delete_auth_user(self, user_id: str) -> None:
        self.events.append(("delete_auth_user", user_id))


@contextmanager
def _client_with_admin(admin: _FakeAdminClient):
    previous = app.dependency_overrides.copy()
    settings = Settings(
        _env_file=None,
        supabase_jwt_secret=JWT_SECRET,
        supabase_jwt_audience="",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_supabase_admin] = lambda: admin
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_change_password_allows_forced_reset_and_returns_empty_204() -> None:
    user_id = str(uuid4())
    admin = _FakeAdminClient(
        UserProfile(
            id=user_id,
            role="can_bo_thon",
            village_id=str(uuid4()),
            force_password_reset=True,
        )
    )
    token = _jwt(user_id)
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/change-password",
            json={"new_password": "A-strong-password9"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 204
    assert response.content == b""
    assert "content-type" not in response.headers
    assert admin.access_token == token
    assert admin.events == [
        ("password", "A-strong-password9"),
        ("force_password_reset", user_id, False),
    ]


def test_change_password_rejects_weak_password_before_provider_mutation() -> None:
    user_id = str(uuid4())
    admin = _FakeAdminClient(
        UserProfile(user_id, "can_bo_thon", str(uuid4()), True)
    )
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/change-password",
            json={"new_password": "onlylowercase"},
            headers={"Authorization": f"Bearer {_jwt(user_id)}"},
        )
    assert response.status_code == 422
    assert admin.events == []


def test_change_password_never_clears_flag_when_auth_provider_rejects_password() -> None:
    user_id = str(uuid4())
    admin = _FakeAdminClient(
        UserProfile(user_id, "can_bo_thon", str(uuid4()), True),
        fail_password=True,
    )
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/change-password",
            json={"new_password": "A-strong-password9"},
            headers={"Authorization": f"Bearer {_jwt(user_id)}"},
        )
    assert response.status_code == 502
    assert admin.events == [("password", "A-strong-password9")]


def test_change_password_blocks_inactive_user() -> None:
    user_id = str(uuid4())
    admin = _FakeAdminClient(
        UserProfile(user_id, "can_bo_thon", str(uuid4()), True, is_active=False)
    )
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/change-password",
            json={"new_password": "A-strong-password9"},
            headers={"Authorization": f"Bearer {_jwt(user_id)}"},
        )
    assert response.status_code == 403
    assert admin.events == []


def test_create_staff_account_normalizes_and_persists_phone_in_both_records() -> None:
    admin_id = str(uuid4())
    village_id = str(uuid4())
    admin = _FakeAdminClient(UserProfile(admin_id, "admin_xa", None, False))
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/staff-users",
            json={
                "email": "officer@example.gov.vn",
                "display_name": "Nguyễn Văn A",
                "phone": "+84901234567",
                "role": "can_bo_thon",
                "village_id": village_id,
            },
            headers={"Authorization": f"Bearer {_jwt(admin_id)}"},
        )
    assert response.status_code == 201
    create_auth = next(event[1] for event in admin.events if event[0] == "create_auth_user")
    create_profile = next(event[1] for event in admin.events if event[0] == "create_user_profile")
    assert create_auth["phone"] == "0901234567"
    assert create_profile["phone"] == "0901234567"
    assert create_profile["display_name"] == "Nguyễn Văn A"
    assert create_profile["commune_id"] == "ba_na"
    assert response.json()["scope"] == "single_village"
    assert response.json()["village_ids"] == [village_id]


def test_create_cnscd_account_persists_all_explicit_village_assignments() -> None:
    admin_id = str(uuid4())
    village_ids = [str(uuid4()), str(uuid4())]
    admin = _FakeAdminClient(
        UserProfile(admin_id, "admin_xa", None, False, commune_id="ba_na")
    )
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/staff-users",
            json={
                "email": "cnscd@example.gov.vn",
                "display_name": "Thành viên CNSCĐ",
                "phone": "0901234567",
                "role": "to_cnscd",
                "village_ids": village_ids,
            },
            headers={"Authorization": f"Bearer {_jwt(admin_id)}"},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["scope"] == "assigned_villages"
    assert body["village_id"] is None
    assert body["village_ids"] == village_ids
    profile_payload = next(
        event[1] for event in admin.events if event[0] == "create_user_profile"
    )
    assignment_payload = next(
        event[1]
        for event in admin.events
        if event[0] == "create_user_village_assignments"
    )
    assert profile_payload["village_id"] is None
    assert assignment_payload["village_ids"] == village_ids
    assert assignment_payload["assigned_by"] == admin_id


@pytest.mark.parametrize("role", ["admin_xa", "lanh_dao"])
def test_create_commune_role_uses_automatic_commune_scope(role: str) -> None:
    admin_id = str(uuid4())
    admin = _FakeAdminClient(
        UserProfile(admin_id, "admin_xa", None, False, commune_id="ba_na")
    )
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/staff-users",
            json={
                "email": f"{role}@example.gov.vn",
                "display_name": "Tài khoản cấp xã",
                "phone": "0901234567",
                "role": role,
                "village_ids": [],
            },
            headers={"Authorization": f"Bearer {_jwt(admin_id)}"},
        )

    assert response.status_code == 201
    assert response.json()["scope"] == "commune"
    assert response.json()["village_id"] is None
    assert response.json()["village_ids"] == []
    profile_payload = next(
        event[1] for event in admin.events if event[0] == "create_user_profile"
    )
    assert profile_payload["village_id"] is None
    assert not any(
        event[0] == "create_user_village_assignments" for event in admin.events
    )


@pytest.mark.parametrize(
    ("role", "village_ids"),
    [
        ("can_bo_thon", []),
        ("can_bo_thon", [str(uuid4()), str(uuid4())]),
        ("to_cnscd", []),
        ("admin_xa", [str(uuid4())]),
        ("lanh_dao", [str(uuid4())]),
    ],
)
def test_create_staff_account_rejects_scope_that_does_not_match_role(
    role: str,
    village_ids: list[str],
) -> None:
    admin_id = str(uuid4())
    admin = _FakeAdminClient(UserProfile(admin_id, "admin_xa", None, False))
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/staff-users",
            json={
                "email": "invalid-scope@example.gov.vn",
                "display_name": "Sai phạm vi",
                "phone": "0901234567",
                "role": role,
                "village_ids": village_ids,
            },
            headers={"Authorization": f"Bearer {_jwt(admin_id)}"},
        )

    assert response.status_code == 422
    assert not any(event[0] == "create_auth_user" for event in admin.events)


def test_create_cnscd_rolls_back_auth_identity_when_assignment_write_fails() -> None:
    admin_id = str(uuid4())
    admin = _FakeAdminClient(
        UserProfile(admin_id, "admin_xa", None, False),
        fail_assignments=True,
    )
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/staff-users",
            json={
                "email": "rollback@example.gov.vn",
                "display_name": "Kiểm thử hoàn tác",
                "phone": "0901234567",
                "role": "to_cnscd",
                "village_ids": [str(uuid4())],
            },
            headers={"Authorization": f"Bearer {_jwt(admin_id)}"},
        )

    assert response.status_code == 400
    created_user_id = next(
        event[1]["user_id"]
        for event in admin.events
        if event[0] == "create_user_village_assignments"
    )
    assert ("delete_auth_user", created_user_id) in admin.events


def test_create_staff_account_rejects_cross_commune_village_before_auth_creation() -> None:
    admin_id = str(uuid4())
    admin = _FakeAdminClient(
        UserProfile(
            admin_id,
            "admin_xa",
            None,
            False,
            commune_id="ba_na",
        ),
        village_valid=False,
    )
    with _client_with_admin(admin) as client:
        response = client.post(
            "/auth/staff-users",
            json={
                "email": "officer@example.gov.vn",
                "display_name": "Cán bộ ngoài phạm vi",
                "role": "can_bo_thon",
                "village_id": str(uuid4()),
            },
            headers={"Authorization": f"Bearer {_jwt(admin_id)}"},
        )
    assert response.status_code == 422
    assert not any(event[0] == "create_auth_user" for event in admin.events)


class _FakeReportRest:
    def __init__(
        self,
        report: dict[str, object],
        *,
        delete_result: list[dict] | None = None,
        mutation_error: SupabaseAdminError | None = None,
    ) -> None:
        self.report = report
        self.delete_result = [report] if delete_result is None else delete_result
        self.mutation_error = mutation_error
        self.calls: list[tuple[str, str, object, str | None]] = []

    async def _rest_request(
        self,
        method: str,
        path: str,
        payload=None,
        prefer: str | None = None,
    ) -> list[dict]:
        self.calls.append((method, path, payload, prefer))
        if method != "GET" and self.mutation_error is not None:
            raise self.mutation_error
        return [self.report] if method == "GET" else self.delete_result


@contextmanager
def _client_with_report(report_rest: _FakeReportRest, profile: UserProfile):
    previous = app.dependency_overrides.copy()
    repository = SimpleNamespace(_supabase=report_rest)
    app.dependency_overrides[get_report_repository] = lambda: repository
    app.dependency_overrides[require_authenticated_user] = lambda: profile
    app.dependency_overrides[require_admin_xa] = lambda: profile
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_report_listing_returns_authoritative_update_and_approval_times() -> None:
    report_id = uuid4()
    village_id = uuid4()
    rest = _FakeReportRest(
        {
            "id": str(report_id),
            "village_id": str(village_id),
            "period_id": str(uuid4()),
            "workflow_status": "approved",
            "timeliness_status": "on_time",
            "publication_status": "private",
            "report_source": "manual",
            "version": 4,
            "submitted_at": "2026-07-10T01:00:00Z",
            "approved_at": "2026-07-11T02:00:00Z",
            "updated_at": "2026-07-12T03:00:00Z",
            "report_values": [{"ct_code": "CT01", "value": 318, "note": None}],
        }
    )
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)

    with _client_with_report(rest, profile) as client:
        response = client.get("/reports")

    assert response.status_code == 200
    assert response.json()[0]["updated_at"] == "2026-07-12T03:00:00Z"
    assert response.json()[0]["approved_at"] == "2026-07-11T02:00:00Z"
    assert response.json()[0]["values"] == {"CT01": 318}
    listing_call = rest.calls[-1]
    assert listing_call[0] == "GET"
    assert "submitted_at,updated_at,approved_at" in listing_call[1]


def test_delete_report_returns_bodyless_204_under_fastapi_0139() -> None:
    report_id = uuid4()
    village_id = uuid4()
    rest = _FakeReportRest(
        {
            "id": str(report_id),
            "village_id": str(village_id),
            "workflow_status": "draft",
            "publication_status": "private",
            "version": 4,
        }
    )
    profile = UserProfile(str(uuid4()), "can_bo_thon", str(village_id), False)
    with _client_with_report(rest, profile) as client:
        response = client.delete(f"/reports/{report_id}?expected_version=4")

    assert response.status_code == 204
    assert response.content == b""
    assert "content-type" not in response.headers
    delete_call = rest.calls[-1]
    assert delete_call[0] == "POST"
    assert delete_call[1] == "/rest/v1/rpc/delete_report_submission"
    assert delete_call[2] == {
        "p_report_id": str(report_id),
        "p_expected_version": 4,
    }
    assert delete_call[3] is None


def test_delete_report_detects_concurrent_change_from_empty_delete_result() -> None:
    report_id = uuid4()
    village_id = uuid4()
    rest = _FakeReportRest(
        {
            "id": str(report_id),
            "village_id": str(village_id),
            "workflow_status": "draft",
            "publication_status": "private",
            "version": 4,
        },
        delete_result=[],
    )
    profile = UserProfile(str(uuid4()), "can_bo_thon", str(village_id), False)
    with _client_with_report(rest, profile) as client:
        response = client.delete(f"/reports/{report_id}?expected_version=4")
    assert response.status_code == 409


def test_delete_report_preserves_locked_and_published_records_even_for_admin() -> None:
    village_id = uuid4()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    immutable_states = (
        ("locked", "private"),
        ("approved", "published"),
    )

    for workflow_status, publication_status in immutable_states:
        report_id = uuid4()
        rest = _FakeReportRest(
            {
                "id": str(report_id),
                "village_id": str(village_id),
                "workflow_status": workflow_status,
                "publication_status": publication_status,
                "version": 4,
            }
        )
        with _client_with_report(rest, profile) as client:
            response = client.delete(f"/reports/{report_id}?expected_version=4")

        assert response.status_code == 409
        assert len(rest.calls) == 1
        assert rest.calls[0][0] == "GET"
        assert "publication_status" in rest.calls[0][1]


def test_admin_cannot_enter_standard_village_report_data() -> None:
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    rest = _FakeReportRest({})
    village_id = uuid4()

    with _client_with_report(rest, profile) as client:
        response = client.post(
            "/reports",
            json={
                "village_id": str(village_id),
                "period_id": str(uuid4()),
                "submitted_by_name": "Admin",
                "submitted_by_phone": "0901234567",
                "values": {f"CT{index:02d}": 0 for index in range(1, 15)},
                "idempotency_key": str(uuid4()),
            },
        )

    assert response.status_code == 403
    assert "review reports" in response.json()["message"]
    assert rest.calls == []


def test_admin_workflow_routes_call_versioned_atomic_rpc() -> None:
    report_id = uuid4()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    rest = _FakeReportRest({"version": 9})

    with _client_with_report(rest, profile) as client:
        approve_response = client.patch(
            f"/reports/{report_id}/approve",
            json={"action": "approve", "expected_version": 8},
        )
        publish_response = client.patch(
            f"/reports/{report_id}/publish?expected_version=9",
        )

    assert approve_response.status_code == 200
    assert approve_response.json() == {
        "report_id": str(report_id),
        "workflow_status": "approved",
        "version": 9,
    }
    assert publish_response.status_code == 200
    assert publish_response.json() == {
        "report_id": str(report_id),
        "publication_status": "published",
        "version": 9,
    }
    assert rest.calls == [
        (
            "POST",
            "/rest/v1/rpc/transition_report_workflow",
            {
                "p_report_id": str(report_id),
                "p_expected_version": 8,
                "p_action": "approve",
            },
            None,
        ),
        (
            "POST",
            "/rest/v1/rpc/transition_report_workflow",
            {
                "p_report_id": str(report_id),
                "p_expected_version": 9,
                "p_action": "publish",
            },
            None,
        ),
    ]


def test_publish_maps_database_scope_denial_to_forbidden() -> None:
    report_id = uuid4()
    profile = UserProfile(str(uuid4()), "admin_xa", None, False)
    rest = _FakeReportRest(
        {},
        mutation_error=SupabaseAdminError(
            "outside scope",
            status_code=403,
            error_code="42501",
        ),
    )

    with _client_with_report(rest, profile) as client:
        response = client.patch(
            f"/reports/{report_id}/publish?expected_version=3",
        )

    assert response.status_code == 403
    assert response.json()["message"] == "Only admin can publish reports"
