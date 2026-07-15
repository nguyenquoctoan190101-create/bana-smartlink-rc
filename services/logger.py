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
import sys
import traceback
from datetime import datetime, timezone
from typing import Any


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
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Attach any extra fields passed as extra={...}
        for key, value in record.__dict__.items():
            if key not in self._STANDARD:
                payload[key] = value

        # Attach exception traceback when exc_info is present
        if record.exc_info:
            payload["exception"] = "".join(traceback.format_exception(*record.exc_info))

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
        )
        _LOG.info(
            "Sentry SDK initialized",
            extra={
                "dsn_prefix": dsn[:20] + "...",
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
