from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from services.settings import Settings


class SupabaseAdminError(RuntimeError):
    """Raised when Supabase Admin or PostgREST calls fail."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code


@dataclass(frozen=True)
class UserProfile:
    id: str
    role: str
    village_id: str | None
    force_password_reset: bool
    display_name: str | None = None
    phone: str | None = None
    is_active: bool = True
    commune_id: str | None = None
    # Authenticator Assurance Level copied only from a locally verified JWT.
    # It is never read from user-editable profile metadata.
    aal: str = "aal1"


class SupabaseAdminClient:
    def __init__(
        self,
        settings: Settings,
        access_token: str | None = None,
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._access_token = access_token
        self._http_client = http_client

    def as_user(self, access_token: str) -> "SupabaseAdminClient":
        """Return a PostgREST client whose Authorization role comes from JWT."""
        return SupabaseAdminClient(
            self._settings,
            access_token=access_token,
            http_client=self._http_client,
        )

    async def _send_http_request(
        self,
        method: str,
        url: str,
        *,
        timeout: float,
        **kwargs: Any,
    ) -> httpx.Response:
        """Use the app-wide connection pool, with a safe standalone fallback."""
        if self._http_client is not None:
            return await self._http_client.request(
                method,
                url,
                timeout=timeout,
                **kwargs,
            )
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.request(method, url, **kwargs)

    async def get_user_profile(self, user_id: str) -> UserProfile | None:
        encoded_id = quote(user_id, safe="")
        rows = await self._rest_request(
            "GET",
            (
                f"/rest/v1/user_profiles?id=eq.{encoded_id}"
                "&select=id,role,village_id,commune_id,display_name,phone,is_active,force_password_reset"
            ),
        )
        if not rows:
            return None

        row = rows[0]
        return UserProfile(
            id=str(row["id"]),
            role=str(row["role"]),
            village_id=str(row["village_id"]) if row.get("village_id") else None,
            force_password_reset=bool(row.get("force_password_reset", False)),
            display_name=str(row["display_name"]) if row.get("display_name") else None,
            phone=str(row["phone"]) if row.get("phone") else None,
            is_active=bool(row.get("is_active", True)),
            commune_id=str(row["commune_id"]) if row.get("commune_id") else None,
        )

    async def list_user_village_ids(self, user_id: str) -> list[str]:
        """Return the explicit village assignments for a staff account.

        The profile keeps one optional primary village for backwards
        compatibility. CNSCĐ members can support more than one village, so
        their working scope must also include this assignment ledger.
        """
        encoded_id = quote(user_id, safe="")
        rows = await self._rest_request(
            "GET",
            (
                "/rest/v1/user_village_assignments"
                f"?user_id=eq.{encoded_id}&select=village_id"
                "&order=village_id.asc"
            ),
        )
        return [
            str(row["village_id"])
            for row in rows
            if row.get("village_id") is not None
        ]

    async def create_auth_user(
        self,
        email: str,
        password: str,
        display_name: str,
        role: str,
        phone: str | None = None,
    ) -> str:
        user_metadata: dict[str, Any] = {
            "display_name": display_name,
            "force_password_reset": True,
            "role": role,
        }
        if phone is not None:
            user_metadata["phone"] = phone
        payload = {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": user_metadata,
        }
        response = await self._auth_request("POST", "/auth/v1/admin/users", payload)
        user_id = response.get("id")
        if not isinstance(user_id, str):
            raise SupabaseAdminError("Supabase did not return a user id")

        return user_id

    async def delete_auth_user(self, user_id: str) -> None:
        encoded_id = quote(user_id, safe="")
        await self._auth_request("DELETE", f"/auth/v1/admin/users/{encoded_id}", None)

    async def update_auth_user_password(self, user_id: str, new_password: str) -> None:
        encoded_id = quote(user_id, safe="")
        payload = {"password": new_password}
        await self._auth_request("PUT", f"/auth/v1/admin/users/{encoded_id}", payload)

    async def update_current_user_password(self, new_password: str) -> None:
        """Change the JWT caller's own password through Supabase Auth."""
        if not self._access_token:
            raise SupabaseAdminError("A user access token is required")
        await self._auth_request("PUT", "/auth/v1/user", {"password": new_password})

    async def upload_storage_object(
        self,
        bucket: str,
        object_path: str,
        content: bytes,
        content_type: str,
    ) -> None:
        """Upload an immutable object using the caller's JWT and Storage RLS."""
        if not self._access_token:
            raise SupabaseAdminError("A user access token is required")
        safe_bucket = quote(bucket, safe="")
        safe_path = "/".join(quote(part, safe="") for part in object_path.split("/"))
        headers = self._headers()
        headers["Content-Type"] = content_type
        headers["x-upsert"] = "false"
        try:
            response = await self._send_http_request(
                "POST",
                f"{self._settings.normalized_supabase_url}/storage/v1/object/{safe_bucket}/{safe_path}",
                timeout=30.0,
                headers=headers,
                content=content,
            )
        except httpx.HTTPError as exc:
            raise SupabaseAdminError("Supabase Storage request failed") from exc
        if response.status_code >= 400:
            raise SupabaseAdminError(
                "Supabase Storage request failed",
                status_code=response.status_code,
            )

    async def upload_storage_object_admin(
        self,
        bucket: str,
        object_path: str,
        content: bytes,
        content_type: str,
    ) -> None:
        """Upload a server-validated object with the service key.

        This is intentionally separate from ``upload_storage_object``: caller
        JWT uploads must continue to use Storage RLS, while the anonymous field
        report flow has no JWT and can only reach a private bucket through this
        narrow, validated backend path.
        """
        safe_bucket = quote(bucket, safe="")
        safe_path = "/".join(quote(part, safe="") for part in object_path.split("/"))
        headers = self._headers()
        headers["Content-Type"] = content_type
        headers["x-upsert"] = "false"
        try:
            response = await self._send_http_request(
                "POST",
                f"{self._settings.normalized_supabase_url}/storage/v1/object/{safe_bucket}/{safe_path}",
                timeout=30.0,
                headers=headers,
                content=content,
            )
        except httpx.HTTPError as exc:
            raise SupabaseAdminError("Supabase Storage request failed") from exc
        if response.status_code >= 400:
            raise SupabaseAdminError("Supabase Storage request failed", status_code=response.status_code)

    async def delete_storage_object_admin(self, bucket: str, object_path: str) -> None:
        """Remove an orphaned object after a failed metadata insert."""
        safe_bucket = quote(bucket, safe="")
        safe_path = "/".join(quote(part, safe="") for part in object_path.split("/"))
        try:
            response = await self._send_http_request(
                "DELETE",
                f"{self._settings.normalized_supabase_url}/storage/v1/object/{safe_bucket}/{safe_path}",
                timeout=10.0,
                headers=self._headers(),
            )
        except httpx.HTTPError as exc:
            raise SupabaseAdminError("Supabase Storage request failed") from exc
        if response.status_code >= 400:
            raise SupabaseAdminError("Supabase Storage request failed", status_code=response.status_code)

    async def create_user_profile(
        self,
        user_id: str,
        role: str,
        village_id: str,
        display_name: str | None = None,
        phone: str | None = None,
        force_password_reset: bool = True,
        commune_id: str | None = None,
    ) -> UserProfile:
        payload = {
            "id": user_id,
            "role": role,
            "village_id": village_id,
            "commune_id": commune_id or self._settings.bana_commune_id,
            "force_password_reset": force_password_reset,
            "is_active": True,
        }
        if display_name is not None:
            payload["display_name"] = display_name
        if phone is not None:
            payload["phone"] = phone
        rows = await self._rest_request(
            "POST",
            "/rest/v1/user_profiles",
            payload,
            prefer="return=representation",
        )
        row = rows[0]
        return UserProfile(
            id=str(row["id"]),
            role=str(row["role"]),
            village_id=str(row["village_id"]) if row.get("village_id") else None,
            force_password_reset=bool(row.get("force_password_reset", False)),
            display_name=str(row["display_name"]) if row.get("display_name") else None,
            phone=str(row["phone"]) if row.get("phone") else None,
            is_active=bool(row.get("is_active", True)),
            commune_id=str(row["commune_id"]) if row.get("commune_id") else payload["commune_id"],
        )

    async def village_in_commune(self, village_id: str, commune_id: str) -> bool:
        """Validate a staff assignment before creating the Auth identity."""
        encoded_village = quote(village_id, safe="")
        encoded_commune = quote(commune_id, safe="")
        rows = await self._rest_request(
            "GET",
            (
                "/rest/v1/villages"
                f"?id=eq.{encoded_village}"
                f"&commune_id=eq.{encoded_commune}"
                "&is_active=eq.true&select=id"
            ),
        )
        return bool(rows)

    async def update_user_profile_force_reset(self, user_id: str, force_reset: bool) -> None:
        encoded_id = quote(user_id, safe="")
        payload = {"force_password_reset": force_reset}
        await self._rest_request(
            "PATCH",
            f"/rest/v1/user_profiles?id=eq.{encoded_id}",
            payload,
        )

    async def insert_pending_update(
        self,
        report_id: str,
        ct_code: str,
        proposed_value: int,
        proposed_by: str | None = None,
        submitter_name: str | None = None,
        submitter_phone: str | None = None,
        submitter_household: str | None = None,
        submitter_address: str | None = None,
        submitter_relation: str | None = None,
        explanation: str | None = None,
        consent_version: str = "2026-07-13",
        tracking_code: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "report_id": report_id,
            "ct_code": ct_code,
            "proposed_value": proposed_value,
            "status": "pending",
            "consent_given": True,
            "consent_version": consent_version,
            "consent_at": datetime.now(timezone.utc).isoformat(),
        }
        if proposed_by is not None:
            payload["proposed_by"] = proposed_by
        if submitter_name is not None:
            payload["submitter_name"] = submitter_name
        if submitter_phone is not None:
            payload["submitter_phone"] = submitter_phone
        if submitter_household is not None:
            payload["submitter_household"] = submitter_household
        if submitter_address is not None:
            payload["submitter_address"] = submitter_address
        if submitter_relation is not None:
            payload["submitter_relation"] = submitter_relation
        if explanation is not None:
            payload["explanation"] = explanation
        if tracking_code is not None:
            payload["tracking_code"] = tracking_code
        rows = await self._rest_request(
            "POST",
            "/rest/v1/pending_updates",
            payload,
            prefer="return=representation",
        )
        return dict(rows[0])

    async def _auth_request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        try:
            response = await self._send_http_request(
                method,
                f"{self._settings.normalized_supabase_url}{path}",
                timeout=10.0,
                headers=self._headers(),
                json=payload,
            )
        except httpx.HTTPError as exc:
            raise SupabaseAdminError("Supabase Auth Admin request failed") from exc

        if response.status_code >= 400:
            raise SupabaseAdminError(
                "Supabase Auth Admin request failed",
                status_code=response.status_code,
            )

        if response.status_code == 204:
            return {}

        data = response.json()
        if not isinstance(data, dict):
            raise SupabaseAdminError("Unexpected Supabase Auth response")

        return data

    async def _rest_request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | list[dict[str, Any]] | None = None,
        prefer: str | None = None,
    ) -> list[dict[str, Any]]:
        headers = self._headers()
        if prefer is not None:
            headers["Prefer"] = prefer

        try:
            response = await self._send_http_request(
                method,
                f"{self._settings.normalized_supabase_url}{path}",
                timeout=10.0,
                headers=headers,
                json=payload,
            )
        except httpx.HTTPError as exc:
            raise SupabaseAdminError("Supabase REST request failed") from exc

        if response.status_code >= 400:
            error_code = None
            try:
                error_payload = response.json()
                if isinstance(error_payload, dict) and isinstance(error_payload.get("code"), str):
                    error_code = error_payload["code"]
            except ValueError:
                pass
            raise SupabaseAdminError(
                "Supabase REST request failed",
                status_code=response.status_code,
                error_code=error_code,
            )

        if not response.content:
            return []

        data = response.json()
        if not isinstance(data, list):
            raise SupabaseAdminError("Unexpected Supabase REST response")

        return [dict(row) for row in data]

    def _headers(self) -> dict[str, str]:
        if self._access_token:
            # A user-scoped request must use the low-privilege publishable key;
            # pairing a secret key with the user's JWT can bypass the RLS
            # boundary this client is meant to preserve.
            api_key = self._settings.supabase_publishable_key
            if not api_key:
                raise SupabaseAdminError("Supabase publishable key is not configured")
            return {
                "apikey": api_key,
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json",
            }

        secret_key = self._settings.supabase_service_role_key
        if not secret_key:
            raise SupabaseAdminError("Supabase secret key is not configured")
        headers = {
            "apikey": secret_key,
            "Content-Type": "application/json",
        }
        # Modern sb_secret_* keys are API keys, not JWTs, and must not be sent
        # in Authorization.  Keep the bearer header only for an explicitly
        # configured legacy service_role JWT during migration.
        if not secret_key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {secret_key}"
        return headers


__all__ = ["SupabaseAdminClient", "SupabaseAdminError", "UserProfile"]
