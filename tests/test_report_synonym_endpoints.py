from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from main import create_app
from routers.auth import require_admin_xa, require_authenticated_user
from routers.reports import get_report_repository
from services.supabase_admin import UserProfile


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "xlsx"


def _profile(role: str = "admin_xa") -> UserProfile:
    return UserProfile(
        id=str(uuid4()),
        role=role,
        village_id=None,
        force_password_reset=False,
    )


def test_normalize_uses_the_persisted_synonym_dictionary() -> None:
    app = create_app()
    repository = AsyncMock()
    repository.field_synonyms.return_value = {"tong so ho dan": "CT01"}
    app.dependency_overrides[get_report_repository] = lambda: repository
    app.dependency_overrides[require_authenticated_user] = lambda: _profile(
        "can_bo_thon"
    )
    workbook = FIXTURES / "BC_T01_Thôn_Phú_Hòa_1.xlsx"

    try:
        with TestClient(app) as client, workbook.open("rb") as source:
            response = client.post(
                "/reports/normalize",
                files={
                    "file": (
                        workbook.name,
                        source,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    repository.field_synonyms.assert_awaited_once_with()


def test_confirm_synonym_is_persisted_by_the_admin_rpc() -> None:
    app = create_app()
    repository = AsyncMock()
    repository.confirm_field_synonym.return_value = {
        "original_name": "Tổng số hộ dân",
        "normalized_name": "tong so ho dan",
        "ct_code": "CT01",
    }
    app.dependency_overrides[get_report_repository] = lambda: repository
    app.dependency_overrides[require_admin_xa] = lambda: _profile()

    try:
        with TestClient(app) as client:
            response = client.post(
                "/reports/confirm-synonym",
                json={"original_name": " Tổng số hộ dân ", "ct_code": "CT01"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert response.json()["mapping"]["ct_code"] == "CT01"
    repository.confirm_field_synonym.assert_awaited_once_with(
        "Tổng số hộ dân",
        "tong so ho dan",
        "CT01",
    )


def test_confirm_synonym_rejects_an_unknown_indicator_before_writing() -> None:
    app = create_app()
    repository = AsyncMock()
    app.dependency_overrides[get_report_repository] = lambda: repository
    app.dependency_overrides[require_admin_xa] = lambda: _profile()

    try:
        with TestClient(app) as client:
            response = client.post(
                "/reports/confirm-synonym",
                json={"original_name": "Cột không rõ", "ct_code": "CT99"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    repository.confirm_field_synonym.assert_not_awaited()
