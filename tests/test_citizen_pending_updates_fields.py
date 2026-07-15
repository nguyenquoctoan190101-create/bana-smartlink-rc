from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from uuid import uuid4
from main import app

def test_citizen_pending_updates_all_fields():
    """Verify that all 4 identity fields are passed to Supabase via the endpoint."""
    client = TestClient(app)
    
    payload = {
        "village_id": str(uuid4()),
        "report_id": str(uuid4()),
        "ct_code": "CT01",
        "proposed_value": 8888,
        "proposed_by_phone": "0999888777",
        "submitter_name": "Test Name 123",
        "submitter_household": "Test Household",
        "submitter_address": "Test Address",
        "submitter_relation": "Test Relation",
        "privacy_consent": True,
    }

    with patch(
        "services.supabase_admin.SupabaseAdminClient._rest_request",
        new_callable=AsyncMock,
        return_value=[{"id": payload["report_id"], "village_id": payload["village_id"]}],
    ), patch(
        "services.supabase_admin.SupabaseAdminClient.insert_pending_update",
        new_callable=AsyncMock,
        return_value={"id": str(uuid4()), "report_id": payload["report_id"], "ct_code": "CT01", "proposed_value": 8888, "status": "pending"}
    ) as mock_insert:
        response = client.post("/auth/citizen/pending-updates", json=payload)
        
    assert response.status_code == 201
    mock_insert.assert_called_once_with(
        report_id=payload["report_id"],
        ct_code="CT01",
        proposed_value=8888,
            submitter_name="Test Name 123",
            submitter_phone="0999888777",
            submitter_household="Test Household",
            submitter_address="Test Address",
            submitter_relation="Test Relation",
            explanation=None,
        consent_version="2026-07-13",
    )
