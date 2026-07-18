from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from routers import cases, knowledge, pilots
from services.supabase_admin import SupabaseAdminError, UserProfile


def _request(path: str = "/") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def _profile(role: str = "admin_xa") -> UserProfile:
    return UserProfile(
        id=str(uuid4()),
        role=role,
        village_id=str(uuid4()) if role == "can_bo_thon" else None,
        force_password_reset=False,
    )


class FakeSupabase:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object, str | None]] = []
        self.token: str | None = None
        self.responses: dict[tuple[str, str], object] = {}
        self.uploads: list[tuple[str, str, bytes, str]] = []
        self.deletes: list[tuple[str, str]] = []

    def as_user(self, token: str) -> "FakeSupabase":
        self.token = token
        return self

    async def _rest_request(
        self,
        method: str,
        path: str,
        payload: object = None,
        *,
        prefer: str | None = None,
    ):
        self.calls.append((method, path, payload, prefer))
        configured = self.responses.get((method, path))
        if isinstance(configured, Exception):
            raise configured
        if configured is not None:
            return configured
        if method in {"POST", "PATCH"}:
            result = dict(payload or {})
            result.setdefault("id", str(uuid4()))
            return [result]
        return []

    async def upload_storage_object_admin(
        self, bucket: str, path: str, content: bytes, mime_type: str
    ) -> None:
        self.uploads.append((bucket, path, content, mime_type))

    async def delete_storage_object_admin(self, bucket: str, path: str) -> None:
        self.deletes.append((bucket, path))


def test_case_create_track_and_internal_workflow(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeSupabase()
    settings = SimpleNamespace(feature_cases=True, bana_commune_id="ba_na")
    case_id = str(uuid4())
    created = {
        "id": case_id,
        "category": "road",
        "status": "received",
        "priority": "normal",
        "submitter_name": "must not leak",
    }
    client.responses[("POST", "/rest/v1/rpc/create_citizen_case")] = [created]
    monkeypatch.setattr(cases, "_tracking_code", lambda: ("A" * 32, "stored-hash"))

    result = asyncio.run(
        cases.create_case(
            _request("/api/cases"),
            cases.CaseCreateRequest(
                category="road",
                description="Ổ gà trước nhà văn hóa",
                consent_version="2026-07",
                submitter_name=" Người gửi ",
            ),
            settings,
            client,
            None,
        )
    )
    assert result["tracking_code"] == "A" * 32
    assert "submitter_name" not in result["case"]
    assert client.calls[0][2]["p_submitter_name"] == "Người gửi"

    tracking_hash = cases._hash_tracking_code("A" * 32)
    track_path = (
        "/rest/v1/citizen_cases?tracking_code_hash=eq."
        + tracking_hash
        + "&commune_id=eq.ba_na"
        + "&select=id,category,status,priority,created_at,updated_at,assigned_department"
    )
    client.responses[("GET", track_path)] = [created]
    tracked = asyncio.run(
        cases.track_case(
            _request("/api/cases/track"),
            "a" * 32,
            settings,
            client,
        )
    )
    assert tracked["status"] == "received"
    assert "Personal information" in tracked["privacy"]

    queue_path = (
        "/rest/v1/citizen_cases?select=id,commune_id,village_id,category,description,"
        "priority,status,assigned_department,sla_due_at,created_at,updated_at"
        "&order=created_at.desc&status=eq.received"
    )
    client.responses[("GET", queue_path)] = [created]
    listed = asyncio.run(
        cases.list_cases(_profile("lanh_dao"), client, "Bearer staff-token", "received")
    )
    assert listed[0]["id"] == case_id
    assert client.token == "staff-token"

    updated = asyncio.run(
        cases.update_case_status(
            uuid4(),
            cases.CaseStatusRequest(status="in_progress", note="Đã chuyển đơn vị"),
            _profile("to_cnscd"),
            client,
            "Bearer worker-token",
        )
    )
    assert updated["status"] == "in_progress"

    assigned = asyncio.run(
        cases.assign_case(
            uuid4(),
            cases.CaseAssignmentRequest(department=" Hạ tầng "),
            _profile(),
            client,
            "Bearer admin-token",
        )
    )
    assert assigned["department"] == "Hạ tầng"


@pytest.mark.parametrize(
    ("payload", "detail"),
    [
        (
            cases.CaseCreateRequest(
                category="waste",
                description="Rác tồn đọng nhiều ngày",
                consent_version="v1",
                latitude=16.0,
            ),
            "provided together",
        ),
        (
            cases.CaseCreateRequest(
                category="waste",
                description="Rác tồn đọng nhiều ngày",
                consent_version="v1",
                latitude=16.0,
                longitude=108.0,
            ),
            "confirmation",
        ),
    ],
)
def test_case_location_validation(payload: cases.CaseCreateRequest, detail: str) -> None:
    with pytest.raises(HTTPException, match=detail) as exc:
        asyncio.run(
            cases.create_case(
                _request("/api/cases"),
                payload,
                SimpleNamespace(feature_cases=True, bana_commune_id="ba_na"),
                FakeSupabase(),
                None,
            )
        )
    assert exc.value.status_code == 422


def test_case_authorization_and_service_failures() -> None:
    with pytest.raises(HTTPException) as invalid_code:
        cases._hash_tracking_code("short")
    assert invalid_code.value.status_code == 422

    with pytest.raises(HTTPException) as missing_token:
        cases._extract_bearer(None)
    assert missing_token.value.status_code == 401

    with pytest.raises(HTTPException) as forbidden_role:
        asyncio.run(cases.list_cases(_profile("dan"), FakeSupabase(), "Bearer token"))
    assert forbidden_role.value.status_code == 403

    with pytest.raises(HTTPException) as invalid_status:
        asyncio.run(
            cases.list_cases(
                _profile("admin_xa"), FakeSupabase(), "Bearer token", "unknown"
            )
        )
    assert invalid_status.value.status_code == 422

    client = FakeSupabase()
    client.responses[("POST", "/rest/v1/rpc/create_citizen_case")] = (
        SupabaseAdminError("down", status_code=503)
    )
    with pytest.raises(HTTPException) as unavailable:
        asyncio.run(
            cases.create_case(
                _request("/api/cases"),
                cases.CaseCreateRequest(
                    category="water",
                    description="Đường ống nước bị vỡ",
                    consent_version="v1",
                ),
                SimpleNamespace(feature_cases=True, bana_commune_id="ba_na"),
                client,
                None,
            )
        )
    assert unavailable.value.status_code == 503


def test_knowledge_crud_and_deterministic_scenario() -> None:
    client = FakeSupabase()
    settings = SimpleNamespace(bana_commune_id="ba_na")
    admin = _profile()
    article_id = uuid4()

    article = asyncio.run(
        knowledge.create_article(
            knowledge.ArticleCreateRequest(
                title="Quy trình tiếp nhận",
                body="Nội dung đã được kiểm duyệt",
                category="procedure",
            ),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert article["commune_id"] == "ba_na"

    client.responses[
        (
            "GET",
            "/rest/v1/knowledge_articles?select=id,title,summary,body,category,audience,"
            "version,status,effective_from,updated_at&order=updated_at.desc&audience=eq.public",
        )
    ] = [{"id": str(article_id), "audience": "public"}]
    listed = asyncio.run(
        knowledge.list_articles(admin, client, "Bearer token", "public")
    )
    assert listed[0]["audience"] == "public"

    approved = asyncio.run(
        knowledge.approve_article(article_id, admin, client, "Bearer token")
    )
    assert approved["status"] == "approved"

    champion = asyncio.run(
        knowledge.create_champion(
            knowledge.ChampionCreateRequest(user_id=uuid4(), skills=["hỗ trợ số"]),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert champion["created_by"] == admin.id

    support_point = asyncio.run(
        knowledge.create_support_point(
            knowledge.SupportPointCreateRequest(
                name="Điểm hỗ trợ An Sơn",
                address="Nhà văn hóa thôn",
                equipment=["máy tính"],
            ),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert support_point["name"] == "Điểm hỗ trợ An Sơn"

    scenario_id = uuid4()
    scenario = asyncio.run(
        knowledge.create_scenario(
            knowledge.ScenarioCreateRequest(name="Tăng dân số 5%"),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert scenario["name"] == "Tăng dân số 5%"

    run = asyncio.run(
        knowledge.run_scenario(
            scenario_id,
            knowledge.ScenarioRunRequest(
                baseline={"population": 1000, "budget": 200, "other": 50},
                assumptions={
                    "population_change_pct": 5,
                    "budget_change_pct": -10,
                },
            ),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert run["result"]["projection"] == {
        "population": 1050.0,
        "budget": 180.0,
        "other": 50.0,
    }


@pytest.mark.parametrize(
    "payload",
    [
        knowledge.ScenarioRunRequest(
            baseline={"population": 100},
            assumptions={"unsupported": 1},
        ),
        knowledge.ScenarioRunRequest(
            baseline={"population": 100},
            assumptions={"population_change_pct": 1001},
        ),
        knowledge.ScenarioRunRequest(
            baseline={"population": -1},
            assumptions={"population_change_pct": 1},
        ),
    ],
)
def test_scenario_rejects_unsafe_inputs(
    payload: knowledge.ScenarioRunRequest,
) -> None:
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            knowledge.run_scenario(
                uuid4(),
                payload,
                _profile(),
                SimpleNamespace(bana_commune_id="ba_na"),
                FakeSupabase(),
                "Bearer token",
            )
        )
    assert exc.value.status_code == 422


def test_pilot_feature_flags_and_happy_paths() -> None:
    client = FakeSupabase()
    settings = SimpleNamespace(
        bana_commune_id="ba_na",
        feature_tourism_pilot=True,
        feature_iot_pilot=True,
    )
    admin = _profile()

    tourism_path = (
        "/rest/v1/tourism_places?select=id,name,category,summary,latitude,longitude,"
        "accessibility_notes,opening_hours&commune_id=eq.ba_na"
        "&status=eq.approved&order=name.asc"
    )
    client.responses[("GET", tourism_path)] = [{"name": "Điểm cộng đồng"}]
    places = asyncio.run(pilots.list_public_tourism_places(settings, client))
    assert places == [{"name": "Điểm cộng đồng"}]

    created_place = asyncio.run(
        pilots.create_tourism_place(
            pilots.TourismPlaceRequest(
                name="Làng nghề",
                category="craft",
                summary="Điểm trải nghiệm nghề truyền thống",
            ),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert created_place["category"] == "craft"

    device = asyncio.run(
        pilots.create_sensor_device(
            pilots.SensorDeviceRequest(
                name="Trạm mưa thử nghiệm",
                device_type="rain_gauge",
                unit="mm",
            ),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert device["device_type"] == "rain_gauge"

    observation = asyncio.run(
        pilots.ingest_sensor_observation(
            pilots.SensorObservationRequest(
                device_id=uuid4(),
                observed_at=datetime.now(timezone.utc),
                value=12.5,
                unit="mm",
            ),
            admin,
            settings,
            client,
            "Bearer token",
        )
    )
    assert observation["value"] == 12.5

    with pytest.raises(HTTPException) as disabled:
        asyncio.run(
            pilots.list_public_tourism_places(
                SimpleNamespace(
                    feature_tourism_pilot=False, bana_commune_id="ba_na"
                ),
                client,
            )
        )
    assert disabled.value.status_code == 404


def test_pilot_bearer_and_upstream_failure() -> None:
    with pytest.raises(HTTPException) as missing:
        pilots._bearer("Basic value")
    assert missing.value.status_code == 401

    client = FakeSupabase()
    path = (
        "/rest/v1/tourism_places?select=id,name,category,summary,latitude,longitude,"
        "accessibility_notes,opening_hours&commune_id=eq.ba_na"
        "&status=eq.approved&order=name.asc"
    )
    client.responses[("GET", path)] = SupabaseAdminError("down")
    with pytest.raises(HTTPException) as failed:
        asyncio.run(
            pilots.list_public_tourism_places(
                SimpleNamespace(
                    feature_tourism_pilot=True, bana_commune_id="ba_na"
                ),
                client,
            )
        )
    assert failed.value.status_code == 502
