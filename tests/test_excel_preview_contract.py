from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from main import create_app
from routers.auth import require_authenticated_user
from services.supabase_admin import UserProfile


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "xlsx"


def _client() -> tuple[TestClient, object]:
    app = create_app()
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()),
        role="admin_xa",
        village_id=None,
        force_password_reset=False,
    )
    return TestClient(app), app


def test_excel_preview_keeps_raw_text_and_returns_deterministic_flag() -> None:
    client, app = _client()
    path = FIXTURES / "BC_T07_Thôn_Hòa_Khương_Tây.xlsx"
    try:
        with path.open("rb") as source:
            response = client.post(
                "/reports/excel-preview",
                files={
                    "file": (
                        path.name,
                        source,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source"] == "excel"
    assert payload["raw_values"]["CT07"] == "ba trăm"
    assert payload["values"]["CT07"] is None
    assert "CT07" in payload["null_codes"]
    assert any(
        item["ct_code"] == "CT07" and item["error_type"] == "TEXT"
        for item in payload["flags"]
    )


def test_excel_preview_exposes_workbook_metadata_without_persisting() -> None:
    client, app = _client()
    path = FIXTURES / "BC_T01_Thôn_Phú_Hòa_1.xlsx"
    try:
        with path.open("rb") as source:
            response = client.post(
                "/reports/excel-preview",
                files={
                    "file": (
                        path.name,
                        source,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert response.json()["metadata"] == {
        "period_name": None,
        "village_name": None,
        "reporter_name": None,
        "reporter_title": "Cán bộ kiểm thử tổng hợp",
        "reporter_phone": "0000000000",
        "deadline": None,
    }
