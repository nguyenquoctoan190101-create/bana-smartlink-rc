from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from routers.auth import get_settings, get_supabase_admin, require_authenticated_user
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
    ) -> None:
        self.profile = profile
        self.events: list[tuple] = []
        self.access_token: str | None = None
        self.user_client = _FakeUserClient(self.events, fail_password)
        self.fail_profile_update = fail_profile_update

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

    async def create_user_profile(self, **kwargs) -> UserProfile:
        self.events.append(("create_user_profile", kwargs))
        return UserProfile(
            id=kwargs["user_id"],
            role=kwargs["role"],
            village_id=kwargs["village_id"],
            force_password_reset=kwargs["force_password_reset"],
            display_name=kwargs["display_name"],
            phone=kwargs["phone"],
        )

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


class _FakeReportRest:
    def __init__(self, report: dict[str, object], *, delete_result: list[dict] | None = None) -> None:
        self.report = report
        self.delete_result = [report] if delete_result is None else delete_result
        self.calls: list[tuple[str, str, str | None]] = []

    async def _rest_request(
        self,
        method: str,
        path: str,
        payload=None,
        prefer: str | None = None,
    ) -> list[dict]:
        self.calls.append((method, path, prefer))
        return [self.report] if method == "GET" else self.delete_result


@contextmanager
def _client_with_report(report_rest: _FakeReportRest, profile: UserProfile):
    previous = app.dependency_overrides.copy()
    repository = SimpleNamespace(_supabase=report_rest)
    app.dependency_overrides[get_report_repository] = lambda: repository
    app.dependency_overrides[require_authenticated_user] = lambda: profile
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_delete_report_returns_bodyless_204_under_fastapi_0139() -> None:
    report_id = uuid4()
    village_id = uuid4()
    rest = _FakeReportRest(
        {
            "id": str(report_id),
            "village_id": str(village_id),
            "workflow_status": "draft",
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
    assert delete_call[0] == "DELETE"
    assert "version=eq.4" in delete_call[1]
    assert "workflow_status=eq.draft" in delete_call[1]
    assert delete_call[2] == "return=representation"


def test_delete_report_detects_concurrent_change_from_empty_delete_result() -> None:
    report_id = uuid4()
    village_id = uuid4()
    rest = _FakeReportRest(
        {
            "id": str(report_id),
            "village_id": str(village_id),
            "workflow_status": "draft",
            "version": 4,
        },
        delete_result=[],
    )
    profile = UserProfile(str(uuid4()), "can_bo_thon", str(village_id), False)
    with _client_with_report(rest, profile) as client:
        response = client.delete(f"/reports/{report_id}?expected_version=4")
    assert response.status_code == 409
