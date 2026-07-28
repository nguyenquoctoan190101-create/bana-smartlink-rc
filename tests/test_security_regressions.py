"""
tests/test_security_regressions.py
====================================
Bộ kiểm tra hồi quy bảo mật (Security Regression Tests) cho Ba Na SmartLink API.

Mỗi test kiểm tra đúng một lỗ hổng từng tồn tại hoặc có nguy cơ xuất hiện.
Không có test nào cần kết nối DB hoặc Supabase thật — toàn bộ phụ thuộc bên
ngoài được thay thế bằng mock/stub để đảm bảo test chạy được trong CI/CD.

Quy ước đặt tên:
  test_<route>__<điều kiện>__<hành vi kỳ vọng>
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers: tạo JWT test (ký bằng secret giả)
# ---------------------------------------------------------------------------

_TEST_JWT_SECRET = "test-jwt-secret-do-not-use-in-production"
_WRONG_JWT_SECRET = "completely-wrong-secret"


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _make_jwt(
    sub: str = str(uuid4()),
    role: str = "admin_xa",
    village_id: str | None = None,
    exp_offset: int = 3600,  # giây so với hiện tại; âm → đã hết hạn
    secret: str = _TEST_JWT_SECRET,
) -> str:
    """Tạo JWT HS256 để kiểm tra — KHÔNG dùng trong production."""
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    now = int(time.time())
    payload_dict: dict[str, Any] = {
        "sub": sub,
        "role": role,
        "exp": now + exp_offset,
        "iat": now,
    }
    if village_id:
        payload_dict["village_id"] = village_id

    payload = _b64url_encode(json.dumps(payload_dict).encode())
    signing_input = f"{header}.{payload}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature = _b64url_encode(sig)
    return f"{header}.{payload}.{signature}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Payload hợp lệ để POST /auth/staff-users
_VALID_PAYLOAD = {
    "email": "canbo@example.com",
    "display_name": "Nguyễn Văn A",
    "role": "can_bo_thon",
    "village_id": str(uuid4()),
}


@pytest.fixture()
def client():
    """
    Tạo TestClient với Settings và Supabase được mock hoàn toàn.

    Chiến lược:
      - conftest.py đã stub asyncpg vào sys.modules trước khi collect.
      - Fixture này clear lru_cache rồi patch load_settings trả fake_settings.
      - Import create_app bên trong patch context để mọi Depends() đều nhận
        fake_settings mà không cần mock từng router một.
    """
    from services.settings import load_settings as _ls
    _ls.cache_clear()

    fake_settings = MagicMock()
    fake_settings.supabase_jwt_secret = _TEST_JWT_SECRET
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

    with patch("services.settings.load_settings", side_effect=lambda: fake_settings):
        # Import bên trong context để Depends(get_settings) nhận fake
        from main import create_app  # noqa: PLC0415
        app = create_app()
        from routers.auth import get_settings  # noqa: PLC0415
        app.dependency_overrides[get_settings] = lambda: fake_settings
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c
        app.dependency_overrides.clear()

    _ls.cache_clear()


def _admin_headers(secret: str = _TEST_JWT_SECRET) -> dict[str, str]:
    """Header với JWT hợp lệ của admin_xa."""
    token = _make_jwt(role="admin_xa", secret=secret)
    return {"Authorization": f"Bearer {token}"}


def _staff_headers(village_id: str | None = None) -> dict[str, str]:
    """Header với JWT hợp lệ của can_bo_thon (không phải admin)."""
    token = _make_jwt(role="can_bo_thon", village_id=village_id)
    return {"Authorization": f"Bearer {token}"}


# ===========================================================================
# NHÓM 1 — POST /auth/staff-users (tương đương create-officer)
# ===========================================================================

class TestCreateStaffUser:

    def test__no_auth_header__returns_401(self, client: TestClient):
        """Lỗ hổng #1: Gọi mà không có Authorization header → phải trả 401."""
        response = client.post("/auth/staff-users", json=_VALID_PAYLOAD)
        assert response.status_code == 401, (
            f"Expected 401, got {response.status_code}. "
            "Endpoint phải yêu cầu xác thực trước khi xử lý bất kỳ logic nào."
        )

    def test__role_can_bo_thon__returns_403(self, client: TestClient):
        """Lỗ hổng #2: JWT hợp lệ nhưng role can_bo_thon → phải trả 403."""
        # Mock get_user_profile để trả về profile can_bo_thon
        profile_stub = MagicMock()
        profile_stub.role = "can_bo_thon"
        with patch(
            "services.supabase_admin.SupabaseAdminClient.get_user_profile",
            new_callable=AsyncMock,
            return_value=profile_stub,
        ):
            response = client.post(
                "/auth/staff-users",
                json=_VALID_PAYLOAD,
                headers=_staff_headers(),
            )
        assert response.status_code == 403, (
            f"Expected 403, got {response.status_code}. "
            "Chỉ admin_xa mới được tạo tài khoản nhân viên."
        )

    def test__role_lanh_dao__returns_403(self, client: TestClient):
        """Role lanh_dao cũng không được phép tạo tài khoản nhân viên."""
        token = _make_jwt(role="lanh_dao")
        profile_stub = MagicMock()
        profile_stub.role = "lanh_dao"
        with patch(
            "services.supabase_admin.SupabaseAdminClient.get_user_profile",
            new_callable=AsyncMock,
            return_value=profile_stub,
        ):
            response = client.post(
                "/auth/staff-users",
                json=_VALID_PAYLOAD,
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 403

    def test__expired_jwt__returns_401(self, client: TestClient):
        """Lỗ hổng #5a: JWT hết hạn (exp trong quá khứ) → phải trả 401."""
        token = _make_jwt(role="admin_xa", exp_offset=-1)  # đã hết hạn 1 giây trước
        response = client.post(
            "/auth/staff-users",
            json=_VALID_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401, (
            f"Expected 401, got {response.status_code}. "
            "JWT hết hạn phải bị từ chối ngay lập tức."
        )

    def test__wrong_signature__returns_401(self, client: TestClient):
        """Lỗ hổng #5b: JWT ký bằng secret sai → phải trả 401."""
        token = _make_jwt(role="admin_xa", secret=_WRONG_JWT_SECRET)
        response = client.post(
            "/auth/staff-users",
            json=_VALID_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401, (
            f"Expected 401, got {response.status_code}. "
            "JWT ký sai secret phải bị từ chối (chữ ký không khớp)."
        )

    def test__malformed_jwt__returns_401(self, client: TestClient):
        """JWT bị cắt bớt / không đúng định dạng → phải trả 401."""
        response = client.post(
            "/auth/staff-users",
            json=_VALID_PAYLOAD,
            headers={"Authorization": "Bearer not.a.real.jwt.at.all"},
        )
        assert response.status_code == 401

    def test__bearer_scheme_required__returns_401(self, client: TestClient):
        """Authorization header không dùng scheme 'Bearer' → phải trả 401."""
        token = _make_jwt(role="admin_xa")
        response = client.post(
            "/auth/staff-users",
            json=_VALID_PAYLOAD,
            headers={"Authorization": f"Token {token}"},  # sai scheme
        )
        assert response.status_code == 401


# ===========================================================================
# NHÓM 2 — POST /auth/citizen/pending-updates (Direct submission)
# ===========================================================================

class TestPendingUpdates:

    def test__valid_submission_accepted(self, client: TestClient):
        """Đề xuất hợp lệ được lưu thẳng vào database mà không cần OTP."""
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
            return_value={"id": str(uuid4()), "report_id": resolved_report_id, "ct_code": "CT01", "proposed_value": 15, "status": "pending"}
        ) as mock_insert:
            response = client.post("/auth/citizen/pending-updates", json=payload)
            
        assert response.status_code == 201
        mock_insert.assert_called_once_with(
            report_id=resolved_report_id,
            ct_code="CT01",
            proposed_value=15,
            submitter_name=None,
            submitter_phone="0935311350",
            submitter_household=None,
            submitter_address=None,
            submitter_relation=None,
            explanation=None,
            consent_version="2026-07-13",
        )

    def test__invalid_phone_rejected(self, client: TestClient):
        """Số điện thoại không hợp lệ bị từ chối ngay lập tức."""
        payload = {
            "village_id": str(uuid4()),
            "report_period": "Tháng 7/2026",
            "ct_code": "CT01",
            "proposed_value": 15,
            "proposed_by_phone": "123", # Invalid phone
            "privacy_consent": True,
        }
        response = client.post("/auth/citizen/pending-updates", json=payload)
        assert response.status_code == 400
        assert "Số điện thoại không hợp lệ" in response.json()["message"]


# ===========================================================================
# NHÓM 4 — Kiểm tra JWT manipulation (tamper)
# ===========================================================================

class TestJwtTampering:

    def test__tampered_role_in_payload__returns_401(self, client: TestClient):
        """
        Kẻ tấn công tạo JWT với role='admin_xa' nhưng ký bằng secret sai.
        Phải bị từ chối vì chữ ký không khớp.
        """
        # Tạo payload giả mạo: role admin_xa nhưng ký bằng secret sai
        token = _make_jwt(role="admin_xa", secret=_WRONG_JWT_SECRET)
        response = client.post(
            "/auth/staff-users",
            json=_VALID_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    def test__payload_only_no_signature__returns_401(self, client: TestClient):
        """JWT có header và payload nhưng signature rỗng → từ chối."""
        header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        payload_dict = {
            "sub": str(uuid4()),
            "role": "admin_xa",
            "exp": int(time.time()) + 3600,
        }
        payload = _b64url_encode(json.dumps(payload_dict).encode())
        token = f"{header}.{payload}."  # signature rỗng

        response = client.post(
            "/auth/staff-users",
            json=_VALID_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    def test__none_algorithm_attack__returns_401(self, client: TestClient):
        """
        'alg: none' attack: kẻ tấn công gửi JWT với alg=none, bỏ signature.
        Hệ thống phải từ chối vì chỉ chấp nhận HS256.
        """
        header = _b64url_encode(json.dumps({"alg": "none", "typ": "JWT"}).encode())
        payload_dict = {
            "sub": str(uuid4()),
            "role": "admin_xa",
            "exp": int(time.time()) + 3600,
        }
        payload = _b64url_encode(json.dumps(payload_dict).encode())
        token = f"{header}.{payload}."

        response = client.post(
            "/auth/staff-users",
            json=_VALID_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401, (
            "alg:none attack phải bị từ chối. "
            "Hệ thống chỉ chấp nhận HS256."
        )


# ===========================================================================
# NHÓM 5 — Kiểm tra unit: services/security.py
# ===========================================================================

class TestSecurityServiceUnit:
    """Unit test trực tiếp verify_supabase_jwt, không cần HTTP client."""

    def test__valid_token_returns_claims(self):
        token = _make_jwt(role="admin_xa")
        from services.security import verify_supabase_jwt
        claims = verify_supabase_jwt(token, _TEST_JWT_SECRET)
        assert claims["role"] == "admin_xa"

    def test__expired_token_raises_auth_error(self):
        token = _make_jwt(exp_offset=-10)  # đã hết hạn 10 giây trước
        from services.security import AuthError, verify_supabase_jwt
        with pytest.raises(AuthError, match="expired"):
            verify_supabase_jwt(token, _TEST_JWT_SECRET)

    def test__wrong_secret_raises_auth_error(self):
        token = _make_jwt(secret=_WRONG_JWT_SECRET)
        from services.security import AuthError, verify_supabase_jwt
        with pytest.raises(AuthError, match="Invalid JWT signature"):
            verify_supabase_jwt(token, _TEST_JWT_SECRET)

    def test__none_alg_raises_auth_error(self):
        header = _b64url_encode(json.dumps({"alg": "none"}).encode())
        payload = _b64url_encode(json.dumps({"sub": "x", "exp": int(time.time()) + 3600}).encode())
        token = f"{header}.{payload}."
        from services.security import AuthError, verify_supabase_jwt
        with pytest.raises(AuthError):
            verify_supabase_jwt(token, _TEST_JWT_SECRET)

    def test__missing_sub_raises_auth_error(self):
        header = _b64url_encode(json.dumps({"alg": "HS256"}).encode())
        payload_dict = {"exp": int(time.time()) + 3600, "role": "admin_xa"}
        payload = _b64url_encode(json.dumps(payload_dict).encode())
        signing_input = f"{header}.{payload}".encode()
        sig = _b64url_encode(
            hmac.new(_TEST_JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
        )
        token = f"{header}.{payload}.{sig}"
        from services.security import AuthError, verify_supabase_jwt
        with pytest.raises(AuthError, match="subject"):
            verify_supabase_jwt(token, _TEST_JWT_SECRET)

    def test__two_part_token_raises_auth_error(self):
        from services.security import AuthError, verify_supabase_jwt
        with pytest.raises(AuthError, match="Invalid JWT format"):
            verify_supabase_jwt("header.payload", _TEST_JWT_SECRET)

    def test__four_part_token_raises_auth_error(self):
        from services.security import AuthError, verify_supabase_jwt
        with pytest.raises(AuthError, match="Invalid JWT format"):
            verify_supabase_jwt("a.b.c.d", _TEST_JWT_SECRET)
