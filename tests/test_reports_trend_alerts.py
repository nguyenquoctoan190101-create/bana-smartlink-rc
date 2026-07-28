from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from services.settings import load_settings as _ls
    _ls.cache_clear()

    fake_settings = MagicMock()
    fake_settings.supabase_jwt_secret = "test-jwt"
    fake_settings.allowed_origin = "http://localhost:3000"
    fake_settings.supabase_url = "https://fake.supabase.co"
    fake_settings.supabase_service_role_key = "fake-service-key"
    fake_settings.normalized_supabase_url = "https://fake.supabase.co"

    with patch("services.settings.load_settings", return_value=fake_settings):
        from main import create_app
        app = create_app()
        # Stub the supabase client dependency
        from routers.auth import get_supabase_admin, require_authenticated_user
        from services.supabase_admin import UserProfile
        fake_supabase = MagicMock()
        fake_supabase.as_user.return_value = fake_supabase
        app.dependency_overrides[get_supabase_admin] = lambda: fake_supabase
        app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
            id=str(uuid4()), role="lanh_dao", village_id=None, force_password_reset=False
        )
        yield TestClient(app)
        app.dependency_overrides.clear()


def test_get_trend_alerts_fails_closed_without_governed_rules(
    client: TestClient,
) -> None:
    curr_id = uuid4()
    prev_id = uuid4()
    from routers.auth import get_supabase_admin
    fake_supabase = client.app.dependency_overrides[get_supabase_admin]()
    fake_supabase._rest_request = AsyncMock(
        side_effect=AssertionError("governance gate must not query data"),
    )

    response = client.get(
        f"/reports/trend-alerts?curr_period_id={curr_id}&prev_period_id={prev_id}",
        headers={"Authorization": "Bearer caller-jwt"},
    )

    assert response.status_code == 409
    payload = response.json()
    message = (
        "Cảnh báo biến động chưa được bật vì registry chưa có "
        "quy tắc đã phê duyệt cho từng chỉ tiêu."
    )
    assert payload["code"] == "ALERT_RULE_NOT_GOVERNED"
    assert payload["message"] == message
    assert payload["details"] == {
        "code": "ALERT_RULE_NOT_GOVERNED",
        "message": message,
        "required_metadata": [
            "absolute_threshold",
            "relative_threshold",
            "baseline",
            "direction",
            "owner",
            "effective_from",
        ],
    }
    assert isinstance(payload["request_id"], str) and payload["request_id"]
    fake_supabase.as_user.assert_not_called()
    fake_supabase._rest_request.assert_not_awaited()


def test_get_report_periods_success(client: TestClient) -> None:
    # mock rest response on fake_supabase
    # we get fake_supabase from app dependency overrides (set in client fixture)
    from routers.auth import get_supabase_admin
    fake_supabase = client.app.dependency_overrides[get_supabase_admin]()
    fake_supabase._rest_request = AsyncMock(return_value=[
        {"id": "p1", "name": "Period 1", "due_date": "2026-06-30"}
    ])

    response = client.get(
        "/reports/periods",
        headers={"Authorization": "Bearer caller-jwt"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Period 1"
    fake_supabase.as_user.assert_called_with("caller-jwt")
