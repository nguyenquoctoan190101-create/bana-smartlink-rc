from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient
from jwt.exceptions import (
    InvalidTokenError,
    PyJWKClientConnectionError,
    PyJWKClientError,
)


class AuthError(RuntimeError):
    """Raised when a Supabase JWT is missing or invalid."""


class AuthVerificationUnavailable(AuthError):
    """Raised when trusted signing keys cannot be retrieved."""


def verify_supabase_jwt(
    token: str,
    jwt_secret: str,
    *,
    expected_issuer: str | None = None,
    expected_audience: str | None = None,
    jwks_url: str | None = None,
) -> dict[str, Any]:
    """Verify modern Supabase JWTs via JWKS, with an explicit legacy fallback."""
    header_raw, payload_raw, signature_raw = _split_token(token)
    header = _decode_json(header_raw)
    algorithm = header.get("alg")

    # This verifier implements no JWS critical extensions.  Accepting an
    # unknown extension would violate RFC 7515 and can create policy bypasses.
    if "crit" in header:
        raise AuthError("Unsupported JWT critical header")

    if algorithm == "HS256":
        if not jwt_secret:
            raise AuthError("JWT verification is not configured")
        payload = _decode_json(payload_raw)
        _verify_legacy_signature(
            header_raw,
            payload_raw,
            signature_raw,
            jwt_secret,
        )
    elif algorithm in {"RS256", "ES256"}:
        if not jwks_url:
            raise AuthError("JWT verification is not configured")
        if not isinstance(header.get("kid"), str) or not header["kid"].strip():
            raise AuthError("JWT key id is missing")
        payload = _verify_jwks_signature(token, algorithm, jwks_url)
    else:
        raise AuthError("Unsupported JWT algorithm")


    _validate_claims(
        payload,
        expected_issuer=expected_issuer,
        expected_audience=expected_audience,
    )
    return payload


def _verify_legacy_signature(
    header_raw: str,
    payload_raw: str,
    signature_raw: str,
    jwt_secret: str,
) -> None:
    signed_content = f"{header_raw}.{payload_raw}".encode("utf-8")
    expected_signature = hmac.new(
        jwt_secret.encode("utf-8"),
        signed_content,
        hashlib.sha256,
    ).digest()

    if not hmac.compare_digest(_b64url_decode(signature_raw), expected_signature):
        raise AuthError("Invalid JWT signature")


@lru_cache(maxsize=8)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(
        jwks_url,
        cache_keys=True,
        max_cached_keys=16,
        cache_jwk_set=True,
        lifespan=600,
        timeout=5,
    )


def _verify_jwks_signature(
    token: str,
    algorithm: str,
    jwks_url: str,
) -> dict[str, Any]:
    try:
        signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=[algorithm],
            options={
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
                "verify_aud": False,
                "verify_iss": False,
            },
        )
    except PyJWKClientConnectionError as exc:
        raise AuthVerificationUnavailable(
            "JWT signing keys are temporarily unavailable"
        ) from exc
    except (PyJWKClientError, InvalidTokenError) as exc:
        raise AuthError("Invalid JWT signature") from exc
    if not isinstance(payload, dict):
        raise AuthError("Invalid JWT payload")
    return payload


def _validate_claims(
    payload: dict[str, Any],
    *,
    expected_issuer: str | None,
    expected_audience: str | None,
) -> None:
    expires_at = payload.get("exp")
    if (
        isinstance(expires_at, bool)
        or not isinstance(expires_at, int)
        or expires_at <= int(time.time())
    ):
        raise AuthError("JWT has expired")

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise AuthError("JWT subject is missing")

    now = int(time.time())
    not_before = payload.get("nbf")
    if not_before is not None:
        if isinstance(not_before, bool) or not isinstance(not_before, (int, float)):
            raise AuthError("JWT not-before claim is invalid")
        if int(not_before) > now + 30:
            raise AuthError("JWT is not active yet")

    issued_at = payload.get("iat")
    if issued_at is not None:
        if isinstance(issued_at, bool) or not isinstance(issued_at, (int, float)):
            raise AuthError("JWT issued-at time is invalid")
        if int(issued_at) > now + 30:
            raise AuthError("JWT issued-at time is invalid")

    if expected_issuer:
        issuer_claim = payload.get("iss")
        if not isinstance(issuer_claim, str):
            raise AuthError("Invalid JWT issuer")
        issuer = issuer_claim.rstrip("/")
        if issuer != expected_issuer.rstrip("/"):
            raise AuthError("Invalid JWT issuer")

    if expected_audience:
        audience = payload.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        if any(not isinstance(value, str) for value in audiences):
            raise AuthError("Invalid JWT audience")
        if expected_audience not in audiences:
            raise AuthError("Invalid JWT audience")


def _split_token(token: str) -> tuple[str, str, str]:
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("Invalid JWT format")

    return parts[0], parts[1], parts[2]


def _decode_json(value: str) -> dict[str, Any]:
    try:
        decoded = _b64url_decode(value)
        payload = json.loads(decoded)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        raise AuthError("Invalid JWT payload") from exc

    if not isinstance(payload, dict):
        raise AuthError("Invalid JWT payload")

    return payload


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(
            f"{value}{padding}",
            altchars=b"-_",
            validate=True,
        )
    except (ValueError, base64.binascii.Error) as exc:
        raise AuthError("Invalid JWT encoding") from exc


__all__ = [
    "AuthError",
    "AuthVerificationUnavailable",
    "verify_supabase_jwt",
]
