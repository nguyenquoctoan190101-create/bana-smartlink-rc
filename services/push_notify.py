from __future__ import annotations

import json
from typing import Any

from services.logger import get_logger
from services.settings import load_settings

_log = get_logger(__name__)


def get_db_connection():
    """Open a synchronous PostgreSQL connection for the worker thread."""
    settings = load_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    try:
        import psycopg2
    except ImportError as exc:
        raise RuntimeError("PostgreSQL push dependency is unavailable") from exc
    return psycopg2.connect(settings.database_url)


def send_push(user_id: str, title: str, body: str, url: str | None = None) -> bool:
    """Persist an in-app notification and best-effort deliver Web Push.

    This function is synchronous by design and is called through
    ``asyncio.to_thread`` by the request layer.  Database failures never fall
    back to process memory because that would acknowledge data that is lost on
    restart.
    """
    if url is not None and (not url.startswith("/") or url.startswith("//")):
        raise ValueError("Notification URL must be an application-relative path")

    settings = load_settings()
    connection = get_db_connection()
    subscriptions: list[dict[str, Any]] = []
    try:
        from psycopg2.extras import RealDictCursor

        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO notifications (user_id, title, body, url, is_read, read_at)
                VALUES (%s::uuid, %s, %s, %s, FALSE, NULL)
                """,
                (user_id, title, body, url),
            )
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT id, endpoint, keys_p256dh, keys_auth
                FROM push_subscriptions
                WHERE user_id = %s::uuid
                """,
                (user_id,),
            )
            subscriptions = [dict(row) for row in cursor.fetchall()]
        connection.commit()

        private_key = getattr(settings, "vapid_private_key", "")
        contact = getattr(settings, "vapid_contact", "mailto:admin@bana.gov.vn")
        if not subscriptions or not private_key:
            return True

        try:
            from pywebpush import WebPushException, webpush
        except ImportError as exc:
            raise RuntimeError("Web Push dependency is unavailable") from exc

        payload = json.dumps(
            {"title": title, "body": body, "url": url or "/"},
            ensure_ascii=False,
        )
        expired: list[str] = []
        delivered = 0
        for subscription in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": subscription["endpoint"],
                        "keys": {
                            "p256dh": subscription["keys_p256dh"],
                            "auth": subscription["keys_auth"],
                        },
                    },
                    data=payload,
                    vapid_private_key=private_key.replace("\\n", "\n"),
                    vapid_claims={"sub": contact},
                )
                delivered += 1
            except WebPushException as exc:
                if exc.response is not None and exc.response.status_code in {404, 410}:
                    expired.append(str(subscription["id"]))
                else:
                    _log.warning("Web Push delivery failed")

        if expired:
            with connection.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM push_subscriptions WHERE id = ANY(%s::uuid[])",
                    (expired,),
                )
            connection.commit()
        return delivered > 0 or bool(subscriptions)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


__all__ = ["get_db_connection", "send_push"]
