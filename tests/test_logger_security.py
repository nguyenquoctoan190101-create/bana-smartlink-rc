from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import Request

from main import _route_template
from services import logger as logger_module


def test_json_formatter_redacts_sensitive_extra_fields() -> None:
    record = logging.LogRecord(
        "test",
        logging.INFO,
        __file__,
        1,
        "Gemini provider request rejected",
        (),
        None,
    )
    record.authorization = "Bearer secret"
    record.provider = {
        "payload": {"phone": "0900000000"},
        "status": 400,
    }
    record.settings = {
        "gemini_api_key": "provider-secret-gemini",
        "openai_api_key": "provider-secret-openai",
        "client_secret": "provider-secret-client",
        "jwt_secret": "provider-secret-jwt",
        "supabase_service_role_key": "provider-secret-service-role",
        "safe_timeout": 45,
    }
    record.url = (
        "https://service.example/api/cases/track/provider-secret-capability"
        "?token=provider-secret-query"
    )
    record.path = (
        "/auth/citizen/pending-updates/provider-secret-capability"
        "?token=provider-secret-query"
    )
    record.request_uri = (
        "/api/cases/track/provider-secret-capability"
        "?token=provider-secret-query"
    )
    setattr(
        record,
        "http.url",
        (
            "https://service.example/auth/citizen/pending-updates/"
            "provider-secret-capability?token=provider-secret-query"
        ),
    )

    payload = json.loads(logger_module._JsonFormatter().format(record))

    assert payload["message"] == "Gemini provider request rejected"
    assert payload["authorization"] == "[REDACTED]"
    assert payload["provider"] == {
        "payload": "[REDACTED]",
        "status": 400,
    }
    assert payload["settings"] == {
        "gemini_api_key": "[REDACTED]",
        "openai_api_key": "[REDACTED]",
        "client_secret": "[REDACTED]",
        "jwt_secret": "[REDACTED]",
        "supabase_service_role_key": "[REDACTED]",
        "safe_timeout": 45,
    }
    assert payload["url"] == (
        "https://service.example/api/cases/track/[REDACTED]"
    )
    assert payload["path"] == (
        "/auth/citizen/pending-updates/[REDACTED]"
    )
    assert payload["request_uri"] == "/api/cases/track/[REDACTED]"
    assert payload["http.url"] == (
        "https://service.example/auth/citizen/pending-updates/[REDACTED]"
    )


def test_before_sentry_send_removes_request_body_and_credentials() -> None:
    event = {
        "message": "provider-secret-top-level",
        "logentry": {
            "message": "provider-secret-template",
            "formatted": "provider-secret-formatted",
        },
        "exception": {
            "values": [
                {
                    "type": "RuntimeError",
                    "value": "provider-secret-exception",
                    "stacktrace": {"frames": [{"function": "safe_function"}]},
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {
                    "message": "provider-secret-breadcrumb",
                    "data": {
                        "url": (
                            "https://service.example/api/cases/track/"
                            "provider-secret-tracking?token=query-secret"
                        ),
                    },
                }
            ]
        },
        "transaction": (
            "GET /auth/citizen/pending-updates/provider-secret-transaction"
        ),
        "spans": [
            {
                "op": "http.client",
                "description": (
                    "GET https://service.example/auth/citizen/pending-updates/"
                    "provider-secret-span?tracking_code=provider-secret-query"
                ),
                "data": {
                    "http.url": (
                        "https://service.example/auth/citizen/pending-updates/"
                        "provider-secret-span?tracking_code=provider-secret-query"
                    ),
                    "url.full": (
                        "https://service.example/api/cases/track/"
                        "provider-secret-case?tracking_code=provider-secret-query"
                    ),
                    "http.query": (
                        "tracking_code=provider-secret-query"
                    ),
                    "http.status_code": 200,
                },
            }
        ],
        "request": {
            "data": {"phone": "0900000000"},
            "query_string": "access_token=query-secret",
            "url": (
                "https://service.example/auth/citizen/pending-updates/"
                "provider-secret-tracking?access_token=query-secret"
            ),
            "headers": {
                "Authorization": "Bearer secret",
                "Content-Type": "application/json",
            },
        },
        "extra": {
            "prompt": "provider input",
            "safe_count": 2,
        },
    }

    scrubbed = logger_module._before_sentry_send(event, None)

    assert "data" not in scrubbed["request"]
    assert "query_string" not in scrubbed["request"]
    assert scrubbed["request"]["url"] == (
        "https://service.example/auth/citizen/pending-updates/[REDACTED]"
    )
    assert scrubbed["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert scrubbed["request"]["headers"]["Content-Type"] == "application/json"
    assert scrubbed["extra"] == {
        "prompt": "[REDACTED]",
        "safe_count": 2,
    }
    assert scrubbed["message"] == "[REDACTED]"
    assert scrubbed["logentry"] == {
        "message": "[REDACTED]",
        "formatted": "[REDACTED]",
    }
    assert scrubbed["exception"]["values"][0]["value"] == "[REDACTED]"
    assert scrubbed["exception"]["values"][0]["type"] == "RuntimeError"
    assert scrubbed["exception"]["values"][0]["stacktrace"] == {
        "frames": [{"function": "safe_function"}]
    }
    breadcrumb = scrubbed["breadcrumbs"]["values"][0]
    assert breadcrumb["message"] == "[REDACTED]"
    assert breadcrumb["data"]["url"] == (
        "https://service.example/api/cases/track/[REDACTED]"
    )
    assert scrubbed["transaction"] == (
        "GET /auth/citizen/pending-updates/[REDACTED]"
    )
    assert scrubbed["spans"] == [
        {
            "op": "http.client",
            "description": "[REDACTED]",
            "data": {
                "http.url": (
                    "https://service.example/auth/citizen/pending-updates/"
                    "[REDACTED]"
                ),
                "url.full": (
                    "https://service.example/api/cases/track/[REDACTED]"
                ),
                "http.query": "[REDACTED]",
                "http.status_code": 200,
            },
        }
    ]


def test_json_formatter_drops_free_form_messages_and_exception_values() -> None:
    try:
        raise RuntimeError("provider-secret-exception-value")
    except RuntimeError:
        exc_info = sys.exc_info()

    record = logging.LogRecord(
        "uvicorn.access",
        logging.ERROR,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        (
            "127.0.0.1",
            "GET",
            "/api/cases/track/provider-secret-tracking",
            "1.1",
            200,
        ),
        exc_info,
    )

    serialized = logger_module._JsonFormatter().format(record)
    payload = json.loads(serialized)

    assert "provider-secret" not in serialized
    assert payload["message"] == "[REDACTED]"
    assert payload["exception"]["type"] == "RuntimeError"
    assert payload["exception"]["frames"][-1]["function"] == (
        "test_json_formatter_drops_free_form_messages_and_exception_values"
    )


def test_before_sentry_breadcrumb_drops_message_and_capability_path() -> None:
    scrubbed = logger_module._before_sentry_breadcrumb(
        {
            "message": "provider-secret-message",
            "data": {
                "url": (
                    "https://service.example/api/cases/track/"
                    "provider-secret-tracking?key=provider-secret-key"
                ),
                "status_code": 200,
            },
        },
        None,
    )

    assert scrubbed == {
        "message": "[REDACTED]",
        "data": {
            "url": "https://service.example/api/cases/track/[REDACTED]",
            "status_code": 200,
        },
    }


def test_server_uses_route_templates_and_disables_raw_access_logs() -> None:
    request = Request({
        "type": "http",
        "route": SimpleNamespace(path="/api/cases/track/{tracking_code}"),
    })

    assert _route_template(request) == "/api/cases/track/{tracking_code}"
    assert "--no-access-log" in Path("Dockerfile").read_text(encoding="utf-8")


def test_sentry_initialization_disables_sensitive_capture(monkeypatch) -> None:
    sentry_init = Mock()
    sentry_module = SimpleNamespace(init=sentry_init)
    info = Mock()
    monkeypatch.setitem(sys.modules, "sentry_sdk", sentry_module)
    monkeypatch.setenv("SENTRY_DSN", "https://public-key@example.invalid/1")
    monkeypatch.setattr(logger_module._LOG, "info", info)

    logger_module._init_sentry()

    sentry_init.assert_called_once()
    kwargs = sentry_init.call_args.kwargs
    assert kwargs["send_default_pii"] is False
    assert kwargs["include_local_variables"] is False
    assert kwargs["max_request_body_size"] == "never"
    assert kwargs["before_send"] is logger_module._before_sentry_send
    assert kwargs["before_send_transaction"] is logger_module._before_sentry_send
    assert kwargs["before_breadcrumb"] is logger_module._before_sentry_breadcrumb
    assert info.call_args.kwargs["extra"] == {"environment": "production"}
