from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from routers.auth import require_authenticated_user
from routers.reports import get_report_repository
from services.extraction_review import issue_extraction_review_token
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
        "idempotency_key": str(uuid4()),
    }


def _add_signed_review(
    payload: dict,
    *,
    user_id: str,
    original_values: dict[str, int | None] | None = None,
) -> None:
    metadata = {
        "source_checksum": "a" * 64,
        "source_type": "photo_ocr",
        "extractor_versions": ["gemini-ocr:v1"],
        "field_count": 14,
        "requires_review_count": 14,
    }
    payload["extraction_metadata"] = metadata
    payload["extraction_review_token"] = issue_extraction_review_token(
        user_id=user_id,
        source_checksum=metadata["source_checksum"],
        source_type=metadata["source_type"],
        extractor_versions=metadata["extractor_versions"],
        values=original_values or payload["values"],
        requires_review_count=metadata["requires_review_count"],
    )


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
    user_id = str(uuid4())
    payload = _payload(village_id, confirmed=True)
    _add_signed_review(payload, user_id=user_id)
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
        id=user_id, role="can_bo_thon", village_id=village_id, force_password_reset=False
    )
    try:
        response = client.post("/reports", json=payload)
        assert response.status_code == 201, response.text
        assert response.json()["workflow_status"] == "submitted"
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)


def test_ocr_submission_records_review_metadata_and_corrections():
    village_id = str(uuid4())
    user_id = str(uuid4())
    payload = _payload(village_id, confirmed=True)
    payload["idempotency_key"] = str(uuid4())
    payload["extraction_corrections"] = [{
        "code": "CT01",
        "before": 1,
        "after": 0,
        "reason": "Đối chiếu lại tài liệu gốc",
    }]
    original_values = dict(payload["values"])
    original_values["CT01"] = 1
    _add_signed_review(
        payload,
        user_id=user_id,
        original_values=original_values,
    )
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
        id=user_id, role="can_bo_thon", village_id=village_id, force_password_reset=False
    )
    try:
        response = client.post("/reports", json=payload)

        assert response.status_code == 201, response.text
        kwargs = mock_repo.save_report.await_args.kwargs
        assert kwargs["extraction_corrections"][0]["reason"] == "Đối chiếu lại tài liệu gốc"
        assert kwargs["extraction_metadata"]["source_checksum"] == "a" * 64
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)


def test_ocr_submission_rejects_correction_that_does_not_match_submitted_value():
    village_id = str(uuid4())
    user_id = str(uuid4())
    payload = _payload(village_id, confirmed=True)
    payload["extraction_corrections"] = [{
        "code": "CT01",
        "before": 1,
        "after": 2,
        "reason": "Đối chiếu lại tài liệu gốc",
    }]
    original_values = dict(payload["values"])
    original_values["CT01"] = 1
    _add_signed_review(
        payload,
        user_id=user_id,
        original_values=original_values,
    )
    mock_repo = AsyncMock()
    app.dependency_overrides[get_report_repository] = lambda: mock_repo
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=user_id, role="can_bo_thon", village_id=village_id, force_password_reset=False
    )
    try:
        response = client.post("/reports", json=payload)

        assert response.status_code == 422, response.text
        assert "requires before/after/reason for CT01" in response.text
        mock_repo.save_report.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)


def test_manual_submission_rejects_extraction_metadata():
    village_id = str(uuid4())
    payload = _payload(village_id, confirmed=True)
    payload["raw_source"] = "manual"
    payload["source_confirmed"] = False
    payload["extraction_metadata"] = {
        "source_checksum": "b" * 64,
        "source_type": "excel",
        "extractor_versions": ["openpyxl:v1"],
        "field_count": 14,
        "requires_review_count": 0,
    }
    mock_repo = AsyncMock()
    app.dependency_overrides[get_report_repository] = lambda: mock_repo
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()), role="can_bo_thon", village_id=village_id, force_password_reset=False
    )
    try:
        response = client.post("/reports", json=payload)

        assert response.status_code == 422, response.text
        assert "only allowed for imported reports" in response.text
        mock_repo.save_report.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)


def test_import_submission_rejects_missing_review_metadata():
    village_id = str(uuid4())
    payload = _payload(village_id, confirmed=True)
    mock_repo = AsyncMock()
    app.dependency_overrides[get_report_repository] = lambda: mock_repo
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()),
        role="can_bo_thon",
        village_id=village_id,
        force_password_reset=False,
    )
    try:
        response = client.post("/reports", json=payload)

        assert response.status_code == 422, response.text
        assert "require signed extraction review evidence" in response.text
        mock_repo.save_report.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)


def test_report_submission_rejects_ct14_greater_than_ct01_before_saving():
    """The real submit endpoint must enforce the CT14 <= CT01 rule."""
    village_id = str(uuid4())
    payload = _payload(village_id, confirmed=True)
    payload["raw_source"] = "manual"
    payload["source_confirmed"] = False
    payload["values"].update({
        "CT01": 100,
        "CT02": 300,
        "CT07": 50,
        "CT14": 101,
    })
    mock_repo = AsyncMock()
    app.dependency_overrides[get_report_repository] = lambda: mock_repo
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()), role="can_bo_thon", village_id=village_id, force_password_reset=False
    )
    try:
        response = client.post("/reports", json=payload)

        assert response.status_code == 422, response.text
        response_payload = response.json()
        assert response_payload["code"] == "VALIDATION_ERROR"
        errors = response_payload["details"]["errors"]
        assert any(
            error["ct_code"] == "CT14"
            and error["error_type"] == "LOGIC"
            and "CT01" in error["message"]
            for error in errors
        )
        mock_repo.save_report.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_report_repository, None)
        app.dependency_overrides.pop(require_authenticated_user, None)
