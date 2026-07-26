from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from routers.auth import get_settings, get_supabase_admin, require_admin_xa, require_authenticated_user
from services.settings import Settings
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile

router = APIRouter(prefix="/knowledge", tags=["knowledge-and-scenarios"])


class ArticleCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    summary: str | None = Field(default=None, max_length=1000)
    body: str = Field(min_length=3, max_length=30000)
    category: Literal["procedure", "guidance", "lesson_learned", "faq", "policy"]
    audience: Literal["internal", "champions", "public"] = "internal"
    effective_from: str | None = None


class ChampionCreateRequest(BaseModel):
    user_id: UUID
    village_id: UUID | None = None
    skills: list[str] = Field(default_factory=list, max_length=20)
    support_schedule: str | None = Field(default=None, max_length=500)
    supported_groups: str | None = Field(default=None, max_length=1000)


class SupportPointCreateRequest(BaseModel):
    village_id: UUID | None = None
    name: str = Field(min_length=2, max_length=180)
    address: str = Field(min_length=2, max_length=500)
    opening_hours: str | None = Field(default=None, max_length=300)
    equipment: list[str] = Field(default_factory=list, max_length=30)
    champion_id: UUID | None = None


class ScenarioCreateRequest(BaseModel):
    name: str = Field(min_length=3, max_length=180)
    description: str | None = Field(default=None, max_length=2000)


class ScenarioRunRequest(BaseModel):
    baseline: dict[str, float] = Field(min_length=1, max_length=20)
    assumptions: dict[str, float] = Field(min_length=1, max_length=10)


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Bearer token required")
    return authorization[7:].strip()


def _caller(client: SupabaseAdminClient, authorization: str | None) -> SupabaseAdminClient:
    return client.as_user(_bearer(authorization))


@router.get("/articles")
async def list_articles(
    _: Annotated[UserProfile, Depends(require_authenticated_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
    audience: str | None = None,
) -> list[dict[str, Any]]:
    query = "/rest/v1/knowledge_articles?select=id,title,summary,body,category,audience,version,status,effective_from,updated_at&order=updated_at.desc"
    if audience in {"internal", "champions", "public"}:
        query += "&audience=eq." + quote(audience, safe="")
    try:
        return await _caller(supabase, authorization)._rest_request("GET", query)
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=502, detail="Unable to retrieve knowledge articles") from exc


@router.post("/articles", status_code=201)
async def create_article(
    payload: ArticleCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    data = {**payload.model_dump(exclude_none=True), "commune_id": settings.bana_commune_id, "created_by": profile.id}
    try:
        rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/knowledge_articles", data, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=400, detail="Unable to save knowledge article") from exc
    return rows[0]


@router.post("/articles/{article_id}/approve")
async def approve_article(
    article_id: UUID,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    try:
        rows = await _caller(supabase, authorization)._rest_request("PATCH", f"/rest/v1/knowledge_articles?id=eq.{quote(str(article_id), safe='')}", {"status": "approved", "approved_by": profile.id, "approved_at": datetime.now(timezone.utc).isoformat()}, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=403, detail="Unable to approve article") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="Article not found")
    return rows[0]


@router.get("/champions")
async def list_champions(
    _: Annotated[UserProfile, Depends(require_authenticated_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    return await _caller(supabase, authorization)._rest_request("GET", "/rest/v1/digital_champions?select=*&order=created_at.desc")


@router.post("/champions", status_code=201)
async def create_champion(
    payload: ChampionCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    data = {**payload.model_dump(mode="json"), "commune_id": settings.bana_commune_id, "created_by": profile.id}
    rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/digital_champions", data, prefer="return=representation")
    return rows[0]


@router.get("/support-points")
async def list_support_points(
    _: Annotated[UserProfile, Depends(require_authenticated_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    return await _caller(supabase, authorization)._rest_request("GET", "/rest/v1/community_support_points?select=*&order=name.asc")


@router.post("/support-points", status_code=201)
async def create_support_point(
    payload: SupportPointCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    data = {**payload.model_dump(mode="json"), "commune_id": settings.bana_commune_id, "created_by": profile.id}
    rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/community_support_points", data, prefer="return=representation")
    return rows[0]


@router.get("/scenarios")
async def list_scenarios(
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    if not settings.feature_scenario_simulation:
        raise HTTPException(status_code=404, detail="Experimental feature is not enabled")
    return await _caller(supabase, authorization)._rest_request("GET", "/rest/v1/scenarios?select=*&order=updated_at.desc")


@router.post("/scenarios", status_code=201)
async def create_scenario(
    payload: ScenarioCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not settings.feature_scenario_simulation:
        raise HTTPException(status_code=404, detail="Experimental feature is not enabled")
    rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/scenarios", {**payload.model_dump(exclude_none=True), "commune_id": settings.bana_commune_id, "created_by": profile.id}, prefer="return=representation")
    return rows[0]


@router.post("/scenarios/{scenario_id}/run", status_code=201)
async def run_scenario(
    scenario_id: UUID,
    payload: ScenarioRunRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not settings.feature_scenario_simulation:
        raise HTTPException(status_code=404, detail="Experimental feature is not enabled")
    allowed = {"population_change_pct", "budget_change_pct", "service_demand_change_pct"}
    if set(payload.assumptions) - allowed:
        raise HTTPException(status_code=422, detail="Unsupported scenario assumption")
    if any(not isinstance(value, (int, float)) or value < -100 or value > 1000 for value in payload.assumptions.values()):
        raise HTTPException(status_code=422, detail="Scenario assumptions are out of range")
    result: dict[str, float] = {}
    for key, base in payload.baseline.items():
        if base < 0:
            raise HTTPException(status_code=422, detail="Baseline values must be non-negative")
        if key == "population":
            change = payload.assumptions.get("population_change_pct", 0)
        elif key == "budget":
            change = payload.assumptions.get("budget_change_pct", 0)
        elif key in {"service_demand", "demand"}:
            change = payload.assumptions.get("service_demand_change_pct", 0)
        else:
            change = 0
        result[key] = round(base * (1 + change / 100), 3)
    result_payload = {
        "baseline": payload.baseline,
        "assumptions": payload.assumptions,
        "projection": result,
        "formula": "baseline x (1 + assumption_percent / 100)",
        "sensitivity": "Deterministic v1; no prediction or write-back to reports.",
    }
    rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/scenario_runs", {"scenario_id": str(scenario_id), "commune_id": settings.bana_commune_id, "baseline": payload.baseline, "assumptions": payload.assumptions, "result": result_payload, "formula_version": "deterministic-2026-07-18", "created_by": profile.id}, prefer="return=representation")
    return rows[0] if rows else {"result": result_payload}


__all__ = ["router"]
