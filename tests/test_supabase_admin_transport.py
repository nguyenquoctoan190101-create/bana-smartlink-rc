from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from services.settings import Settings
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError


class FakeAsyncClient:
    def __init__(self, response: httpx.Response | None = None, error: Exception | None = None, **kwargs):
        self.response = response
        self.error = error
        self.request = AsyncMock(side_effect=self._request)

    async def _request(self, *args, **kwargs):
        if self.error:
            raise self.error
        return self.response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co/rest/v1/",
        supabase_publishable_key="sb_publishable_test",
        supabase_service_role_key="sb_secret_test",
    )


@pytest.mark.asyncio
async def test_profile_and_auth_user_lifecycle_contracts() -> None:
    client = SupabaseAdminClient(_settings())
    client._rest_request = AsyncMock(return_value=[{
        "id": "user-1", "role": "admin_xa", "village_id": None,
        "display_name": "Quản trị", "phone": "0900000001",
        "is_active": True, "force_password_reset": True,
    }])
    profile = await client.get_user_profile("user/1")
    assert profile and profile.id == "user-1" and profile.force_password_reset is True
    assert "user%2F1" in client._rest_request.await_args.args[1]

    client._rest_request.reset_mock()
    client._rest_request.return_value = []
    assert await client.get_user_profile("missing") is None

    client._auth_request = AsyncMock(return_value={"id": "new-user"})
    user_id = await client.create_auth_user(
        "admin@example.test", "StrongPassword!", "Admin", "admin_xa", "0900000001"
    )
    assert user_id == "new-user"
    payload = client._auth_request.await_args.args[2]
    assert payload["email_confirm"] is True
    assert payload["user_metadata"]["force_password_reset"] is True
    await client.update_auth_user_password("new/user", "ChangedPassword!")
    await client.delete_auth_user("new/user")
    assert client._auth_request.await_count == 3


@pytest.mark.asyncio
async def test_auth_and_profile_fail_closed_on_malformed_responses() -> None:
    client = SupabaseAdminClient(_settings())
    client._auth_request = AsyncMock(return_value={})
    with pytest.raises(SupabaseAdminError, match="user id"):
        await client.create_auth_user("x@example.test", "Password123!", "X", "admin_xa")

    anonymous = SupabaseAdminClient(_settings())
    with pytest.raises(SupabaseAdminError, match="access token"):
        await anonymous.update_current_user_password("Password123!")


@pytest.mark.asyncio
async def test_create_profile_pending_update_and_force_reset_payloads() -> None:
    client = SupabaseAdminClient(_settings())
    client._rest_request = AsyncMock(side_effect=[
        [{
            "id": "u1", "role": "can_bo_thon", "village_id": "v1",
            "display_name": "Cán bộ", "phone": "0900000002",
            "is_active": True, "force_password_reset": True,
        }],
        [],
        [{"id": "proposal-1", "status": "pending"}],
    ])
    profile = await client.create_user_profile(
        "u1", "can_bo_thon", "v1", "Cán bộ", "0900000002"
    )
    assert profile.village_id == "v1"
    await client.update_user_profile_force_reset("u1", False)
    row = await client.insert_pending_update(
        report_id="r1", ct_code="CT01", proposed_value=320,
        submitter_name="Người dân", submitter_phone="0901234567",
        submitter_household="Hộ 12", submitter_address="Bà Nà",
        submitter_relation="Chủ hộ", explanation="Đối chiếu sổ giấy",
        tracking_code="ABCDEF0123456789",
    )
    assert row["id"] == "proposal-1"
    pending_payload = client._rest_request.await_args_list[2].args[2]
    assert pending_payload["consent_given"] is True
    assert pending_payload["tracking_code"] == "ABCDEF0123456789"
    assert "consent_at" in pending_payload


@pytest.mark.asyncio
async def test_user_password_and_storage_upload_use_caller_jwt_and_encoded_path() -> None:
    client = SupabaseAdminClient(_settings()).as_user("caller.jwt")
    client._auth_request = AsyncMock(return_value={})
    await client.update_current_user_password("NewStrongPassword!")
    client._auth_request.assert_awaited_once_with(
        "PUT", "/auth/v1/user", {"password": "NewStrongPassword!"}
    )

    fake = FakeAsyncClient(httpx.Response(200, json={"Key": "ok"}))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        await client.upload_storage_object(
            "report templates", "ba-na/kỳ 1/mẫu.xlsx", b"PK\x03\x04", "application/xlsx"
        )
    url = fake.request.await_args.args[1]
    headers = fake.request.await_args.kwargs["headers"]
    assert "/report%20templates/ba-na/k%E1%BB%B3%201/m%E1%BA%ABu.xlsx" in url
    assert headers["Authorization"] == "Bearer caller.jwt"
    assert headers["x-upsert"] == "false"


@pytest.mark.asyncio
async def test_storage_transport_and_http_failures_are_redacted() -> None:
    client = SupabaseAdminClient(_settings()).as_user("caller.jwt")
    request = httpx.Request("POST", "https://project.supabase.co/storage/v1/object/x")
    fake = FakeAsyncClient(error=httpx.ConnectError("secret transport detail", request=request))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        with pytest.raises(SupabaseAdminError, match="Storage request failed") as caught:
            await client.upload_storage_object("b", "x", b"x", "application/octet-stream")
    assert "secret transport" not in str(caught.value)

    fake = FakeAsyncClient(httpx.Response(409, json={"message": "raw storage detail"}))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        with pytest.raises(SupabaseAdminError) as caught:
            await client.upload_storage_object("b", "x", b"x", "application/octet-stream")
    assert caught.value.status_code == 409
    assert "raw storage" not in str(caught.value)


@pytest.mark.asyncio
async def test_auth_transport_response_shapes_and_errors() -> None:
    client = SupabaseAdminClient(_settings())
    fake = FakeAsyncClient(httpx.Response(204))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        assert await client._auth_request("DELETE", "/auth/v1/admin/users/u1", None) == {}

    fake = FakeAsyncClient(httpx.Response(200, json=[{"unexpected": True}]))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        with pytest.raises(SupabaseAdminError, match="Unexpected"):
            await client._auth_request("POST", "/auth/v1/admin/users", {})

    fake = FakeAsyncClient(httpx.Response(401, json={"message": "sensitive"}))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        with pytest.raises(SupabaseAdminError) as caught:
            await client._auth_request("POST", "/auth/v1/admin/users", {})
    assert caught.value.status_code == 401
    assert "sensitive" not in str(caught.value)


@pytest.mark.asyncio
async def test_rest_transport_empty_list_error_code_and_shape() -> None:
    client = SupabaseAdminClient(_settings())
    fake = FakeAsyncClient(httpx.Response(204))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        assert await client._rest_request("PATCH", "/rest/v1/x", {}) == []

    fake = FakeAsyncClient(httpx.Response(200, json=[{"id": "1"}]))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        assert await client._rest_request("GET", "/rest/v1/x", prefer="return=representation") == [{"id": "1"}]
    assert fake.request.await_args.kwargs["headers"]["Prefer"] == "return=representation"

    fake = FakeAsyncClient(httpx.Response(409, json={"code": "23505", "details": "secret"}))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        with pytest.raises(SupabaseAdminError) as caught:
            await client._rest_request("POST", "/rest/v1/x", {})
    assert caught.value.status_code == 409 and caught.value.error_code == "23505"
    assert "secret" not in str(caught.value)

    fake = FakeAsyncClient(httpx.Response(200, json={"not": "a list"}))
    with patch("services.supabase_admin.httpx.AsyncClient", return_value=fake):
        with pytest.raises(SupabaseAdminError, match="Unexpected"):
            await client._rest_request("GET", "/rest/v1/x")


def test_missing_credentials_never_fall_back_to_anonymous_or_secret_bearer() -> None:
    with pytest.raises(SupabaseAdminError, match="publishable"):
        SupabaseAdminClient(Settings(_env_file=None)).as_user("jwt")._headers()
    with pytest.raises(SupabaseAdminError, match="secret key"):
        SupabaseAdminClient(Settings(_env_file=None))._headers()

    legacy = Settings(_env_file=None, supabase_service_role_key="legacy.jwt")
    assert SupabaseAdminClient(legacy)._headers()["Authorization"] == "Bearer legacy.jwt"
