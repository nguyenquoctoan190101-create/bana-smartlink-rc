from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.push_notify import get_db_connection, send_push
from services.settings import Settings


class Cursor:
    def __init__(self, rows=None, fail=False):
        self.rows = rows or []
        self.fail = fail
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params):
        if self.fail:
            raise RuntimeError("database write failed")
        self.executions.append((sql, params))

    def fetchall(self):
        return self.rows


class Connection:
    def __init__(self, subscriptions=None, fail_first=False):
        self.insert_cursor = Cursor(fail=fail_first)
        self.select_cursor = Cursor(subscriptions)
        self.delete_cursor = Cursor()
        self._cursors = [self.insert_cursor, self.select_cursor, self.delete_cursor]
        self.commit = MagicMock()
        self.rollback = MagicMock()
        self.close = MagicMock()

    def cursor(self, *args, **kwargs):
        return self._cursors.pop(0)


def _settings(private_key: str = "") -> Settings:
    return Settings(
        _env_file=None,
        database_url="postgresql://localhost/test",
        vapid_private_key=private_key,
        vapid_contact="mailto:test@example.test",
    )


def test_notification_url_is_restricted_to_same_origin_path() -> None:
    for unsafe in ("https://evil.example", "//evil.example", "javascript:alert(1)"):
        with pytest.raises(ValueError, match="application-relative"):
            send_push("u1", "title", "body", unsafe)


def test_notification_is_persisted_even_without_web_push_subscription() -> None:
    connection = Connection([])
    with patch("services.push_notify.load_settings", return_value=_settings()), patch(
        "services.push_notify.get_db_connection", return_value=connection
    ):
        assert send_push("00000000-0000-0000-0000-000000000001", "Nhắc việc", "Đến hạn", "/app") is True
    insert = connection.insert_cursor.executions[0]
    assert "INSERT INTO notifications" in insert[0]
    assert insert[1][-1] == "/app"
    connection.commit.assert_called_once()
    connection.rollback.assert_not_called()
    connection.close.assert_called_once()


def test_database_failure_rolls_back_and_never_acknowledges_in_memory() -> None:
    connection = Connection([], fail_first=True)
    with patch("services.push_notify.load_settings", return_value=_settings()), patch(
        "services.push_notify.get_db_connection", return_value=connection
    ):
        with pytest.raises(RuntimeError, match="database write failed"):
            send_push("00000000-0000-0000-0000-000000000001", "T", "B")
    connection.rollback.assert_called_once()
    connection.close.assert_called_once()


def _install_fake_pywebpush(webpush, exception_type):
    module = ModuleType("pywebpush")
    module.webpush = webpush
    module.WebPushException = exception_type
    return patch.dict(sys.modules, {"pywebpush": module})


def test_web_push_delivery_uses_vapid_and_multiline_private_key() -> None:
    subscription = {
        "id": "00000000-0000-0000-0000-000000000011",
        "endpoint": "https://push.example/sub",
        "keys_p256dh": "p256dh", "keys_auth": "auth",
    }
    connection = Connection([subscription])
    webpush = MagicMock()
    class WebPushException(Exception):
        response = None

    with _install_fake_pywebpush(webpush, WebPushException), patch(
        "services.push_notify.load_settings", return_value=_settings("line1\\nline2")
    ), patch("services.push_notify.get_db_connection", return_value=connection):
        assert send_push("00000000-0000-0000-0000-000000000001", "T", "B", "/app") is True
    kwargs = webpush.call_args.kwargs
    assert kwargs["vapid_private_key"] == "line1\nline2"
    assert kwargs["vapid_claims"] == {"sub": "mailto:test@example.test"}
    assert '"url": "/app"' in kwargs["data"]


def test_expired_subscription_is_deleted_and_other_delivery_continues() -> None:
    subscriptions = [
        {"id": "00000000-0000-0000-0000-000000000011", "endpoint": "expired", "keys_p256dh": "p", "keys_auth": "a"},
        {"id": "00000000-0000-0000-0000-000000000012", "endpoint": "ok", "keys_p256dh": "p", "keys_auth": "a"},
    ]
    connection = Connection(subscriptions)
    class WebPushException(Exception):
        def __init__(self, status_code):
            self.response = SimpleNamespace(status_code=status_code)
    def webpush(**kwargs):
        if kwargs["subscription_info"]["endpoint"] == "expired":
            raise WebPushException(410)

    with _install_fake_pywebpush(webpush, WebPushException), patch(
        "services.push_notify.load_settings", return_value=_settings("private")
    ), patch("services.push_notify.get_db_connection", return_value=connection):
        assert send_push("00000000-0000-0000-0000-000000000001", "T", "B") is True
    delete_sql, delete_params = connection.delete_cursor.executions[0]
    assert "DELETE FROM push_subscriptions" in delete_sql
    assert delete_params[0] == ["00000000-0000-0000-0000-000000000011"]
    assert connection.commit.call_count == 2


def test_get_db_connection_requires_dsn_and_uses_configured_dsn() -> None:
    with patch("services.push_notify.load_settings", return_value=Settings(_env_file=None)):
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            get_db_connection()

    connect = MagicMock(return_value=object())
    fake_psycopg2 = ModuleType("psycopg2")
    fake_psycopg2.connect = connect
    with patch.dict(sys.modules, {"psycopg2": fake_psycopg2}), patch(
        "services.push_notify.load_settings", return_value=_settings()
    ):
        result = get_db_connection()
    assert result is connect.return_value
    connect.assert_called_once_with("postgresql://localhost/test")
