from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from routers.auth import get_db, require_admin_xa
from services.supabase_admin import UserProfile


def test_notify_villages_requires_admin_and_uses_database_scope():
    client = TestClient(app)
    village_id = uuid4()
    user_id = uuid4()
    connection = AsyncMock()
    connection.fetch.return_value = [{"id": str(user_id)}]
    app.dependency_overrides[require_admin_xa] = lambda: UserProfile(
        id=str(uuid4()), role="admin_xa", village_id=None, force_password_reset=False
    )
    app.dependency_overrides[get_db] = lambda: connection
    payload = {
        "villages": [str(village_id)],
        "period_name": "Quý 4/2026",
        "deadline": "2026-12-31",
    }
    try:
        with patch("routers.push.notify_user", new_callable=AsyncMock, return_value=True) as notify:
            response = client.post("/api/push/notify-villages", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["notified_count"] == 1
        notify.assert_awaited_once()
        connection.fetch.assert_awaited_once()
        query, village_ids, actor_id = connection.fetch.await_args.args
        assert "target.commune_id = actor.commune_id" in query
        assert village_ids == [str(village_id)]
        assert actor_id
    finally:
        app.dependency_overrides.pop(require_admin_xa, None)
        app.dependency_overrides.pop(get_db, None)


def test_send_test_push_rejects_target_outside_admin_commune():
    client = TestClient(app)
    connection = AsyncMock()
    connection.fetchval.return_value = False
    admin_id = str(uuid4())
    target_id = uuid4()
    app.dependency_overrides[require_admin_xa] = lambda: UserProfile(
        id=admin_id,
        role="admin_xa",
        village_id=None,
        force_password_reset=False,
        commune_id="ba_na",
    )
    app.dependency_overrides[get_db] = lambda: connection
    try:
        with patch("routers.push.notify_user", new_callable=AsyncMock) as notify:
            response = client.post(
                "/api/push/send-test",
                json={
                    "user_id": str(target_id),
                    "title": "Kiểm tra",
                    "body": "Không được gửi chéo xã",
                },
            )
        assert response.status_code == 404
        notify.assert_not_awaited()
        query, queried_target, queried_actor = connection.fetchval.await_args.args
        assert "target.commune_id = actor.commune_id" in query
        assert queried_target == target_id
        assert queried_actor == admin_id
    finally:
        app.dependency_overrides.pop(require_admin_xa, None)
        app.dependency_overrides.pop(get_db, None)
