from __future__ import annotations

import ipaddress

import pytest
from fastapi import HTTPException

from routers.auth import _enforce_mfa_access
from services.network_access import is_internal_request, requires_internal_network
from services.settings import Settings, SettingsError
from services.supabase_admin import UserProfile


def _profile(role: str, aal: str = "aal1") -> UserProfile:
    return UserProfile(
        id="00000000-0000-0000-0000-000000000001",
        role=role,
        village_id=None,
        force_password_reset=False,
        aal=aal,
    )


def test_mfa_enforcement_requires_aal2_only_for_configured_roles() -> None:
    settings = Settings(_env_file=None, mfa_required_roles="admin_xa,lanh_dao")

    with pytest.raises(HTTPException) as error:
        _enforce_mfa_access(_profile("admin_xa", "aal1"), settings)
    assert error.value.status_code == 403
    assert error.value.detail["code"] == "MFA_REQUIRED"

    _enforce_mfa_access(_profile("admin_xa", "aal2"), settings)
    _enforce_mfa_access(_profile("can_bo_thon", "aal1"), settings)


def test_mfa_role_configuration_rejects_unknown_role() -> None:
    settings = Settings(_env_file=None, mfa_required_roles="admin_xa,root")
    with pytest.raises(SettingsError, match="unsupported roles"):
        settings.validate_for_startup()


def test_privileged_mfa_defaults_on_outside_development() -> None:
    settings = Settings(_env_file=None, app_env="staging")
    assert settings.required_mfa_roles == frozenset({"admin_xa", "lanh_dao"})


def test_internal_network_gate_keeps_public_requests_available() -> None:
    networks = (
        ipaddress.ip_network("203.0.113.0/24"),
        ipaddress.ip_network("2001:db8:1234::/48"),
    )
    assert is_internal_request("203.0.113.21", networks)
    assert is_internal_request("2001:db8:1234::7", networks)
    assert not is_internal_request("198.51.100.10", networks)
    assert not is_internal_request("spoofed.invalid", networks)
    assert requires_internal_network("/app/dashboard", None)
    assert requires_internal_network("/reports", "Bearer verified-jwt")
    assert not requires_internal_network("/reports/public", None)


def test_internal_cidr_configuration_is_normalized_and_validated() -> None:
    settings = Settings(
        _env_file=None,
        internal_allowed_ip_cidrs="203.0.113.21/24, 2001:db8:1234::7/48",
    )
    assert [str(network) for network in settings.internal_ip_networks] == [
        "203.0.113.0/24",
        "2001:db8:1234::/48",
    ]

    invalid = Settings(_env_file=None, internal_allowed_ip_cidrs="not-a-cidr")
    with pytest.raises(SettingsError, match="invalid IPv4/IPv6 CIDR"):
        invalid.validate_for_startup()
