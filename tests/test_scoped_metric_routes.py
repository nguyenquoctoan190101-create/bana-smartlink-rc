from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from fastapi.testclient import TestClient

from main import app
from routers.auth import (
    get_supabase_admin,
    require_admin_or_leader,
    require_authenticated_user,
)
from services.cnscd_impact import CnscdImpact, VillageCnscdImpact
from services.policy_scorecard import PolicyScorecard, ScoreMetric
from services.supabase_admin import UserProfile


PERIOD_ID = "00000000-0000-4000-8000-00000000d001"
VILLAGE_ID = "00000000-0000-4000-8000-00000000c001"


def _leader() -> UserProfile:
    return UserProfile(
        id="00000000-0000-4000-8000-00000000a004",
        role="lanh_dao",
        village_id=None,
        force_password_reset=False,
        commune_id="ba_na",
    )


def test_cnscd_impact_uses_the_callers_rls_client() -> None:
    admin = MagicMock()
    scoped = MagicMock()
    admin.as_user.return_value = scoped
    service = MagicMock()
    service._supabase = scoped
    service.calculate = AsyncMock(
        return_value=CnscdImpact(
            period_id=PERIOD_ID,
            period_name="Tháng 7/2026",
            scope="commune",
            scope_village_count=1,
            has_report_data=True,
            submitted_report_count=1,
            assisted_report_count=1,
            ct02_total=1000,
            ct13_total=2,
            guided_people_per_1000=2,
            metric_registry_version="2026-07-28.1",
            metric_interpretation_limit="Không suy diễn tác động.",
            missing_ct02_report_count=0,
            missing_ct13_report_count=0,
            zero_ct02_report_count=0,
            villages=[
                VillageCnscdImpact(
                    village_id=VILLAGE_ID,
                    village_name="Thôn kiểm thử",
                    report_id=None,
                    assisted_report_count=1,
                    ct02_value=1000,
                    ct13_value=2,
                    guided_people_per_1000=2,
                    data_status="complete",
                    next_action="view_work_queue",
                )
            ],
            interpretation="Dữ liệu kiểm thử.",
        )
    )
    app.dependency_overrides[get_supabase_admin] = lambda: admin
    app.dependency_overrides[require_authenticated_user] = _leader
    try:
        with (
            patch("routers.cnscd_impact.CnscdImpactService", return_value=service),
            patch(
                "routers.cnscd_impact.safe_resolve_period",
                new=AsyncMock(return_value=(UUID(PERIOD_ID), {"id": PERIOD_ID})),
            ),
        ):
            response = TestClient(app).get(
                f"/api/cnscd-impact?period_id={PERIOD_ID}",
                headers={"Authorization": "Bearer caller-jwt"},
            )
    finally:
        app.dependency_overrides.pop(get_supabase_admin, None)
        app.dependency_overrides.pop(require_authenticated_user, None)

    assert response.status_code == 200, response.text
    admin.as_user.assert_called_once_with("caller-jwt")
    service.calculate.assert_awaited_once_with(
        PERIOD_ID,
        village_ids=None,
        scope="commune",
    )
    payload = response.json()
    assert "difference" not in payload
    assert "absolute_difference" not in payload
    assert "difference" not in payload["villages"][0]
    assert "absolute_difference" not in payload["villages"][0]


def test_cnscd_member_is_limited_to_assigned_villages() -> None:
    profile = UserProfile(
        id="00000000-0000-4000-8000-00000000a003",
        role="to_cnscd",
        village_id=None,
        force_password_reset=False,
        commune_id="ba_na",
    )
    admin = MagicMock()
    scoped = MagicMock()
    scoped.list_user_village_ids = AsyncMock(return_value=[VILLAGE_ID])
    admin.as_user.return_value = scoped
    service = MagicMock()
    service._supabase = scoped
    service.calculate = AsyncMock(
        return_value=CnscdImpact(
            period_id=PERIOD_ID,
            period_name="Tháng 7/2026",
            scope="assigned_villages",
            scope_village_count=1,
            has_report_data=False,
            submitted_report_count=0,
            assisted_report_count=0,
            ct02_total=None,
            ct13_total=None,
            guided_people_per_1000=None,
            metric_registry_version="2026-07-28.1",
            metric_interpretation_limit="Không suy diễn tác động.",
            missing_ct02_report_count=0,
            missing_ct13_report_count=0,
            zero_ct02_report_count=0,
            villages=[],
            interpretation="Chưa có dữ liệu.",
        )
    )
    app.dependency_overrides[get_supabase_admin] = lambda: admin
    app.dependency_overrides[require_authenticated_user] = lambda: profile
    try:
        with (
            patch(
                "routers.cnscd_impact.CnscdImpactService",
                return_value=service,
            ),
            patch(
                "routers.cnscd_impact.safe_resolve_period",
                new=AsyncMock(
                    return_value=(UUID(PERIOD_ID), {"id": PERIOD_ID})
                ),
            ),
        ):
            response = TestClient(app).get(
                f"/api/cnscd-impact?period_id={PERIOD_ID}",
                headers={"Authorization": "Bearer caller-jwt"},
            )
    finally:
        app.dependency_overrides.pop(get_supabase_admin, None)
        app.dependency_overrides.pop(require_authenticated_user, None)

    assert response.status_code == 200, response.text
    scoped.list_user_village_ids.assert_awaited_once_with(profile.id)
    service.calculate.assert_awaited_once_with(
        PERIOD_ID,
        village_ids=(VILLAGE_ID,),
        scope="assigned_villages",
    )
    assert response.json()["scope"] == "assigned_villages"


def test_village_officer_cannot_access_cnscd_cross_village_analytics() -> None:
    profile = UserProfile(
        id="00000000-0000-4000-8000-00000000a002",
        role="can_bo_thon",
        village_id=VILLAGE_ID,
        force_password_reset=False,
        commune_id="ba_na",
    )
    app.dependency_overrides[get_supabase_admin] = lambda: MagicMock()
    app.dependency_overrides[require_authenticated_user] = lambda: profile
    try:
        response = TestClient(app).get(
            f"/api/cnscd-impact?period_id={PERIOD_ID}",
        )
    finally:
        app.dependency_overrides.pop(get_supabase_admin, None)
        app.dependency_overrides.pop(require_authenticated_user, None)

    assert response.status_code == 403


def test_policy_scorecard_uses_the_callers_rls_client() -> None:
    admin = MagicMock()
    scoped = MagicMock()
    admin.as_user.return_value = scoped
    service = MagicMock()
    service._supabase = scoped
    service.calculate = AsyncMock(
        return_value=PolicyScorecard(
            period_id=PERIOD_ID,
            period_name="Tháng 7/2026",
            electronic_profile_rate=ScoreMetric(1, 1, 100.0),
            once_only_score=ScoreMetric(10, 14, 71.43),
            interpretation="Dữ liệu kiểm thử.",
        )
    )
    app.dependency_overrides[get_supabase_admin] = lambda: admin
    app.dependency_overrides[require_admin_or_leader] = _leader
    try:
        with (
            patch("routers.policy_scorecard.PolicyScorecardService", return_value=service),
            patch(
                "routers.policy_scorecard.safe_resolve_period",
                new=AsyncMock(return_value=(UUID(PERIOD_ID), {"id": PERIOD_ID})),
            ),
        ):
            response = TestClient(app).get(
                f"/api/policy-scorecard?period_id={PERIOD_ID}",
                headers={"Authorization": "Bearer caller-jwt"},
            )
    finally:
        app.dependency_overrides.pop(get_supabase_admin, None)
        app.dependency_overrides.pop(require_admin_or_leader, None)

    assert response.status_code == 200, response.text
    admin.as_user.assert_called_once_with("caller-jwt")
    service.calculate.assert_awaited_once_with(PERIOD_ID)
