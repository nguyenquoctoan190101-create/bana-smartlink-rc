"""Short-lived signed tickets for synthesizing an existing chatbot answer."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time

from services.settings import load_settings


TOKEN_VERSION = 1
TOKEN_TTL_SECONDS = 5 * 60
MAX_SPEECH_TEXT_LENGTH = 1600
_KEY_CONTEXT = b"BaNaSmartLink/chat-speech/v1"
_SENSITIVE_PATTERNS = (
    re.compile(r"\bCT14\b", re.IGNORECASE),
    re.compile(r"bạo\s+lực\s+gia\s+đình", re.IGNORECASE),
    re.compile(r"\b(?:0|\+84)\d{8,10}\b"),
)


class SpeechTokenError(ValueError):
    """Raised when a speech ticket is invalid, expired, or unsafe."""


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
        raise SpeechTokenError("Invalid speech token") from exc


def _signing_key() -> bytes:
    settings = load_settings()
    master = (
        settings.extraction_review_signing_key.strip()
        or settings.supabase_service_role_key.strip()
    )
    if not master:
        if settings.app_env.strip().lower() not in {"development", "test"}:
            raise SpeechTokenError("Speech signing key is not configured")
        master = "development-only-speech-signing-key"
    return hmac.new(master.encode("utf-8"), _KEY_CONTEXT, hashlib.sha256).digest()


def is_speech_safe(text: str) -> bool:
    normalized = " ".join(text.split())
    return (
        bool(normalized)
        and len(normalized) <= MAX_SPEECH_TEXT_LENGTH
        and not any(pattern.search(normalized) for pattern in _SENSITIVE_PATTERNS)
    )


def issue_speech_token(
    *,
    text: str,
    subject: str,
    now: int | None = None,
) -> str | None:
    """Return a signed five-minute ticket, or None for sensitive content."""

    normalized = " ".join(text.split())
    if not is_speech_safe(normalized):
        return None
    issued_at = int(time.time() if now is None else now)
    body = json.dumps(
        {
            "v": TOKEN_VERSION,
            "sub": subject,
            "iat": issued_at,
            "exp": issued_at + TOKEN_TTL_SECONDS,
            "text": normalized,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(_signing_key(), body, hashlib.sha256).digest()
    return f"{_urlsafe_encode(body)}.{_urlsafe_encode(signature)}"


def verify_speech_token(
    token: str,
    *,
    subject: str,
    now: int | None = None,
) -> str:
    """Verify signature, subject, expiry, and the server-side safety gate."""

    try:
        encoded_body, encoded_signature = token.split(".", 1)
    except ValueError as exc:
        raise SpeechTokenError("Invalid speech token") from exc
    body = _urlsafe_decode(encoded_body)
    supplied_signature = _urlsafe_decode(encoded_signature)
    expected_signature = hmac.new(_signing_key(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise SpeechTokenError("Invalid speech token")
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SpeechTokenError("Invalid speech token") from exc
    timestamp = int(time.time() if now is None else now)
    if (
        not isinstance(payload, dict)
        or payload.get("v") != TOKEN_VERSION
        or payload.get("sub") != subject
        or not isinstance(payload.get("iat"), int)
        or not isinstance(payload.get("exp"), int)
        or payload["iat"] > timestamp + 60
        or payload["exp"] < timestamp
        or payload["exp"] - payload["iat"] != TOKEN_TTL_SECONDS
        or not isinstance(payload.get("text"), str)
        or not is_speech_safe(payload["text"])
    ):
        raise SpeechTokenError("Invalid or expired speech token")
    return payload["text"]


__all__ = [
    "MAX_SPEECH_TEXT_LENGTH",
    "SpeechTokenError",
    "is_speech_safe",
    "issue_speech_token",
    "verify_speech_token",
]
