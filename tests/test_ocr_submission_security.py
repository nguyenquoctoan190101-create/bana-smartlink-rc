from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from routers.auth import require_authenticated_user
from routers.reports import get_report_repository
from services.report_repository import SavedReport
from services.supabase_admin import UserProfile

client = TestClient(app)


def _payload(village_id: str, *, confirmed: bool) -> dict:
    return {
        "village_id": village_id,
        "period_id": str(uuid4()),
        "submitted_by_name": "Cán bộ hợp lệ",
        "submitted_by_phone": "0123456789",
        "values": {f"CT{i:02d}": 0 for i in range(1, 15)},
        "raw_source": "photo_upload",
        "source_confirmed": confirmed,
    }


def test_report_submission_requires_authentication():
    response = client.post("/reports", json=_payload(str(uuid4()), confirmed=False))
    assert response.status_code == 401


def test_ocr_submission_without_confirmation_rejected():
    village_id = str(uuid4())
    mock_repo = AsyncMock()
    app.dependency_overrides[get_report_repository] = lambda: mock_repo
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()), role="can_bo_thon", village_id=village_id, force_password_reset=False
    )
    try:
        response = client.post("/reports", json=_payload(village_id, confirmed=False))
        assert response.status_code == 422
        assert "source_confirmed=true" in response.text
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)


def test_ocr_submission_with_confirmation_accepted():
    village_id = str(uuid4())
    payload = _payload(village_id, confirmed=True)
    mock_repo = AsyncMock()
    mock_repo.save_report.return_value = SavedReport(
        id=str(uuid4()),
        village_id=village_id,
        period_id=payload["period_id"],
        workflow_status="submitted",
        timeliness_status="on_time",
        version=1,
    )
    app.dependency_overrides[get_report_repository] = lambda: mock_repo
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()), role="can_bo_thon", village_id=village_id, force_password_reset=False
    )
    try:
        response = client.post("/reports", json=payload)
        assert response.status_code == 201, response.text
        assert response.json()["workflow_status"] == "submitted"
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)
