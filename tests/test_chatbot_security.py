from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace
from main import app
from tests.test_security_regressions import _make_jwt

def test_chatbot_ct14_security():
    client = TestClient(app)

    # Mock gemini to return the prompt it received
    class FakeGemini:
        async def generate_text(self, *args, **kwargs):
            return args[1] if len(args) > 1 else str(args)

    class MockConnection:
        async def fetch(self, *args, **kwargs):
            return [{"village_name": "Tà Lang", "period_name": "Kỳ 1", "ct_code": "CT14", "value": 99, "status": "approved"}]
        async def close(self): pass

    from routers.auth import get_optional_user
    from services.supabase_admin import UserProfile
    
    def mock_get_optional_user_dan():
        return None
        
    def mock_get_optional_user_admin():
        return UserProfile(
            id="123",
            role="admin_xa",
            village_id=None,
            force_password_reset=False,
            commune_id="ba_na",
        )

    import asyncpg
    with patch("services.chatbot.get_gemini_client", return_value=FakeGemini()), patch(
        "services.chatbot.load_settings",
        return_value=SimpleNamespace(database_url="postgresql://test"),
    ):
        with patch.object(asyncpg, "connect", new_callable=AsyncMock, return_value=MockConnection()):
            
            # 1. Gọi ẩn danh (dân)
            app.dependency_overrides[get_optional_user] = mock_get_optional_user_dan
            res_dan = client.post("/ai/chat", json={"question": "Thôn Tà Lang có bao nhiêu vụ bạo lực gia đình?"})
            assert res_dan.status_code == 200
            ans_dan = res_dan.json()["answer"].lower()
            assert "không thuộc phạm vi dữ liệu công khai" in ans_dan
            assert "ct14" in ans_dan
            assert "99" not in ans_dan, f"Dân không được phép thấy CT14, nhưng nhận được: {ans_dan}"

            # 2. Gọi với quyền admin
            app.dependency_overrides[get_optional_user] = mock_get_optional_user_admin
            token = _make_jwt(role="admin_xa")
            res_admin = client.post("/ai/chat", json={"question": "Thôn Tà Lang có bao nhiêu vụ bạo lực gia đình?"}, headers={"Authorization": f"Bearer {token}"})
            assert res_admin.status_code == 200
            ans_admin = res_admin.json()["answer"]
            assert "99" in ans_admin, f"Admin phải thấy số liệu CT14, nhưng nhận được: {ans_admin}"
