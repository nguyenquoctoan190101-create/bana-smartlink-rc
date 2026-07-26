from __future__ import annotations

import inspect
import json
import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import fastapi
from main import app
from routers import auth, push, reports
from services import chatbot


INVENTORY_PATH = Path(__file__).with_name("route_authorization_inventory.json")
INVENTORY = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "trace"}
AUTH_DEPENDENCY = {
    "optional": "get_optional_user",
    "active_user": "require_active_user",
    "authenticated": "require_authenticated_user",
    "admin": "require_admin_xa",
    "admin_or_leader": "require_admin_or_leader",
}


def _inventory_by_operation() -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (item["method"], item["path"]): item
        for item in INVENTORY["routes"]
    }


def _openapi_operations() -> set[tuple[str, str]]:
    schema = app.openapi()
    return {
        (method.upper(), path)
        for path, path_item in schema["paths"].items()
        for method in path_item
        if method in HTTP_METHODS
    }


def _effective_routes() -> dict[tuple[str, str], Any]:
    result: dict[tuple[str, str], Any] = {}
    for root_route in app.routes:
        contexts = (
            root_route.effective_route_contexts()
            if hasattr(root_route, "effective_route_contexts")
            else (root_route,)
        )
        for route in contexts:
            if not getattr(route, "include_in_schema", False):
                continue
            for method in route.methods or ():
                result[(method.upper(), route.path_format)] = route
    return result


def _dependency_names(dependant: Any) -> set[str]:
    names: set[str] = set()

    def visit(node: Any) -> None:
        for child in node.dependencies:
            names.add(getattr(child.call, "__name__", child.call.__class__.__name__))
            visit(child)

    visit(dependant)
    return names


def test_openapi_generation_is_complete_under_pinned_fastapi() -> None:
    assert fastapi.__version__ == "0.139.0"
    schema = app.openapi()
    assert schema["openapi"].startswith("3.1.")
    assert _openapi_operations() == set(_inventory_by_operation())


def test_every_inventory_policy_matches_runtime_dependency_graph() -> None:
    routes = _effective_routes()
    assert set(routes) == set(_inventory_by_operation())
    all_auth_dependencies = set(AUTH_DEPENDENCY.values())

    for operation, policy in _inventory_by_operation().items():
        dependencies = _dependency_names(routes[operation].dependant)
        authorization = policy["authorization"]
        if authorization == "public":
            assert dependencies.isdisjoint(all_auth_dependencies), operation
        else:
            assert AUTH_DEPENDENCY[authorization] in dependencies, operation


def test_public_routes_cannot_expose_ct14_or_add_unreviewed_mutations() -> None:
    public_mutation_allowlist = {
        ("POST", "/auth/citizen/pending-updates"),
        ("POST", "/api/cases/{case_id}/media"),
    }
    for operation, policy in _inventory_by_operation().items():
        if policy["authorization"] in {"public", "optional"}:
            assert policy["may_include_ct14"] is False, operation
        if policy["mutates"] and policy["authorization"] == "public":
            assert operation in public_mutation_allowlist, operation

    assert INVENTORY["public_indicator_codes"] == ["CT01", "CT02", "CT09", "CT12", "CT13"]
    assert set(chatbot.PUBLIC_CT_CODES) == set(INVENTORY["public_indicator_codes"])
    assert "CT14" not in chatbot._PUBLIC_CT_SQL


def test_public_report_handler_filters_ct14_even_if_upstream_over_returns() -> None:
    class FakeSupabase:
        async def _rest_request(self, method: str, path: str):
            assert method == "GET"
            assert "publication_status=eq.published" in path
            return [{
                "id": "11111111-1111-4111-8111-111111111111",
                "village_id": "22222222-2222-4222-8222-222222222222",
                "published_at": "2026-07-13T00:00:00Z",
                "report_periods": {
                    "name": "Kỳ kiểm thử",
                    "commune_id": "ba_na",
                },
                "villages": {"commune_id": "ba_na"},
                "report_values": [
                    {"ct_code": "CT01", "value": 10},
                    {"ct_code": "CT14", "value": 99},
                ],
            }]

    result = asyncio.run(
        reports.get_public_reports(
            FakeSupabase(),
            SimpleNamespace(bana_commune_id="ba_na"),
        )
    )
    assert result[0]["values"] == {"CT01": 10}


def test_public_chatbot_sql_is_published_and_whitelisted() -> None:
    class FakeConnection:
        query = ""

        async def fetch(self, query: str, *params: Any):
            self.query = query
            return []

    connection = FakeConnection()
    asyncio.run(
        chatbot._query_village_all_stats(
            connection,
            village_names=[],
            period_name=None,
            xa_id=None,
            caller_role="dan",
        )
    )
    assert "r.publication_status = 'published'" in connection.query
    assert chatbot._PUBLIC_CT_SQL in connection.query


def test_notification_queries_are_owner_scoped() -> None:
    list_source = inspect.getsource(push.list_notifications)
    mark_source = inspect.getsource(push.mark_notification_as_read)
    assert "WHERE user_id = $1::uuid" in list_source
    assert "WHERE id = $1 AND user_id = $2::uuid" in mark_source


def test_direct_database_routes_fail_closed_to_role_and_assignment_scope() -> None:
    proposals_source = inspect.getsource(auth.list_proposals)
    values_source = inspect.getsource(auth.list_report_values)
    for source in (proposals_source, values_source):
        assert "user_village_assignments" in source
        assert 'user.role == "to_cnscd"' in source
        assert 'user.role == "can_bo_thon"' in source
        assert 'user.role in {"admin_xa", "lanh_dao"}' in source


def test_admin_account_mutations_cannot_target_admin_or_leader_accounts() -> None:
    toggle_source = inspect.getsource(auth.toggle_active_officer)
    reset_source = inspect.getsource(auth.reset_officer_password)
    for source in (toggle_source, reset_source):
        assert "target.role IN ('can_bo_thon', 'to_cnscd')" in source
        assert "target.commune_id = actor.commune_id" in source


def test_internal_exports_and_commune_analytics_are_never_public() -> None:
    for operation, policy in _inventory_by_operation().items():
        path = operation[1]
        if "/export/" in path or path.endswith("/trend-alerts") or path.startswith("/api/"):
            if path.startswith("/api/notifications"):
                continue
            if operation in {
                ("POST", "/api/cases"),
                ("GET", "/api/cases/track/{tracking_code}"),
                    ("POST", "/api/cases/{case_id}/media"),
                    ("GET", "/api/pilots/tourism/places"),
                    ("GET", "/api/pilots/evacuation-points"),
                }:
                # Public field reporting is intentionally a capability-limited
                # anonymous mutation; it returns only a tracking token and is
                # protected by rate limiting, consent and RLS-backed RPC.
                continue
            assert policy["authorization"] in {"authenticated", "admin", "admin_or_leader"}
