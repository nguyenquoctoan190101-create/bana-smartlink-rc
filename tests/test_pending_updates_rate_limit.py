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
    fake_settings.supabase_jwt_secret = "test-jwt-secret"
    fake_settings.allowed_origin = "http://localhost:3000"
    fake_settings.supabase_url = "https://fake.supabase.co"
    fake_settings.supabase_service_role_key = "fake-service-key"
    fake_settings.zalo_app_secret = "fake-zalo-secret"
    fake_settings.zalo_oa_access_token = "fake-token"
    fake_settings.zalo_oa_message_url = "https://fake-zalo.oa/message"
    fake_settings.normalized_supabase_url = "https://fake.supabase.co"
    fake_settings.database_url = "postgresql:///test"
    fake_settings.gemini_api_key = "fake-gemini-key"
    fake_settings.gemini_api_url = "https://generativelanguage.googleapis.com"
    fake_settings.gemini_model = "gemini-2.5-flash"
    fake_settings.bana_commune_id = "ba_na"

    with patch("services.settings.load_settings", side_effect=lambda: fake_settings):
        from main import create_app
        app = create_app()
        from routers.auth import get_settings
        app.dependency_overrides[get_settings] = lambda: fake_settings
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c
        app.dependency_overrides.clear()

    _ls.cache_clear()


def test_rate_limit_pending_updates(client: TestClient):
    """
    Gọi POST /auth/citizen/pending-updates liên tục 11 lần.
    Xác nhận 10 lần đầu trả về thành công (hoặc lỗi hợp lệ khác 429),
    lần thứ 11 phải trả về 429 Too Many Requests.
    """
    payload = {
        "village_id": str(uuid4()),
        "report_period": "Tháng 7/2026",
        "ct_code": "CT01",
            "proposed_value": 15,
            "proposed_by_phone": "0935311350",
            "privacy_consent": True,
        }

    resolved_report_id = str(uuid4())
    with patch(
        "services.supabase_admin.SupabaseAdminClient._rest_request",
        new_callable=AsyncMock,
        return_value=[{
            "id": resolved_report_id,
            "village_id": payload["village_id"],
            "report_periods": {"name": payload["report_period"]},
        }],
    ), patch(
        "services.supabase_admin.SupabaseAdminClient.insert_pending_update",
        new_callable=AsyncMock,
        return_value={
            "id": str(uuid4()),
            "report_id": resolved_report_id,
            "ct_code": "CT01",
            "proposed_value": 15,
            "status": "pending",
        },
    ):
        for i in range(10):
            response = client.post("/auth/citizen/pending-updates", json=payload)
            assert response.status_code != 429, f"Request thứ {i+1} bị chặn sớm với 429"

        # Lần thứ 11
        response = client.post("/auth/citizen/pending-updates", json=payload)
        assert response.status_code == 429, f"Request thứ 11 không bị chặn, trả về {response.status_code}"
