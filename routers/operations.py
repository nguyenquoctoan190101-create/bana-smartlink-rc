from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from routers.auth import _extract_bearer_token, get_settings, get_supabase_admin, require_admin_or_leader, require_admin_xa, require_authenticated_user
from services.operations import MATURITY_DIMENSIONS, build_safe_period_brief, quality_snapshot, validate_maturity_scores
from services.settings import Settings
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile

router = APIRouter(prefix="/operations", tags=["operations"])


class ActionCreateRequest(BaseModel):
    period_id: UUID | None = None
    village_id: UUID | None = None
    source_type: Literal["manual", "trend_alert", "ai_draft", "maturity", "initiative", "proposal"] = "manual"
    source_id: UUID | None = None
    title: str = Field(min_length=3, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    priority: Literal["low", "normal", "high", "critical"] = "normal"
    owner_id: UUID | None = None
    due_date: date | None = None


class ActionUpdateRequest(BaseModel):
    status: Literal["pending", "in_progress", "completed", "cancelled"]
    outcome: str | None = Field(default=None, max_length=2000)


class MaturityCreateRequest(BaseModel):
    quarter_start: date
    scores: dict[str, int]
    evidence: dict[str, str] = Field(default_factory=dict)
    action_plan: str | None = Field(default=None, max_length=4000)
    status: Literal["draft", "submitted"] = "draft"

    @model_validator(mode="after")
    def validate_scores(self) -> "MaturityCreateRequest":
        try:
            self.scores = validate_maturity_scores(self.scores)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        return self


class InitiativeCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    problem_statement: str = Field(min_length=3, max_length=2000)
    value_hypothesis: str = Field(min_length=3, max_length=2000)
    owner_id: UUID | None = None
    effort: Literal["S", "M", "L"] = "M"
    data_risk: Literal["low", "medium", "high"] = "low"
    status: Literal["idea", "pilot", "active", "paused", "stopped", "scaled"] = "idea"
    kpi_baseline: dict[str, Any] = Field(default_factory=dict)
    kpi_target: dict[str, Any] = Field(default_factory=dict)


class AiDraftCreateRequest(BaseModel):
    period_id: UUID
    kind: Literal["period_brief"] = "period_brief"


class AiDraftReviewRequest(BaseModel):
    decision: Literal["accepted", "rejected"]
    notes: str | None = Field(default=None, max_length=2000)


def _caller_client(supabase: SupabaseAdminClient, authorization: str | None) -> SupabaseAdminClient:
    """Business reads/writes use caller JWT so PostgreSQL RLS remains effective."""
    return supabase.as_user(_extract_bearer_token(authorization))


def _require_experimental_feature(settings: Settings, field: str) -> None:
    if not bool(getattr(settings, field, False)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experimental feature is not enabled")


async def _commune_id(client: SupabaseAdminClient, profile: UserProfile) -> str:
    rows = await client._rest_request(
        "GET", f"/rest/v1/user_profiles?id=eq.{quote(profile.id, safe='')}&select=commune_id"
    )
    if not rows or not rows[0].get("commune_id"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Commune scope is unavailable")
    return str(rows[0]["commune_id"])


async def _period_and_snapshots(client: SupabaseAdminClient, period_id: UUID) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    encoded = quote(str(period_id), safe="")
    periods = await client._rest_request("GET", f"/rest/v1/report_periods?id=eq.{encoded}&select=id,name,commune_id")
    if not periods:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report period not found")
    reports = await client._rest_request(
        "GET",
        "/rest/v1/reports?period_id=eq." + encoded + "&select=id,village_id,workflow_status,timeliness_status,report_source,version",
    )
    if not reports:
        return periods[0], []
    report_ids = ",".join(quote(str(report["id"]), safe="") for report in reports)
    values = await client._rest_request("GET", f"/rest/v1/report_values?report_id=in.({report_ids})&select=report_id,ct_code,value")
    flags = await client._rest_request("GET", f"/rest/v1/report_validation_flags?report_id=in.({report_ids})&select=report_id,ct_code,error_type,resolved")
    villages = await client._rest_request("GET", "/rest/v1/villages?select=id,name")
    villages_by_id = {str(village["id"]): str(village["name"]) for village in villages}
    values_by_report: dict[str, list[dict[str, Any]]] = {}
    flags_by_report: dict[str, list[dict[str, Any]]] = {}
    for item in values:
        values_by_report.setdefault(str(item["report_id"]), []).append(item)
    for item in flags:
        flags_by_report.setdefault(str(item["report_id"]), []).append(item)
    snapshots = []
    for report in reports:
        report_id = str(report["id"])
        report_with_name = {**report, "village_name": villages_by_id.get(str(report["village_id"]), str(report["village_id"]))}
        snapshots.append(quality_snapshot(report_with_name, values_by_report.get(report_id, []), flags_by_report.get(report_id, [])))
    return periods[0], snapshots


@router.get("/quality")
async def get_quality_center(
    period_id: UUID,
    profile: Annotated[UserProfile, Depends(require_authenticated_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    try:
        period, snapshots = await _period_and_snapshots(_caller_client(supabase, authorization), period_id)
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to retrieve quality evidence") from exc
    average = round(sum(item["quality_score"] for item in snapshots) / len(snapshots), 1) if snapshots else None
    return {
        "period": period,
        "scope_role": profile.role,
        "rule_version": "2026-07-14",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "average_quality_score": average,
        "reports": snapshots,
    }


@router.get("/actions")
async def list_actions(
    period_id: UUID | None = None,
    _: Annotated[UserProfile, Depends(require_authenticated_user)] = None,  # type: ignore[assignment]
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)] = None,  # type: ignore[assignment]
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    query = "/rest/v1/action_items?select=*&order=due_date.asc.nullslast,created_at.desc"
    if period_id:
        query += f"&period_id=eq.{quote(str(period_id), safe='')}"
    try:
        return await _caller_client(supabase, authorization)._rest_request("GET", query)
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to retrieve actions") from exc


@router.post("/actions", status_code=status.HTTP_201_CREATED)
async def create_action(
    payload: ActionCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    client = _caller_client(supabase, authorization)
    try:
        commune_id = await _commune_id(client, profile)
        rows = await client._rest_request("POST", "/rest/v1/action_items", {
            **payload.model_dump(mode="json", exclude_none=True), "commune_id": commune_id,
            "created_by": profile.id,
        }, prefer="return=representation")
        return rows[0]
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to create action") from exc


@router.patch("/actions/{action_id}")
async def update_action(
    action_id: UUID,
    payload: ActionUpdateRequest,
    _: Annotated[UserProfile, Depends(require_authenticated_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    changes = payload.model_dump(exclude_none=True)
    if payload.status == "completed":
        changes["completed_at"] = datetime.now(timezone.utc).isoformat()
    try:
        rows = await _caller_client(supabase, authorization)._rest_request("PATCH", f"/rest/v1/action_items?id=eq.{quote(str(action_id), safe='')}", changes, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unable to update action") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")
    return rows[0]


@router.get("/maturity")
async def list_maturity(
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    _require_experimental_feature(settings, "feature_digital_maturity")
    return await _caller_client(supabase, authorization)._rest_request("GET", "/rest/v1/digital_maturity_assessments?select=*&order=quarter_start.desc")


@router.post("/maturity", status_code=status.HTTP_201_CREATED)
async def create_maturity(
    payload: MaturityCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    _require_experimental_feature(settings, "feature_digital_maturity")
    client = _caller_client(supabase, authorization)
    try:
        commune_id = await _commune_id(client, profile)
        rows = await client._rest_request("POST", "/rest/v1/digital_maturity_assessments", {**payload.model_dump(mode="json"), "commune_id": commune_id, "created_by": profile.id}, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to save maturity assessment") from exc
    return rows[0]


@router.post("/maturity/{assessment_id}/approve")
async def approve_maturity(
    assessment_id: UUID,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    _require_experimental_feature(settings, "feature_digital_maturity")
    try:
        rows = await _caller_client(supabase, authorization)._rest_request(
            "PATCH",
            f"/rest/v1/digital_maturity_assessments?id=eq.{quote(str(assessment_id), safe='')}&status=in.(draft,submitted)",
            {"status": "approved", "approved_by": profile.id, "approved_at": datetime.now(timezone.utc).isoformat()},
            prefer="return=representation",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unable to approve maturity assessment") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assessment is missing or already approved")
    return rows[0]


@router.get("/initiatives")
async def list_initiatives(
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    return await _caller_client(supabase, authorization)._rest_request("GET", "/rest/v1/innovation_initiatives?select=*&order=created_at.desc")


@router.post("/initiatives", status_code=status.HTTP_201_CREATED)
async def create_initiative(
    payload: InitiativeCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    client = _caller_client(supabase, authorization)
    try:
        commune_id = await _commune_id(client, profile)
        rows = await client._rest_request("POST", "/rest/v1/innovation_initiatives", {**payload.model_dump(mode="json"), "commune_id": commune_id, "created_by": profile.id}, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to save initiative") from exc
    return rows[0]


@router.get("/ai-drafts")
async def list_ai_drafts(
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    return await _caller_client(supabase, authorization)._rest_request("GET", "/rest/v1/ai_action_drafts?select=*&order=created_at.desc")


@router.post("/ai-drafts", status_code=status.HTTP_201_CREATED)
async def create_ai_draft(
    payload: AiDraftCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_or_leader)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    client = _caller_client(supabase, authorization)
    try:
        commune_id = await _commune_id(client, profile)
        period, snapshots = await _period_and_snapshots(client, payload.period_id)
        approved_snapshots = [
            item
            for item in snapshots
            if item.get("workflow_status") in {"approved", "locked"}
        ]
        content, citations, confidence = build_safe_period_brief(
            str(period["name"]),
            approved_snapshots,
        )
        rows = await client._rest_request("POST", "/rest/v1/ai_action_drafts", {
            "commune_id": commune_id, "period_id": str(payload.period_id), "kind": payload.kind,
            "content": content, "citations": citations, "confidence": confidence,
            "model_provider": "deterministic-evidence-v1", "created_by": profile.id,
        }, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to create reviewed draft") from exc
    return rows[0]


@router.post("/ai-drafts/{draft_id}/review")
async def review_ai_draft(
    draft_id: UUID,
    payload: AiDraftReviewRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    try:
        rows = await _caller_client(supabase, authorization)._rest_request("PATCH", f"/rest/v1/ai_action_drafts?id=eq.{quote(str(draft_id), safe='')}&status=eq.pending_review", {
            "status": payload.decision, "reviewed_by": profile.id, "reviewed_at": datetime.now(timezone.utc).isoformat(), "review_notes": payload.notes,
        }, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unable to review draft") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Draft is missing or already reviewed")
    return rows[0]


__all__ = ["router", "MATURITY_DIMENSIONS"]
