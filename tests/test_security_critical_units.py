from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import struct
import time
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import UploadFile
from openpyxl import Workbook
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject

import services.validator as validator_module
import services.security as security_module
import services.settings as settings_module
import services.upload_validator as upload_module
from services.security import AuthError, verify_supabase_jwt
from services.settings import Settings, SettingsError, load_settings
from services.supabase_admin import SupabaseAdminClient
from services.upload_validator import (
    MAX_UPLOAD_BYTES,
    UploadValidationError,
    validate_report_upload,
)
from services.validator import coerce_storage_value, validate_phone, validate_report


JWT_SECRET = "unit-test-jwt-secret-with-at-least-32-bytes"
VALID_VALUES = {
    "CT01": 100,
    "CT02": 350,
    "CT03": 10,
    "CT04": 20,
    "CT05": 5,
    "CT06": 10,
    "CT07": 50,
    "CT08": 5,
    "CT09": 80,
    "CT10": 150,
    "CT11": 140,
    "CT12": 3,
    "CT13": 50,
    "CT14": 0,
}


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _jwt(
    payload: dict[str, object],
    *,
    secret: str = JWT_SECRET,
    header: dict[str, object] | None = None,
    raw_payload: bytes | None = None,
) -> str:
    header_part = _b64url(json.dumps(header or {"alg": "HS256"}).encode("utf-8"))
    payload_part = _b64url(
        raw_payload
        if raw_payload is not None
        else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    signing_input = f"{header_part}.{payload_part}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_part}.{payload_part}.{_b64url(signature)}"


def _valid_claims(**overrides: object) -> dict[str, object]:
    claims: dict[str, object] = {
        "sub": "3ed737d7-3cd4-4653-a864-5be9e69a83f2",
        "exp": int(time.time()) + 300,
        "iat": int(time.time()),
        "iss": "https://project.supabase.co/auth/v1",
        "aud": "authenticated",
    }
    claims.update(overrides)
    return claims


def test_jwt_verifier_accepts_valid_issuer_and_audience_list() -> None:
    token = _jwt(_valid_claims(aud=["anon", "authenticated"]))
    claims = verify_supabase_jwt(
        token,
        JWT_SECRET,
        expected_issuer="https://project.supabase.co/auth/v1/",
        expected_audience="authenticated",
    )
    assert claims["sub"] == "3ed737d7-3cd4-4653-a864-5be9e69a83f2"


def test_jwt_verifier_accepts_modern_rs256_key_from_project_jwks(monkeypatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        _valid_claims(),
        private_key,
        algorithm="RS256",
        headers={"kid": "unit-test-key", "typ": "JWT"},
    )
    fake_client = SimpleNamespace(
        get_signing_key_from_jwt=lambda _token: SimpleNamespace(
            key=private_key.public_key()
        )
    )
    monkeypatch.setattr(security_module, "_jwks_client", lambda _url: fake_client)

    claims = verify_supabase_jwt(
        token,
        "",
        expected_issuer="https://project.supabase.co/auth/v1",
        expected_audience="authenticated",
        jwks_url="https://project.supabase.co/auth/v1/.well-known/jwks.json",
    )
    assert claims["sub"] == _valid_claims()["sub"]


def test_jwt_verifier_rejects_asymmetric_token_without_jwks_or_key_id() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with_key_id = jwt.encode(
        _valid_claims(),
        private_key,
        algorithm="RS256",
        headers={"kid": "unit-test-key"},
    )
    without_key_id = jwt.encode(
        _valid_claims(),
        private_key,
        algorithm="RS256",
    )
    with pytest.raises(AuthError, match="not configured"):
        verify_supabase_jwt(with_key_id, "")
    with pytest.raises(AuthError, match="key id"):
        verify_supabase_jwt(
            without_key_id,
            "",
            jwks_url="https://project.supabase.co/auth/v1/.well-known/jwks.json",
        )


def test_jwks_client_has_bounded_cache_and_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_client(url: str, **kwargs):
        captured.update(url=url, **kwargs)
        return object()

    security_module._jwks_client.cache_clear()
    monkeypatch.setattr(security_module, "PyJWKClient", fake_client)
    try:
        security_module._jwks_client("https://project.example/jwks.json")
    finally:
        security_module._jwks_client.cache_clear()
    assert captured["url"] == "https://project.example/jwks.json"
    assert captured["lifespan"] == 600
    assert captured["timeout"] == 5


@pytest.mark.parametrize(
    ("client_error", "error_type", "message"),
    [
        (
            security_module.PyJWKClientConnectionError("offline"),
            security_module.AuthVerificationUnavailable,
            "temporarily unavailable",
        ),
        (
            security_module.PyJWKClientError("unknown key"),
            AuthError,
            "signature",
        ),
    ],
)
def test_jwt_verifier_maps_jwks_failures_without_leaking_details(
    monkeypatch,
    client_error,
    error_type,
    message,
) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        _valid_claims(),
        private_key,
        algorithm="RS256",
        headers={"kid": "unit-test-key"},
    )

    def fail(_token):
        raise client_error

    monkeypatch.setattr(
        security_module,
        "_jwks_client",
        lambda _url: SimpleNamespace(get_signing_key_from_jwt=fail),
    )
    with pytest.raises(error_type, match=message):
        verify_supabase_jwt(
            token,
            "",
            jwks_url="https://project.supabase.co/auth/v1/.well-known/jwks.json",
        )


def test_jwt_verifier_rejects_non_object_payload_from_jwt_library(monkeypatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        _valid_claims(),
        private_key,
        algorithm="RS256",
        headers={"kid": "unit-test-key"},
    )
    monkeypatch.setattr(
        security_module,
        "_jwks_client",
        lambda _url: SimpleNamespace(
            get_signing_key_from_jwt=lambda _token: SimpleNamespace(
                key=private_key.public_key()
            )
        ),
    )
    monkeypatch.setattr(security_module.jwt, "decode", lambda *args, **kwargs: [])
    with pytest.raises(AuthError, match="payload"):
        verify_supabase_jwt(
            token,
            "",
            jwks_url="https://project.supabase.co/auth/v1/.well-known/jwks.json",
        )


def test_jwt_verifier_rejects_unimplemented_critical_header() -> None:
    token = _jwt(
        _valid_claims(),
        header={"alg": "HS256", "crit": ["x-policy"], "x-policy": "mfa"},
    )
    with pytest.raises(AuthError, match="critical"):
        verify_supabase_jwt(token, JWT_SECRET)


@pytest.mark.parametrize(
    ("claims", "message"),
    [
        ({"sub": "user"}, "expired"),
        (_valid_claims(exp=True), "expired"),
        (_valid_claims(exp="9999999999"), "expired"),
        (_valid_claims(exp=int(time.time()) - 1), "expired"),
        (_valid_claims(sub="  "), "subject"),
        (_valid_claims(nbf="tomorrow"), "not-before"),
        # Keep a generous margin because the full suite can take several
        # minutes on Windows; +120 seconds used to expire before this case.
        (_valid_claims(nbf=int(time.time()) + 600), "not active"),
        (_valid_claims(iat=True), "issued-at"),
        (_valid_claims(iat=int(time.time()) + 600), "issued-at"),
        (_valid_claims(iss=None), "issuer"),
        (_valid_claims(aud=["authenticated", 7]), "audience"),
    ],
)
def test_jwt_verifier_rejects_malformed_security_claims(
    claims: dict[str, object],
    message: str,
) -> None:
    token = _jwt(claims)
    with pytest.raises(AuthError, match=message):
        verify_supabase_jwt(
            token,
            JWT_SECRET,
            expected_issuer="https://project.supabase.co/auth/v1",
            expected_audience="authenticated",
        )


def test_jwt_verifier_rejects_invalid_utf8_as_auth_error() -> None:
    token = _jwt({}, raw_payload=b"\xff\xfe")
    with pytest.raises(AuthError, match="payload"):
        verify_supabase_jwt(token, JWT_SECRET)


@pytest.mark.parametrize(
    "token",
    ["one.two", "one.two.three.four", "*.e30.invalid", "e30.e30."],
)
def test_jwt_verifier_rejects_malformed_tokens(token: str) -> None:
    with pytest.raises(AuthError):
        verify_supabase_jwt(token, JWT_SECRET)


def test_jwt_verifier_rejects_empty_secret_and_wrong_algorithm() -> None:
    valid_token = _jwt(_valid_claims())
    with pytest.raises(AuthError, match="not configured"):
        verify_supabase_jwt(valid_token, "")
    none_token = _jwt(_valid_claims(), header={"alg": "none"})
    with pytest.raises(AuthError, match="algorithm"):
        verify_supabase_jwt(none_token, JWT_SECRET)


def test_jwt_verifier_rejects_wrong_signature_issuer_and_audience() -> None:
    with pytest.raises(AuthError, match="signature"):
        verify_supabase_jwt(_jwt(_valid_claims(), secret="x" * 32), JWT_SECRET)
    token = _jwt(_valid_claims())
    with pytest.raises(AuthError, match="issuer"):
        verify_supabase_jwt(token, JWT_SECRET, expected_issuer="https://other.example")
    with pytest.raises(AuthError, match="audience"):
        verify_supabase_jwt(token, JWT_SECRET, expected_audience="service_role")


def test_jwt_verifier_accepts_optional_claims_when_checks_are_not_requested() -> None:
    claims = _valid_claims(nbf=int(time.time()) - 10)
    claims.pop("iat")
    claims.pop("iss")
    claims.pop("aud")
    assert verify_supabase_jwt(_jwt(claims), JWT_SECRET)["sub"] == claims["sub"]


def test_jwt_verifier_rejects_json_array_payload() -> None:
    token = _jwt({}, raw_payload=b"[]")
    with pytest.raises(AuthError, match="payload"):
        verify_supabase_jwt(token, JWT_SECRET)


def _clear_settings_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "APP_ENV",
        "ENVIRONMENT",
        "ALLOWED_ORIGIN",
        "ALLOWED_ORIGINS",
        "DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_JWT_SECRET",
        "SUPABASE_JWT_ISSUER",
        "SUPABASE_JWT_AUDIENCE",
        "VAPID_CONTACT",
        "VAPID_CLAIMS_EMAIL",
        "FEATURE_EXTERNAL_OCR",
    ):
        monkeypatch.delenv(name, raising=False)


def _production_settings(**overrides: str) -> Settings:
    values = {
        "app_env": "production",
        "allowed_origin": "https://smartlink.example.gov.vn",
        "database_url": "postgresql://db.internal:5432/smartlink",
        "supabase_url": "https://project.supabase.co",
        "supabase_publishable_key": "sb_publishable_unit-test",
        "supabase_service_role_key": "service-role-placeholder",
        "supabase_jwt_secret": JWT_SECRET,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_environment_alias_enters_production_and_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_settings_environment(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    settings = Settings(_env_file=None)
    assert settings.app_env == "production"
    with pytest.raises(SettingsError, match="DATABASE_URL"):
        settings.validate_for_startup()


def test_plural_origin_and_vapid_example_aliases(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_settings_environment(monkeypatch)
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://one.example,https://two.example")
    monkeypatch.setenv("VAPID_CLAIMS_EMAIL", "mailto:security@example.gov.vn")
    settings = Settings(_env_file=None)
    assert settings.allowed_origin == "https://one.example,https://two.example"
    assert settings.vapid_contact == "mailto:security@example.gov.vn"


def test_process_environment_is_not_overridden_by_dotenv(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    _clear_settings_environment(monkeypatch)
    (tmp_path / ".env").write_text(
        "ENVIRONMENT=development\nALLOWED_ORIGINS=http://localhost:5173\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://smartlink.example.gov.vn")
    monkeypatch.setenv("DATABASE_URL", "postgresql://db.internal/smartlink")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_unit-test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-placeholder")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    load_settings.cache_clear()
    try:
        settings = load_settings()
        assert settings.app_env == "production"
    finally:
        load_settings.cache_clear()


def test_load_settings_preserves_safe_settings_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_settings_environment(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    load_settings.cache_clear()
    try:
        with pytest.raises(SettingsError, match="DATABASE_URL"):
            load_settings()
    finally:
        load_settings.cache_clear()


def test_load_settings_wraps_unexpected_loader_errors(monkeypatch) -> None:
    def broken_settings():
        raise ValueError("value that must not be exposed")

    monkeypatch.setattr(settings_module, "Settings", broken_settings)
    load_settings.cache_clear()
    try:
        with pytest.raises(SettingsError, match="Missing or invalid") as error:
            load_settings()
        assert "must not be exposed" not in str(error.value)
    finally:
        load_settings.cache_clear()


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"allowed_origin": "https://safe.example,*"}, "explicit"),
        ({"allowed_origin": "http://smartlink.example.gov.vn"}, "HTTPS origins"),
        ({"supabase_url": "http://project.supabase.co"}, "SUPABASE_URL"),
        ({"database_url": "https://db.internal/database"}, "PostgreSQL"),
        ({"supabase_jwt_secret": "short"}, "32 characters"),
    ],
)
def test_production_settings_reject_insecure_values(
    overrides: dict[str, str],
    message: str,
) -> None:
    with pytest.raises(SettingsError, match=message):
        _production_settings(**overrides).validate_for_startup()


def test_unknown_environment_is_rejected_instead_of_falling_back_to_development() -> None:
    settings = Settings(_env_file=None, app_env="prodution")
    with pytest.raises(SettingsError, match="unsupported"):
        settings.validate_for_startup()


def test_external_ocr_requires_both_feature_flag_and_provider_key() -> None:
    provider_missing = _production_settings(feature_external_ocr=True)
    provider_missing.validate_for_startup()
    assert provider_missing.external_ocr_ready is False

    disabled = _production_settings(
        feature_external_ocr=False,
        gemini_api_key="unit-test-provider-key",
    )
    disabled.validate_for_startup()
    assert disabled.external_ocr_ready is False

    ready = _production_settings(
        feature_external_ocr=True,
        gemini_api_key="unit-test-provider-key",
    )
    ready.validate_for_startup()
    assert ready.external_ocr_ready is True


def test_privileged_access_settings_validate_roles_and_networks() -> None:
    valid = Settings(
        _env_file=None,
        mfa_required_roles="admin_xa, lanh_dao",
        internal_allowed_ip_cidrs="10.10.0.8/24, 2001:db8::1/64",
    )
    assert valid.required_mfa_roles == frozenset({"admin_xa", "lanh_dao"})
    assert [str(network) for network in valid.internal_ip_networks] == [
        "10.10.0.0/24",
        "2001:db8::/64",
    ]

    with pytest.raises(SettingsError, match="unsupported roles"):
        _ = Settings(
            _env_file=None,
            mfa_required_roles="admin_xa,root",
        ).required_mfa_roles
    with pytest.raises(SettingsError, match="invalid IPv4/IPv6 CIDR"):
        _ = Settings(
            _env_file=None,
            internal_allowed_ip_cidrs="not-a-network",
        ).internal_ip_networks


def test_development_settings_and_issuer_derivation() -> None:
    development = Settings(_env_file=None, app_env="development")
    development.validate_for_startup()
    assert development.jwt_issuer == ""
    assert development.jwks_url == ""
    derived = Settings(_env_file=None, supabase_url="https://project.supabase.co/rest/v1/")
    assert derived.normalized_supabase_url == "https://project.supabase.co"
    assert derived.jwt_issuer == "https://project.supabase.co/auth/v1"
    assert derived.jwks_url == (
        "https://project.supabase.co/auth/v1/.well-known/jwks.json"
    )
    explicit = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_jwt_issuer="https://issuer.example/",
    )
    assert explicit.jwt_issuer == "https://issuer.example"


def test_supabase_headers_keep_user_requests_on_rls_and_secret_out_of_bearer() -> None:
    settings = Settings(
        _env_file=None,
        supabase_publishable_key="sb_publishable_unit-test",
        supabase_service_role_key="sb_secret_unit-test",
    )
    admin_headers = SupabaseAdminClient(settings)._headers()
    assert admin_headers["apikey"] == "sb_secret_unit-test"
    assert "Authorization" not in admin_headers

    user_headers = SupabaseAdminClient(settings).as_user("user.jwt.value")._headers()
    assert user_headers["apikey"] == "sb_publishable_unit-test"
    assert user_headers["Authorization"] == "Bearer user.jwt.value"


def _errors_for(values: dict[str, object], code: str) -> set[str]:
    return {
        error["error_type"]
        for error in validate_report(values)
        if error["ct_code"] == code
    }


def test_validator_accepts_real_rule_baseline() -> None:
    assert validate_report(VALID_VALUES) == []
    assert validate_report({**VALID_VALUES, "CT01": "100"}) == []


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [
        (None, None),
        (True, None),
        (42, 42),
        ("  +42 ", 42),
        ("-7", -7),
        ("2.450", None),
        (10.5, None),
    ],
)
def test_storage_coercion_never_turns_ambiguous_values_into_zero(
    raw_value: object,
    expected: int | None,
) -> None:
    assert coerce_storage_value(raw_value) == expected


@pytest.mark.parametrize("blank", [None, "", "   \t"])
def test_validator_classifies_all_blank_forms_as_blank(blank: object) -> None:
    values = {**VALID_VALUES, "CT04": blank}
    assert "BLANK" in _errors_for(values, "CT04")


@pytest.mark.parametrize("invalid", [True, 10.0, "mười", "1_000", object()])
def test_validator_rejects_non_plain_integers(invalid: object) -> None:
    assert "TEXT" in _errors_for({**VALID_VALUES, "CT07": invalid}, "CT07")


def test_validator_enforces_separator_min_reference_sum_and_ratio_rules() -> None:
    assert "SEP" in _errors_for({**VALID_VALUES, "CT02": "2.450"}, "CT02")
    assert "LOGIC" in _errors_for({**VALID_VALUES, "CT05": -1}, "CT05")
    assert "LOGIC" in _errors_for({**VALID_VALUES, "CT03": 101}, "CT03")
    assert "LOGIC" in _errors_for(
        {**VALID_VALUES, "CT03": 60, "CT04": 50},
        "CT04",
    )
    assert "OUTLIER" in _errors_for({**VALID_VALUES, "CT02": 1_000}, "CT02")


def test_validator_rejects_nonzero_ratio_value_when_reference_is_zero() -> None:
    values = {code: 0 for code in VALID_VALUES}
    values["CT02"] = 1
    assert "LOGIC" in _errors_for(values, "CT02")
    assert validate_report({code: 0 for code in VALID_VALUES}) == []


def test_validator_requires_every_configured_indicator() -> None:
    values = VALID_VALUES.copy()
    values.pop("CT14")
    assert "BLANK" in _errors_for(values, "CT14")


@pytest.mark.parametrize("phone", [None, 901234567, "123", "090-123-4567"])
def test_phone_validator_rejects_noncanonical_values(phone: object) -> None:
    assert validate_phone(phone) is not None


def test_phone_validator_accepts_trimmed_vietnamese_mobile() -> None:
    assert validate_phone(" 0901234567 ") is None


def test_validator_fails_closed_for_invalid_rule_document(monkeypatch, tmp_path) -> None:
    rules_path = tmp_path / "rules.json"
    rules_path.write_text('{"indicators": {"CT01": {}}}', encoding="utf-8")
    monkeypatch.setattr(validator_module, "RULES_PATH", rules_path)
    with pytest.raises(ValueError, match="indicators list"):
        validate_report(VALID_VALUES)


@pytest.mark.parametrize(
    "rules",
    [
        [
            {"code": "CT01", "min": 0},
            {"code": "CT02", "sum_max_ref": {"refs": "CT01", "max_ref": "CT01"}},
        ],
        [
            {"code": "CT01", "min": 0},
            {"code": "CT02", "sum_max_ref": {"refs": ["CT03"], "max_ref": "CT01"}},
        ],
        [
            {"code": "CT01", "min": 0},
            {"code": "CT02", "ratio_check": {"ref": "CT99", "min_ratio": 1, "max_ratio": 2}},
        ],
        [
            {"code": "CT01", "min": 0},
            {"code": "CT02", "ratio_check": {"ref": "CT01", "min_ratio": "one", "max_ratio": 2}},
        ],
    ],
)
def test_validator_ignores_malformed_optional_rule_fragments(monkeypatch, rules) -> None:
    monkeypatch.setattr(validator_module, "_load_rules", lambda: rules)
    assert validate_report({"CT01": 1, "CT02": 1}) == []


def _validate_upload(filename: str, content: bytes) -> tuple[bytes, UploadFile]:
    upload = UploadFile(filename=filename, file=BytesIO(content))
    return asyncio.run(validate_report_upload(upload)), upload


def _real_xlsx() -> bytes:
    workbook = Workbook()
    workbook.active["A1"] = "CT01"
    workbook.active["B1"] = 100
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def _zip_package(extra_entries: list[tuple[str, bytes]]) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            b'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        )
        archive.writestr(
            "xl/workbook.xml",
            b'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
        )
        for name, value in extra_entries:
            archive.writestr(name, value)
    return output.getvalue()


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)


def _oversized_png_header() -> bytes:
    ihdr = struct.pack(">IIBBBBB", 5_001, 5_001, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IEND", b"")


def _scanned_pdf(*, pages: int = 1) -> bytes:
    images = [Image.new("RGB", (16, 16), "white") for _ in range(pages)]
    output = BytesIO()
    images[0].save(
        output,
        format="PDF",
        save_all=True,
        append_images=images[1:],
    )
    return output.getvalue()


def test_upload_validator_accepts_real_xlsx_and_rewinds_stream() -> None:
    content = _real_xlsx()
    validated, upload = _validate_upload("report.xlsx", content)
    assert validated == content
    assert upload.file.tell() == 0


def test_upload_validator_accepts_decoded_image() -> None:
    output = BytesIO()
    Image.new("RGB", (16, 16), "white").save(output, format="PNG")
    validated, _ = _validate_upload("report.png", output.getvalue())
    assert validated.startswith(b"\x89PNG")


def test_upload_validator_accepts_bounded_static_pdf_and_rewinds_stream() -> None:
    content = _scanned_pdf()
    validated, upload = _validate_upload("report.pdf", content)
    assert validated == content
    assert upload.file.tell() == 0


@pytest.mark.parametrize(
    ("filename", "content", "message"),
    [
        ("report.pdf", b"%PDF-1.7", "bị lỗi hoặc không hợp lệ"),
        ("report.xlsx", b"", "Empty"),
        ("report.xlsx", b"not-a-zip", "does not match"),
        ("report.png", b"not-a-png", "does not match"),
        ("report.jpg", b"\xff\xd8\xfftruncated", "corrupt"),
    ],
)
def test_upload_validator_rejects_invalid_public_inputs(
    filename: str,
    content: bytes,
    message: str,
) -> None:
    with pytest.raises(UploadValidationError, match=message):
        _validate_upload(filename, content)


def test_upload_validator_rejects_unsupported_extension() -> None:
    with pytest.raises(UploadValidationError, match="Unsupported"):
        _validate_upload("report.xls", b"legacy")


def test_upload_validator_rejects_file_over_compressed_size_limit() -> None:
    with pytest.raises(UploadValidationError, match="larger than 5MB"):
        _validate_upload("large.png", b"\x89PNG\r\n\x1a\n" + b"x" * MAX_UPLOAD_BYTES)


def test_upload_validator_rejects_active_and_excessive_pdf() -> None:
    active_output = BytesIO()
    active = PdfWriter()
    active.add_blank_page(width=200, height=200)
    active.add_js("app.alert('unsafe')")
    active.write(active_output)
    with pytest.raises(UploadValidationError, match="nội dung chủ động"):
        _validate_upload("active.pdf", active_output.getvalue())

    with pytest.raises(UploadValidationError, match="từ 1 đến 5 trang"):
        _validate_upload("many-pages.pdf", _scanned_pdf(pages=6))

    encrypted_output = BytesIO()
    encrypted = PdfWriter()
    encrypted.add_blank_page(width=200, height=200)
    encrypted.encrypt("secret")
    encrypted.write(encrypted_output)
    with pytest.raises(UploadValidationError, match="PDF được mã hóa"):
        _validate_upload("encrypted.pdf", encrypted_output.getvalue())


def _pdf_with_root_entry(key: str, value) -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer._root_object[NameObject(key)] = value
    writer.write(output)
    return output.getvalue()


def test_upload_validator_rejects_pdf_root_actions_and_page_annotations(
    monkeypatch,
) -> None:
    with pytest.raises(UploadValidationError, match="nội dung chủ động"):
        _validate_upload(
            "open-action.pdf",
            _pdf_with_root_entry("/OpenAction", DictionaryObject()),
        )

    output = BytesIO()
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=200)
    page[NameObject("/Annots")] = ArrayObject()
    writer.write(output)
    with pytest.raises(UploadValidationError, match="nội dung tương tác"):
        _validate_upload("annotations.pdf", output.getvalue())

    monkeypatch.setattr(upload_module, "MAX_PDF_OBJECTS", 0)
    with pytest.raises(UploadValidationError, match="quá phức tạp"):
        _validate_upload("complex.pdf", _scanned_pdf())


def test_upload_validator_accepts_pdf_with_empty_names_dictionary() -> None:
    validated, _ = _validate_upload(
        "empty-names.pdf",
        _pdf_with_root_entry("/Names", DictionaryObject()),
    )
    assert validated.startswith(b"%PDF-")


def test_upload_validator_fails_closed_when_pdf_library_is_unavailable(
    monkeypatch,
) -> None:
    import builtins

    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name == "pypdf":
            raise ImportError("pypdf deliberately unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    with pytest.raises(UploadValidationError, match="PDF validation is unavailable"):
        _validate_upload("report.pdf", _scanned_pdf())


@pytest.mark.parametrize(
    "entry",
    [
        ("../outside.xml", b"x"),
        ("C:/outside.xml", b"x"),
        ("xl/vbaProject.bin", b"macro"),
        ("xl/externalLinks/externalLink1.xml", b"external"),
    ],
)
def test_upload_validator_rejects_unsafe_xlsx_entries(entry: tuple[str, bytes]) -> None:
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("unsafe.xlsx", _zip_package([entry]))


def test_upload_validator_rejects_external_relationship_with_xml_whitespace() -> None:
    relationship = b'''<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="x" Target = "https://attacker.example/data" TargetMode = "External" />
      </Relationships>'''
    package = _zip_package([("xl/_rels/workbook.xml.rels", relationship)])
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("external.xlsx", package)


def test_upload_validator_rejects_invalid_relationship_xml() -> None:
    package = _zip_package([("xl/_rels/workbook.xml.rels", b"<Relationships>")])
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("invalid.xlsx", package)


def test_upload_validator_rejects_relationship_xml_entities() -> None:
    relationship = b'''<?xml version="1.0"?>
    <!DOCTYPE Relationships [<!ENTITY repeated "unsafe">]>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="&repeated;" Target="worksheet.xml" />
    </Relationships>'''
    package = _zip_package([("xl/_rels/workbook.xml.rels", relationship)])

    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("entities.xlsx", package)


def test_upload_validator_rejects_relationship_target_scheme_without_mode() -> None:
    relationship = b'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="x" Target="https://attacker.example/data" />
    </Relationships>'''
    package = _zip_package([("xl/_rels/workbook.xml.rels", relationship)])
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("external.xlsx", package)


def test_upload_validator_rejects_compression_bomb_ratio() -> None:
    package = _zip_package([("xl/worksheets/sheet1.xml", b"A" * 100_000)])
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("bomb.xlsx", package)


def test_upload_validator_rejects_entry_count_and_duplicate_names() -> None:
    too_many = [(f"custom/entry-{index}.xml", b"") for index in range(1_001)]
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("many.xlsx", _zip_package(too_many))

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", b"<Types/>")
        archive.writestr("xl/workbook.xml", b"<workbook/>")
        with pytest.warns(UserWarning, match="Duplicate name"):
            archive.writestr("xl/workbook.xml", b"<different/>")
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("duplicate.xlsx", output.getvalue())


def test_upload_validator_rejects_total_uncompressed_limit(monkeypatch) -> None:
    monkeypatch.setattr(upload_module, "MAX_XLSX_UNCOMPRESSED_BYTES", 10)
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("expanded.xlsx", _zip_package([("custom/data.bin", b"12345678901")]))


def test_upload_validator_fails_closed_when_image_library_is_unavailable(
    monkeypatch,
) -> None:
    import builtins

    output = BytesIO()
    Image.new("RGB", (2, 2), "white").save(output, format="PNG")
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name == "PIL":
            raise ImportError("Pillow deliberately unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    with pytest.raises(UploadValidationError, match="unavailable"):
        _validate_upload("image.png", output.getvalue())


def test_upload_validator_unknown_magic_branch_and_impossible_zip_size_metadata() -> None:
    assert upload_module._has_valid_magic_bytes(".unknown", b"anything") is False

    package = bytearray(_zip_package([]))
    central_header = package.find(b"PK\x01\x02")
    assert central_header >= 0
    # ZIP central-directory compressed-size field. A non-empty member with a
    # zero compressed size is malformed and must be rejected before reading.
    package[central_header + 20 : central_header + 24] = b"\x00\x00\x00\x00"
    with pytest.raises(UploadValidationError, match="does not match"):
        _validate_upload("invalid-size.xlsx", bytes(package))


def test_upload_validator_rejects_oversized_image_dimensions_without_decoding_pixels() -> None:
    with pytest.raises(UploadValidationError, match="dimensions"):
        _validate_upload("huge.png", _oversized_png_header())
