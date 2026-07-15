from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app


def test_public_tracking_response_is_redacted_and_queries_only_allowlisted_columns() -> None:
    code = "A1B2C3D4E5F6A7B8"
    with patch(
        "services.supabase_admin.SupabaseAdminClient._rest_request",
        new_callable=AsyncMock,
        return_value=[{
            "tracking_code": code,
            "status": "pending",
            "ct_code": "CT01",
            "created_at": "2026-07-14T00:00:00Z",
            "submitter_phone": "0900000000",
        }],
    ) as request:
        response = TestClient(app).get(f"/auth/citizen/pending-updates/{code}")
    assert response.status_code == 200
    assert response.json() == {
        "tracking_code": code,
        "status": "pending",
        "ct_code": "CT01",
        "submitted_at": "2026-07-14T00:00:00Z",
        "message": "Kiến nghị đã được tiếp nhận và đang chờ đối chiếu.",
    }
    path = request.await_args.args[1]
    assert "select=tracking_code,status,ct_code,created_at" in path
    assert "submitter_phone" not in path
