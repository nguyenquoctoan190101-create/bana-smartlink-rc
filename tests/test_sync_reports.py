import base64
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from main import app
from routers.auth import require_authenticated_user
from routers.reports import get_report_repository
from services.supabase_admin import UserProfile

_TEST_JWT_SECRET = "test-jwt-secret-do-not-use-in-production"

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _make_jwt(sub: str = str(uuid4()), role: str = "can_bo_thon", village_id: str | None = None) -> str:
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
    with patch("routers.auth.load_settings") as mock_settings:
        settings_mock = mock_settings.return_value
        settings_mock.supabase_jwt_secret = _TEST_JWT_SECRET
        settings_mock.database_url = "postgresql://mock"
        yield TestClient(app)

@pytest.fixture
def mock_get_user_profile():
    mock_profile = UserProfile(id="test", role="can_bo_thon", village_id="1", force_password_reset=False)
    
    async def override_require_auth():
        return mock_profile
        
    app.dependency_overrides[require_authenticated_user] = override_require_auth
    yield mock_profile
    app.dependency_overrides.pop(require_authenticated_user, None)

@pytest.fixture
def mock_report_repo():
    repo_mock = AsyncMock()
    repo_mock._supabase._rest_request = AsyncMock()
    repo_mock.get_period_id_by_name = AsyncMock()
    repo_mock.save_report = AsyncMock()
    
    async def override_get_repo():
        return repo_mock
        
    app.dependency_overrides[get_report_repository] = override_get_repo
    yield repo_mock
    app.dependency_overrides.pop(get_report_repository, None)

def _make_report_item(
    id: str,
    village_id: str,
    report_period: str = "Tháng 07/2026",
    ct01: int = 100
):
    return {
        "id": id,
        "village_id": village_id,
        "reporter_name": "Nguyen Van A",
        "reporter_phone": "0901234567",
        "report_period": report_period,
        "status": "Draft",
        "updated_at": "2026-07-11T10:00:00Z",
        "CT01": ct01,
        "CT02": 350,
        "CT03": 10,
        "CT04": 20,
        "CT05": 5,
        "CT06": 10,
        "CT07": 50,
        "CT08": 5,
        "CT09": 80,
        "CT10": 150,
        "CT11": 140,
        "CT12": 3,
        "CT13": 50,
        "CT14": 0,
        "raw_source": "web_form",
        "source_confirmed": False
    }

# (a) Sync 2 valid reports -> both synced
def test_sync_reports_valid(client, mock_report_repo):
    sub = str(uuid4())
    village_id = str(uuid4())
    
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(id=sub, role="can_bo_thon", village_id=village_id, force_password_reset=False)
    
    rep1_id = str(uuid4())
    rep2_id = str(uuid4())
    
    mock_report_repo._supabase._rest_request.return_value = [] # not duplicated
    period_id = str(uuid4())
    mock_report_repo.get_period_id_by_name.return_value = period_id
    
    mock_report_repo.save_report.return_value = SimpleNamespace(
        id=rep1_id, village_id=village_id, period_id=period_id,
        workflow_status="submitted", timeliness_status="on_time",
        version=1, replayed=False,
    )
    
    payload = {
        "reports": [
            _make_report_item(rep1_id, village_id),
            _make_report_item(rep2_id, village_id)
        ]
    }
    
    res = client.post("/reports/sync", json=payload)
    data = res.json()
    assert res.status_code == 200
    assert {item["client_id"] for item in data["accepted"]} == {rep1_id, rep2_id}
    assert len(data["rejected"]) == 0
    assert mock_report_repo.save_report.call_count == 2
    app.dependency_overrides.pop(require_authenticated_user, None)

# (b) Sync idempotent
def test_sync_reports_idempotent(client, mock_report_repo):
    sub = str(uuid4())
    village_id = str(uuid4())
    
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(id=sub, role="can_bo_thon", village_id=village_id, force_password_reset=False)
    
    rep1_id = str(uuid4())
    
    period_id = str(uuid4())
    mock_report_repo.get_period_id_by_name.return_value = period_id
    mock_report_repo.save_report.return_value = SimpleNamespace(
        id=rep1_id, village_id=village_id, period_id=period_id,
        workflow_status="submitted", timeliness_status="on_time",
        version=1, replayed=True,
    )
    
    payload = {
        "reports": [
            _make_report_item(rep1_id, village_id),
        ]
    }
    
    res = client.post("/reports/sync", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["accepted"][0]["client_id"] == rep1_id
    assert len(data["rejected"]) == 0
    assert mock_report_repo.save_report.call_count == 1
    app.dependency_overrides.pop(require_authenticated_user, None)


def test_sync_reports_accepts_new_item_without_legacy_status(client, mock_report_repo):
    village_id = str(uuid4())
    report_id = str(uuid4())
    period_id = str(uuid4())
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()),
        role="can_bo_thon",
        village_id=village_id,
        force_password_reset=False,
    )
    mock_report_repo.save_report.return_value = SimpleNamespace(
        id=report_id,
        village_id=village_id,
        period_id=period_id,
        workflow_status="submitted",
        timeliness_status="on_time",
        version=1,
        replayed=False,
    )
    item = _make_report_item(report_id, village_id)
    item.pop("status")
    item.pop("report_period")
    item["period_id"] = period_id
    item["workflow_status"] = "submitted"
    item["timeliness_status"] = "not_submitted"
    item["publication_status"] = "private"

    try:
        response = client.post("/reports/sync", json={"reports": [item]})
        assert response.status_code == 200
        assert response.json()["accepted"] == [
            {"client_id": report_id, "report_id": report_id, "version": 1}
        ]
    finally:
        app.dependency_overrides.pop(require_authenticated_user, None)

# (c) Validation error
def test_sync_reports_validation_error(client, mock_report_repo):
    sub = str(uuid4())
    village_id = str(uuid4())
    
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(id=sub, role="can_bo_thon", village_id=village_id, force_password_reset=False)
    
    rep1_id = str(uuid4())
    
    mock_report_repo._supabase._rest_request.return_value = []
    mock_report_repo.get_period_id_by_name.return_value = str(uuid4())
    
    payload = {
        "reports": [
            _make_report_item(rep1_id, village_id, ct01=-1) # Invalid CT01
        ]
    }
    
    res = client.post("/reports/sync", json=payload)
    assert res.status_code == 200 # Entire request is still 200
    data = res.json()
    assert len(data["accepted"]) == 0
    assert len(data["rejected"]) == 1
    assert data["rejected"][0]["client_id"] == rep1_id
    assert data["rejected"][0]["code"] == "VALIDATION_ERROR"
    assert "Tổng CT03 + CT04 không được lớn hơn CT01" in data["rejected"][0]["message"]
    app.dependency_overrides.pop(require_authenticated_user, None)


def test_sync_reports_rejects_ct14_greater_than_ct01_without_saving(client, mock_report_repo):
    """Offline sync cannot bypass the deterministic CT14 <= CT01 rule."""
    village_id = str(uuid4())
    report_id = str(uuid4())
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()),
        role="can_bo_thon",
        village_id=village_id,
        force_password_reset=False,
    )
    mock_report_repo.get_period_id_by_name.return_value = str(uuid4())
    item = _make_report_item(report_id, village_id)
    item["CT14"] = item["CT01"] + 1

    try:
        response = client.post("/reports/sync", json={"reports": [item]})

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["accepted"] == []
        assert len(data["rejected"]) == 1
        assert data["rejected"][0]["client_id"] == report_id
        assert data["rejected"][0]["code"] == "VALIDATION_ERROR"
        assert "CT14" in data["rejected"][0]["message"]
        assert "CT01" in data["rejected"][0]["message"]
        assert data["rejected"][0]["retryable"] is False
        mock_report_repo.save_report.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(require_authenticated_user, None)

# (d) Partial permission rejection
def test_sync_reports_partial_village_auth(client, mock_report_repo):
    sub = str(uuid4())
    village_id_correct = str(uuid4())
    village_id_wrong = str(uuid4())
    
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(id=sub, role="can_bo_thon", village_id=village_id_correct, force_password_reset=False)
    
    rep1_id = str(uuid4())
    rep2_id = str(uuid4())
    
    mock_report_repo._supabase._rest_request.return_value = []
    mock_report_repo.get_period_id_by_name.return_value = str(uuid4())
    mock_report_repo.save_report.return_value = SimpleNamespace(
        id=rep1_id, village_id=village_id_correct,
        period_id=mock_report_repo.get_period_id_by_name.return_value,
        workflow_status="submitted", timeliness_status="on_time",
        version=1, replayed=False,
    )
    
    payload = {
        "reports": [
            _make_report_item(rep1_id, village_id_correct),
            _make_report_item(rep2_id, village_id_wrong)
        ]
    }
    
    res = client.post("/reports/sync", json=payload)
    assert res.status_code == 200
    data = res.json()
    
    assert data["accepted"][0]["client_id"] == rep1_id
    assert len(data["rejected"]) == 1
    assert data["rejected"][0]["client_id"] == rep2_id
    assert data["rejected"][0]["code"] == "FORBIDDEN"
    assert mock_report_repo.save_report.call_count == 1
    app.dependency_overrides.pop(require_authenticated_user, None)
