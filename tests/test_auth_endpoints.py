import base64
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from main import app
from services.supabase_admin import UserProfile

_TEST_JWT_SECRET = "test-jwt-secret-do-not-use-in-production"

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _make_jwt(sub: str = str(uuid4()), role: str = "admin_xa", village_id: str | None = None) -> str:
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    now = int(time.time())
    payload = _b64url_encode(json.dumps({
        "sub": sub,
        "role": role,
        "exp": now + 3600,
        "iat": now,
    }).encode())
    sig = hmac.new(_TEST_JWT_SECRET.encode("utf-8"), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64url_encode(sig)}"

@pytest.fixture
def client():
    # Patch load_settings to return predictable values
    with patch("routers.auth.load_settings") as mock_settings:
        settings_mock = mock_settings.return_value
        settings_mock.supabase_jwt_secret = _TEST_JWT_SECRET
        settings_mock.database_url = "postgresql://mock"
        yield TestClient(app)

@pytest.fixture
def mock_get_user_profile():
    with patch("services.supabase_admin.SupabaseAdminClient.get_user_profile") as mock:
        yield mock

@pytest.fixture
def mock_db_conn():
    with patch("routers.auth.asyncpg.connect", new_callable=AsyncMock, create=True) as mock_connect:
        conn = AsyncMock()
        mock_connect.return_value = conn
        yield conn


# 1. GET /auth/officers
def test_list_officers_requires_auth(client):
    res = client.get("/auth/officers")
    assert res.status_code == 401

def test_list_officers_admin_xa_only(client, mock_get_user_profile):
    # can_bo_thon trying to access
    sub = str(uuid4())
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="can_bo_thon", village_id="1", force_password_reset=False)
    
    res = client.get("/auth/officers", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403

def test_list_officers_success(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="admin_xa", village_id=None, force_password_reset=False)
    
    mock_db_conn.fetch.return_value = [
        {"id": "off1", "name": "Nguyễn Văn A", "email": "a@x.com", "phone": "123", "role": "can_bo_thon", "village_id": "1", "is_active": True, "last_login": "2026-07-01"}
    ]
    
    res = client.get("/auth/officers", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) == 1
    query, actor_id = mock_db_conn.fetch.await_args.args
    assert "p.commune_id = actor.commune_id" in query
    assert actor_id == sub


# 2. POST /auth/officers/{id}/toggle-active
def test_toggle_active_success(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    officer_id = str(uuid4())
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="admin_xa", village_id=None, force_password_reset=False)
    
    # Mock user exists with is_active = True
    mock_db_conn.fetchrow.return_value = {"is_active": True}
    
    res = client.post(f"/auth/officers/{officer_id}/toggle-active", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["is_active"] is False
    assert mock_db_conn.execute.call_count == 2 # 1 for UPDATE, 1 for INSERT audit_log
    
    update_call = mock_db_conn.execute.call_args_list[0]
    assert update_call[0][0].startswith("UPDATE user_profiles")
    assert update_call[0][1] is False # new_active is False


# 3. GET /auth/proposals
def test_list_proposals_can_bo_thon_filter(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="can_bo_thon", village_id="village-1", force_password_reset=False)
    
    mock_db_conn.fetch.return_value = []
    res = client.get("/auth/proposals", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    # ensure fetch was called with village-1 arg
    mock_db_conn.fetch.assert_called_once()
    assert "village-1" in mock_db_conn.fetch.call_args[0]


# 4. GET /auth/report-values
def test_list_report_values(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="can_bo_thon", village_id="village-1", force_password_reset=False)
    
    mock_db_conn.fetch.return_value = []
    res = client.get("/auth/report-values", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    mock_db_conn.fetch.assert_called_once()
    setup_sql = "\n".join(
        str(call.args[0]) for call in mock_db_conn.execute.await_args_list
    ).lower()
    assert "request.jwt.claim.sub" in setup_sql
    assert "request.jwt.claims" in setup_sql
    assert "set local role authenticated" in setup_sql
    mock_db_conn.transaction.assert_called_once_with(readonly=True)

# 4.1 Lanh Dao sees all
def test_lanh_dao_sees_all_proposals_and_report_values(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    token = _make_jwt(sub=sub, role="lanh_dao")
    mock_get_user_profile.return_value = UserProfile(id=sub, role="lanh_dao", village_id=None, force_password_reset=False)
    
    mock_db_conn.fetch.return_value = [
            {"id": "p1", "report_id": "r1", "village_id": "v1", "ct_code": "CT01", "proposed_value": 100, "previous_value": None, "proposed_by": "123", "status": "pending", "reviewed_by": None, "reviewed_at": None, "created_at": "2026-07-14T00:00:00Z", "sla_due_at": "2026-07-17T00:00:00Z", "sla_status": "on_track"},
            {"id": "p2", "report_id": "r2", "village_id": "v2", "ct_code": "CT02", "proposed_value": 200, "previous_value": None, "proposed_by": "456", "status": "pending", "reviewed_by": None, "reviewed_at": None, "created_at": "2026-07-14T00:00:00Z", "sla_due_at": "2026-07-17T00:00:00Z", "sla_status": "on_track"}
    ]
    
    # Test proposals
    res_p = client.get("/auth/proposals", headers={"Authorization": f"Bearer {token}"})
    assert res_p.status_code == 200
    data_p = res_p.json()
    assert len(data_p) == 2
    assert data_p[0]["sla_status"] == "on_track"
    assert data_p[0]["sla_due_at"] == "2026-07-17T00:00:00Z"
    
    # Check that query has no WHERE clause filtering by village_id (args should be empty)
    fetch_p_call_args = mock_db_conn.fetch.call_args[0]
    assert len(fetch_p_call_args) == 1 # Only the query, no args
    assert "WHERE report_id IN" not in fetch_p_call_args[0]
    assert "interval '72 hours'" in fetch_p_call_args[0]
    
    # Test report values
    mock_db_conn.fetch.reset_mock()
    mock_db_conn.fetch.return_value = [
        {"report_id": "r1", "ct_code": "CT01", "value": 100, "note": None},
        {"report_id": "r2", "ct_code": "CT02", "value": 200, "note": None}
    ]
    
    res_rv = client.get("/auth/report-values", headers={"Authorization": f"Bearer {token}"})
    assert res_rv.status_code == 200
    data_rv = res_rv.json()
    assert len(data_rv) == 2
    
    fetch_rv_call_args = mock_db_conn.fetch.call_args[0]
    assert len(fetch_rv_call_args) == 1 # Only the query, no args
    assert "WHERE report_id IN" not in fetch_rv_call_args[0]


# 5. GET /auth/audit-logs
def test_list_audit_logs_admin_only(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="can_bo_thon", village_id="1", force_password_reset=False)
    
    res = client.get("/auth/audit-logs", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403

def test_list_audit_logs_success(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    audit_id = uuid4()
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="admin_xa", village_id=None, force_password_reset=False)

    mock_db_conn.fetch.return_value = [{
        "id": audit_id,
        "action": "PROPOSAL_APPROVE",
        "table_name": "pending_updates",
        "record_id": str(uuid4()),
        "user_id": UUID(sub),
        "details": '{"ct_code":"CT01"}',
        "created_at": "2026-07-15T18:46:10+07:00",
    }]
    res = client.get("/auth/audit-logs", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()[0]["user_id"] == sub


def test_list_approved_proposal_serializes_reviewer_uuid(client, mock_get_user_profile, mock_db_conn):
    sub = str(uuid4())
    proposal_id = uuid4()
    report_id = uuid4()
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="admin_xa", village_id=None, force_password_reset=False)
    mock_db_conn.fetch.return_value = [{
        "id": proposal_id,
        "report_id": report_id,
        "village_id": str(uuid4()),
        "ct_code": "CT01",
        "proposed_value": 320,
        "previous_value": 318,
        "proposed_by": "0900000000",
        "status": "approved",
        "reviewed_by": UUID(sub),
        "reviewed_at": "2026-07-15T18:46:10+07:00",
        "created_at": "2026-07-15T18:45:00+07:00",
        "sla_due_at": "2026-07-18T18:45:00+07:00",
        "sla_status": "closed",
    }]

    res = client.get("/auth/proposals", headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 200
    assert res.json()[0]["reviewed_by"] == sub
    assert res.json()[0]["status"] == "approved"
    assert res.json()[0]["previous_value"] == 318


# 6. POST /auth/proposals/{id}/action
@patch("routers.auth.execute_proposal_action", new_callable=AsyncMock)
def test_action_proposal(mock_exec, client, mock_get_user_profile):
    sub = str(uuid4())
    proposal_id = uuid4()
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="admin_xa", village_id=None, force_password_reset=False)
    
    mock_exec.return_value = {"id": "1", "status": "approved", "report_id": "r1", "ct_code": "CT01"}
    
    res = client.post(f"/auth/proposals/{proposal_id}/action", json={"action": "approve", "notes": "Đã đối chiếu sổ nguồn"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    mock_exec.assert_called_once_with(proposal_id, "approve", UUID(sub), "Đã đối chiếu sổ nguồn")

@patch("routers.auth.execute_proposal_action", new_callable=AsyncMock)
def test_duplicate_proposal_approval_returns_409(mock_exec, client, mock_get_user_profile):
    sub = str(uuid4())
    proposal_id = uuid4()
    token = _make_jwt(sub=sub)
    mock_get_user_profile.return_value = UserProfile(id=sub, role="admin_xa", village_id=None, force_password_reset=False)
    
    # First call succeeds
    mock_exec.return_value = {"id": "1", "status": "approved", "report_id": "r1", "ct_code": "CT01"}
    res1 = client.post(f"/auth/proposals/{proposal_id}/action", json={"action": "approve", "notes": "Đã đối chiếu sổ nguồn"}, headers={"Authorization": f"Bearer {token}"})
    assert res1.status_code == 200
    
    # Second call raises ValueError indicating it's not pending anymore
    mock_exec.side_effect = ValueError("Proposal is not pending")
    res2 = client.post(f"/auth/proposals/{proposal_id}/action", json={"action": "approve", "notes": "Đã đối chiếu sổ nguồn"}, headers={"Authorization": f"Bearer {token}"})
    
    assert res2.status_code == 409
    assert res2.json()["message"] == "Đề xuất này đã được xử lý trước đó."
