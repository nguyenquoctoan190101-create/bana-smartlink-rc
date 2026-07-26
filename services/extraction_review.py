"""Signed, short-lived provenance for Excel/OCR human-review submissions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any
from uuid import UUID, uuid4

from services.settings import load_settings


TOKEN_VERSION = 1
TOKEN_TTL_SECONDS = 24 * 60 * 60
_KEY_CONTEXT = b"BaNaSmartLink/extraction-review/v1"
_INDICATOR_CODES = tuple(f"CT{index:02d}" for index in range(1, 15))


class ExtractionReviewTokenError(ValueError):
    """Raised when extraction provenance cannot be trusted."""


def _urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _urlsafe_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(
            value + padding,
            altchars=b"-_",
            validate=True,
        )
    except (ValueError, TypeError) as exc:
        raise ExtractionReviewTokenError("Invalid extraction review token") from exc


def _signing_key() -> bytes:
    settings = load_settings()
    master = (
        settings.extraction_review_signing_key.strip()
        or settings.supabase_service_role_key.strip()
    )
    if not master:
        if settings.app_env.strip().lower() not in {"development", "test"}:
            raise ExtractionReviewTokenError(
                "Extraction review signing key is not configured"
            )
        master = "development-only-extraction-review-key"
    return hmac.new(master.encode("utf-8"), _KEY_CONTEXT, hashlib.sha256).digest()


def _normalized_values(values: dict[str, Any]) -> dict[str, int | None]:
    normalized: dict[str, int | None] = {}
    for code in _INDICATOR_CODES:
        value = values.get(code)
        if value is None:
            normalized[code] = None
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ExtractionReviewTokenError(
                f"Invalid extracted value for {code}"
            )
        normalized[code] = value
    return normalized


def extraction_values_digest(values: dict[str, Any]) -> str:
    """Match PostgreSQL jsonb::text for the fixed ASCII CT01-CT14 object."""

    canonical = json.dumps(
        _normalized_values(values),
        ensure_ascii=False,
        separators=(", ", ": "),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def issue_extraction_review_token(
    *,
    user_id: str,
    source_checksum: str,
    source_type: str,
    extractor_versions: list[str],
    values: dict[str, Any],
    requires_review_count: int,
    import_metadata: dict[str, Any] | None = None,
    now: int | None = None,
) -> str:
    """Bind the exact server preview to one authenticated user for 24 hours."""

    issued_at = int(time.time() if now is None else now)
    payload = {
        "v": TOKEN_VERSION,
        "jti": str(uuid4()),
        "sub": user_id,
        "iat": issued_at,
        "exp": issued_at + TOKEN_TTL_SECONDS,
        "source_checksum": source_checksum,
        "source_type": source_type,
        "extractor_versions": sorted(dict.fromkeys(extractor_versions)),
        "field_count": len(_INDICATOR_CODES),
        "requires_review_count": requires_review_count,
        "values": _normalized_values(values),
    }
    if import_metadata is not None:
        if not isinstance(import_metadata, dict):
            raise ExtractionReviewTokenError("Invalid extraction import metadata")
        payload["import_metadata"] = import_metadata
    body = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(_signing_key(), body, hashlib.sha256).digest()
    return f"{_urlsafe_encode(body)}.{_urlsafe_encode(signature)}"


def verify_extraction_review_token(
    token: str,
    *,
    user_id: str,
    now: int | None = None,
) -> dict[str, Any]:
    """Verify signature, lifetime, subject and strict payload shape."""

    try:
        encoded_body, encoded_signature = token.split(".", 1)
    except ValueError as exc:
        raise ExtractionReviewTokenError("Invalid extraction review token") from exc
    body = _urlsafe_decode(encoded_body)
    supplied_signature = _urlsafe_decode(encoded_signature)
    expected_signature = hmac.new(_signing_key(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise ExtractionReviewTokenError("Invalid extraction review token")
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ExtractionReviewTokenError("Invalid extraction review token") from exc
    if not isinstance(payload, dict) or payload.get("v") != TOKEN_VERSION:
        raise ExtractionReviewTokenError("Unsupported extraction review token")
    if payload.get("sub") != user_id:
        raise ExtractionReviewTokenError(
            "Extraction review token belongs to another user"
        )
    timestamp = int(time.time() if now is None else now)
    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    if (
        not isinstance(issued_at, int)
        or not isinstance(expires_at, int)
        or issued_at > timestamp + 300
        or expires_at < timestamp
        or expires_at - issued_at != TOKEN_TTL_SECONDS
    ):
        raise ExtractionReviewTokenError("Extraction review token has expired")
    if (
        not isinstance(payload.get("jti"), str)
        or not isinstance(payload.get("source_checksum"), str)
        or len(payload["source_checksum"]) != 64
        or not isinstance(payload.get("source_type"), str)
        or not isinstance(payload.get("extractor_versions"), list)
        or payload.get("field_count") != len(_INDICATOR_CODES)
        or not isinstance(payload.get("requires_review_count"), int)
        or not isinstance(payload.get("values"), dict)
        or (
            "import_metadata" in payload
            and not isinstance(payload.get("import_metadata"), dict)
        )
    ):
        raise ExtractionReviewTokenError("Invalid extraction review token")
    try:
        UUID(payload["jti"])
    except (ValueError, TypeError) as exc:
        raise ExtractionReviewTokenError("Invalid extraction review token") from exc
    payload["values"] = _normalized_values(payload["values"])
    return payload


__all__ = [
    "ExtractionReviewTokenError",
    "extraction_values_digest",
    "issue_extraction_review_token",
    "verify_extraction_review_token",
]
