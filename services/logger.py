"""
services/logger.py
===================
Structured JSON logging + Sentry integration for Ba Na SmartLink backend.

Usage
-----
    from services.logger import get_logger
    log = get_logger(__name__)

    log.info("Report submitted", extra={"report_id": "abc", "village": "Ta Lang"})
    log.error("Supabase error", exc_info=True, extra={"endpoint": "/reports"})

Sentry
------
Sentry is initialized automatically when SENTRY_DSN is set in .env.
If SENTRY_DSN is absent or empty, the SDK is silently skipped.

Environment variables
---------------------
  SENTRY_DSN                  : Sentry DSN string
  SENTRY_ENVIRONMENT          : "production" | "staging" | "development" (default: "production")
  SENTRY_TRACES_SAMPLE_RATE   : float 0-1.0 (default: 0.1)
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from typing import Any


_REDACTED = "[REDACTED]"
_SAFE_LOG_MESSAGES = frozenset({
    "AI narrative unavailable",
    "Excel normalization failed",
    "Failed to initialize Sentry SDK",
    "Gemini JSON-mode fallback response parsed",
    "Gemini OCR response had no readable answer text",
    "Gemini provider request rejected",
    "Gemini provider returned invalid JSON",
    "Gemini provider transport failed",
    "Gemini structured output fallback engaged",
    "OCR preview failed",
    "Sentry SDK initialized",
    "Some notification deliveries failed",
    "Trend analysis failed",
    "Unable to list Gemini OCR models",
    "Unhandled server error",
    "Unexpected offline sync failure",
    "Web Push delivery failed",
})
_SENSITIVE_FIELD_NAMES = frozenset({
    "access_token",
    "api_key",
    "apikey",
    "authorization",
    "body",
    "client_secret",
    "cookie",
    "dsn",
    "id_token",
    "http.fragment",
    "http.query",
    "jwt_secret",
    "key",
    "password",
    "payload",
    "private_key",
    "prompt",
    "query_string",
    "raw_query_string",
    "refresh_token",
    "request_body",
    "response_body",
    "schema",
    "secret",
    "secret_key",
    "service_role_key",
    "set_cookie",
    "signing_key",
    "token",
    "url.fragment",
    "url.query",
    "x_goog_api_key",
})
_SENSITIVE_FIELD_SUFFIXES = (
    "_access_token",
    "_api_key",
    "_client_secret",
    "_jwt_secret",
    "_password",
    "_private_key",
    "_refresh_token",
    "_secret_key",
    "_service_role_key",
    "_signing_key",
)
_URL_FIELD_NAMES = frozenset({
    "http.target",
    "http.url",
    "path",
    "request_uri",
    "url",
    "url.full",
})
_CAPABILITY_PATH_RE = re.compile(
    r"(?P<prefix>/(?:api/cases/track|auth/citizen/pending-updates)/)"
    r"[^/?#\s]+",
    flags=re.IGNORECASE,
)


def _normalized_field_name(value: Any) -> str:
    return str(value).strip().lower().replace("-", "_")


def _is_sensitive_field_name(value: Any) -> bool:
    normalized = _normalized_field_name(value)
    return (
        normalized in _SENSITIVE_FIELD_NAMES
        or normalized.endswith(_SENSITIVE_FIELD_SUFFIXES)
    )


def _sanitize_url_or_path(value: str) -> str:
    """Remove query/fragment data and mask known capability-bearing paths."""
    without_query = value.split("?", 1)[0].split("#", 1)[0]
    return _CAPABILITY_PATH_RE.sub(
        lambda match: f"{match.group('prefix')}{_REDACTED}",
        without_query,
    )


def _redact_sensitive_fields(value: Any) -> Any:
    """Return telemetry-safe structures without credentials or provider input."""
    if isinstance(value, dict):
        return {
            key: (
                _REDACTED
                if _is_sensitive_field_name(key)
                else _sanitize_url_or_path(item)
                if (
                    _normalized_field_name(key) in _URL_FIELD_NAMES
                    and isinstance(item, str)
                )
                else _redact_sensitive_fields(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_sensitive_fields(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_sensitive_fields(item) for item in value)
    return value


def _redact_sentry_messages(event: dict[str, Any]) -> None:
    """Drop free-form exception, log, and breadcrumb text in-place."""
    if "message" in event:
        event["message"] = _REDACTED

    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("formatted", "message"):
            if key in logentry:
                logentry[key] = _REDACTED

    exception = event.get("exception")
    values = exception.get("values") if isinstance(exception, dict) else None
    if isinstance(values, list):
        for item in values:
            if isinstance(item, dict) and "value" in item:
                item["value"] = _REDACTED

    breadcrumbs = event.get("breadcrumbs")
    breadcrumb_values = (
        breadcrumbs.get("values") if isinstance(breadcrumbs, dict) else None
    )
    if isinstance(breadcrumb_values, list):
        for item in breadcrumb_values:
            if isinstance(item, dict) and "message" in item:
                item["message"] = _REDACTED

    spans = event.get("spans")
    if isinstance(spans, list):
        for span in spans:
            if not isinstance(span, dict):
                continue
            for key in ("description", "name"):
                if key in span:
                    span[key] = _REDACTED


def _before_sentry_send(
    event: dict[str, Any],
    _hint: dict[str, Any] | None,
) -> dict[str, Any]:
    """Apply a final fail-safe scrub immediately before Sentry transport."""
    scrubbed = _redact_sensitive_fields(event)
    _redact_sentry_messages(scrubbed)
    for key in ("culprit", "transaction"):
        value = scrubbed.get(key)
        if isinstance(value, str):
            scrubbed[key] = _sanitize_url_or_path(value)
    request = scrubbed.get("request")
    if isinstance(request, dict):
        # Bodies can contain report values or PII under arbitrary field names.
        request.pop("data", None)
        request.pop("query_string", None)
        request.pop("raw_query_string", None)
        request_url = request.get("url")
        if isinstance(request_url, str):
            request["url"] = _sanitize_url_or_path(request_url)
    return scrubbed


def _before_sentry_breadcrumb(
    breadcrumb: dict[str, Any],
    _hint: dict[str, Any] | None,
) -> dict[str, Any]:
    """Scrub breadcrumbs before they can be attached to a later event."""
    scrubbed = _redact_sensitive_fields(breadcrumb)
    if "message" in scrubbed:
        scrubbed["message"] = _REDACTED
    return scrubbed


def _safe_exception_details(
    exc_info: tuple[type[BaseException], BaseException, Any],
) -> dict[str, Any]:
    """Keep stack location and exception type without the exception value."""
    exception_type, _exception, trace = exc_info
    return {
        "type": exception_type.__name__,
        "frames": [
            {
                "file": os.path.basename(frame.filename),
                "line": frame.lineno,
                "function": frame.name,
            }
            for frame in traceback.extract_tb(trace)
        ],
    }


# ---------------------------------------------------------------------------
# Root logging configuration — must run before Sentry init
# ---------------------------------------------------------------------------

class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record on a single line."""

    # Attributes from LogRecord that are NOT extra context fields
    _STANDARD = frozenset({
        "args", "asctime", "created", "exc_info", "exc_text", "filename",
        "funcName", "id", "levelname", "levelno", "lineno", "message",
        "module", "msecs", "msg", "name", "pathname", "process",
        "processName", "relativeCreated", "stack_info", "taskName",
        "thread", "threadName",
    })

    def format(self, record: logging.LogRecord) -> str:
        safe_message = (
            str(record.msg)
            if (
                isinstance(record.msg, str)
                and not record.args
                and record.msg in _SAFE_LOG_MESSAGES
            )
            else _REDACTED
        )
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": safe_message,
        }

        # Attach any extra fields passed as extra={...}
        for key, value in record.__dict__.items():
            if key not in self._STANDARD:
                payload[key] = (
                    _REDACTED
                    if _is_sensitive_field_name(key)
                    else _sanitize_url_or_path(value)
                    if (
                        _normalized_field_name(key) in _URL_FIELD_NAMES
                        and isinstance(value, str)
                    )
                    else _redact_sensitive_fields(value)
                )

        # Attach exception traceback when exc_info is present
        if record.exc_info:
            payload["exception"] = _safe_exception_details(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, default=str)


def _configure_root_logger() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    root.setLevel(getattr(logging, level_name, logging.INFO))


_configure_root_logger()

_LOG = logging.getLogger("services.logger")


# ---------------------------------------------------------------------------
# Sentry integration (optional)
# ---------------------------------------------------------------------------

def _init_sentry() -> None:
    """Initialize Sentry SDK when SENTRY_DSN is configured."""
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return  # Sentry disabled — no DSN provided

    try:
        import sentry_sdk  # type: ignore[import]

        sentry_sdk.init(
            dsn=dsn,
            environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            send_default_pii=False,  # Never send PII automatically
            include_local_variables=False,
            max_request_body_size="never",
            before_send=_before_sentry_send,
            before_send_transaction=_before_sentry_send,
            before_breadcrumb=_before_sentry_breadcrumb,
        )
        _LOG.info(
            "Sentry SDK initialized",
            extra={
                "environment": os.getenv("SENTRY_ENVIRONMENT", "production"),
            },
        )
    except ImportError:
        _LOG.warning(
            "sentry-sdk not installed — Sentry integration disabled. "
            "Run: pip install sentry-sdk"
        )
    except Exception:
        _LOG.error("Failed to initialize Sentry SDK", exc_info=True)


_init_sentry()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_logger(name: str) -> logging.Logger:
    """Return a structured JSON logger.

    Example::

        log = get_logger(__name__)
        log.info("Report submitted", extra={"report_id": report_id})
        log.error("DB error", exc_info=True, extra={"village_id": village_id})
    """
    return logging.getLogger(name)


__all__ = ["get_logger"]
