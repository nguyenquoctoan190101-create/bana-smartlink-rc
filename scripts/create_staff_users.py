"""One-time, interactive Supabase staff provisioning.

The manifest contains profile metadata only. Passwords are entered through
``getpass`` and are never stored or printed. The command is a dry run unless
``--apply`` is provided.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv


ALLOWED_ROLES = {"admin_xa", "can_bo_thon", "to_cnscd", "lanh_dao"}


def _load_manifest(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("manifest must be a non-empty JSON array")
    for index, row in enumerate(raw, start=1):
        required = {"email", "role", "display_name", "commune_id"}
        if not isinstance(row, dict) or not required.issubset(row):
            raise ValueError(f"manifest row {index} is missing required fields")
        if row["role"] not in ALLOWED_ROLES:
            raise ValueError(f"manifest row {index} has an unsupported role")
        if "password" in row or "service_role_key" in row:
            raise ValueError("the manifest must not contain credentials")
        village_id = row.get("village_id")
        if row["role"] == "can_bo_thon" and not village_id:
            raise ValueError(f"manifest row {index} requires village_id")
        if row["role"] in {"admin_xa", "lanh_dao"} and village_id:
            raise ValueError(f"manifest row {index} must not set village_id")
    return raw


def _headers(service_key: str) -> dict[str, str]:
    return {
        "apikey": service_key,
        "authorization": f"Bearer {service_key}",
        "content-type": "application/json",
    }


def _safe_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("SUPABASE_URL must be an HTTPS origin without credentials")
    return value.rstrip("/")


def provision(base_url: str, service_key: str, user: dict[str, Any]) -> None:
    password = getpass.getpass(f"Temporary password for {user['email']}: ")
    confirmation = getpass.getpass("Repeat temporary password: ")
    if password != confirmation or len(password) < 12:
        raise ValueError("temporary passwords must match and contain at least 12 characters")

    with httpx.Client(timeout=20.0, headers=_headers(service_key)) as client:
        response = client.post(
            f"{base_url}/auth/v1/admin/users",
            json={
                "email": user["email"],
                "password": password,
                "email_confirm": True,
            },
        )
        password = confirmation = ""  # Drop references before processing the response.
        if response.status_code not in {200, 201}:
            raise RuntimeError(
                f"Auth provisioning failed for {user['email']} (HTTP {response.status_code})"
            )
        user_id = response.json().get("id")
        if not user_id:
            raise RuntimeError("Supabase response did not contain a user id")

        profile = {
            "id": user_id,
            "commune_id": user["commune_id"],
            "display_name": user["display_name"],
            "phone": user.get("phone"),
            "role": user["role"],
            "village_id": user.get("village_id"),
            "is_active": True,
            "force_password_reset": True,
        }
        profile_response = client.post(
            f"{base_url}/rest/v1/user_profiles",
            headers={"prefer": "resolution=merge-duplicates"},
            json=profile,
        )
        if profile_response.status_code not in {200, 201, 204}:
            # Disable the newly created auth identity rather than leaving an
            # active account without an authorization profile.
            client.put(
                f"{base_url}/auth/v1/admin/users/{user_id}",
                json={"ban_duration": "876000h"},
            )
            raise RuntimeError(
                f"Profile provisioning failed for {user['email']} "
                f"(HTTP {profile_response.status_code}); account was disabled"
            )
    print(f"Created profile for {user['email']} ({user['role']}); reset required")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    users = _load_manifest(args.manifest)
    if not args.apply:
        print(f"Dry run: validated {len(users)} profile(s). Use --apply to provision.")
        return 0

    base_url = _safe_url(os.getenv("SUPABASE_URL", ""))
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not service_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required")
    for user in users:
        provision(base_url, service_key, user)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
