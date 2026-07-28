from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from routers.auth import _extract_bearer_token, get_settings, get_supabase_admin, require_admin_or_leader, require_admin_xa, require_authenticated_user
from services.decision_ai import enrich_decision_brief
from services.operations import (
    MATURITY_DIMENSIONS,
    QUALITY_RULE_VERSION,
    build_safe_period_brief,
    evidence_fingerprint_from_citations,
    quality_snapshot,
    validate_maturity_scores,
)
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

    @model_validator(mode="after")
    def require_terminal_outcome(self) -> "ActionUpdateRequest":
        if self.outcome is not None:
            self.outcome = self.outcome.strip() or None
        if self.status in {"completed", "cancelled"} and not self.outcome:
            raise ValueError("A completion result or cancellation reason is required")
        return self


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
    notes: str = Field(min_length=10, max_length=2000)

    @model_validator(mode="after")
    def normalize_review_notes(self) -> "AiDraftReviewRequest":
        self.notes = self.notes.strip()
        if len(self.notes) < 10:
            raise ValueError("Review notes must contain at least 10 characters")
        return self


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
    return {
        "period": period,
        "scope_role": profile.role,
        "rule_version": QUALITY_RULE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
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
    else:
        # Reopening an item must not retain a timestamp that says it is complete.
        changes["completed_at"] = None
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
    profile: Annotated[UserProfile, Depends(require_admin_or_leader)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    query = "/rest/v1/ai_action_drafts?select=*"
    if profile.role == "lanh_dao":
        # PostgreSQL enforces the same boundary. Keep this server-side filter as
        # defense in depth and avoid asking PostgREST for incomplete legacy
        # reviews. The local predicate also enforces the note-length contract.
        query += (
            "&status=eq.accepted"
            "&reviewed_by=not.is.null"
            "&reviewed_at=not.is.null"
            "&review_notes=not.is.null"
        )
    query += "&order=created_at.desc"
    rows = await _caller_client(supabase, authorization)._rest_request("GET", query)
    if profile.role != "lanh_dao":
        return rows
    return [row for row in rows if _has_complete_review_metadata(row)]


def _has_complete_review_metadata(draft: dict[str, Any]) -> bool:
    reviewed_by = draft.get("reviewed_by")
    reviewed_at = draft.get("reviewed_at")
    review_notes = draft.get("review_notes")
    return (
        isinstance(reviewed_by, str)
        and bool(reviewed_by.strip())
        and isinstance(reviewed_at, str)
        and bool(reviewed_at.strip())
        and isinstance(review_notes, str)
        and 10 <= len(review_notes.strip()) <= 2000
    )


def _same_deterministic_evidence(
    *,
    current_content: str,
    current_citations: list[dict[str, Any]],
    stored_draft: dict[str, Any],
) -> bool:
    """Compare source evidence while ignoring non-deterministic AI wording."""
    current_fingerprint = evidence_fingerprint_from_citations(current_citations)
    stored_citations = stored_draft.get("citations")
    stored_fingerprint = evidence_fingerprint_from_citations(
        stored_citations if isinstance(stored_citations, list) else None
    )
    if current_fingerprint and stored_fingerprint:
        return current_fingerprint == stored_fingerprint

    def normalize(citations: Any) -> list[dict[str, Any]]:
        if not isinstance(citations, list):
            return []
        normalized = []
        for citation in citations:
            if not isinstance(citation, dict) or citation.get("kind") not in {
                "quality_snapshot",
                "decision_metrics",
            }:
                continue
            normalized.append(
                {
                    key: value
                    for key, value in citation.items()
                    if key != "evidence_fingerprint"
                }
            )
        return normalized

    return (
        stored_draft.get("content") == current_content
        and normalize(stored_citations) == normalize(current_citations)
    )


def _has_ai_enrichment(citations: Any) -> bool:
    return isinstance(citations, list) and any(
        isinstance(citation, dict) and citation.get("kind") == "ai_enrichment"
        for citation in citations
    )


@router.post("/ai-drafts", status_code=status.HTTP_201_CREATED)
async def create_ai_draft(
    payload: AiDraftCreateRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    client = _caller_client(supabase, authorization)
    database_error: tuple[int, str] | None = None
    try:
        commune_id = await _commune_id(client, profile)
        period, snapshots = await _period_and_snapshots(client, payload.period_id)
        approved_snapshots = [
            item
            for item in snapshots
            if item.get("workflow_status") in {"approved", "locked"}
        ]
        if not approved_snapshots:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Chưa có báo cáo đã duyệt hoặc khóa để tạo bản tóm tắt.",
            )
        encoded_period_id = quote(str(payload.period_id), safe="")
        actions = await client._rest_request(
            "GET",
            (
                "/rest/v1/action_items"
                f"?period_id=eq.{encoded_period_id}"
                "&select=id,status,priority,due_date"
            ),
        )
        content, citations, confidence = build_safe_period_brief(
            str(period["name"]),
            approved_snapshots,
            actions=actions,
        )
        latest_drafts = await client._rest_request(
            "GET",
            (
                "/rest/v1/ai_action_drafts"
                f"?period_id=eq.{encoded_period_id}"
                "&kind=eq.period_brief"
                "&select=id,status,content,citations"
                "&order=created_at.desc&limit=20"
            ),
        )
        settings = get_settings()
        same_evidence_latest: dict[str, Any] | None = None
        if latest_drafts:
            if any(
                draft.get("status") == "pending_review"
                for draft in latest_drafts
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Đã có một bản tóm tắt đang chờ duyệt cho kỳ này.",
                )
            latest = latest_drafts[0]
            if _same_deterministic_evidence(
                current_content=content,
                current_citations=citations,
                stored_draft=latest,
            ):
                same_evidence_latest = latest
            if same_evidence_latest and not (
                settings.decision_ai_ready
                and not _has_ai_enrichment(latest.get("citations"))
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Căn cứ chưa thay đổi so với bản tóm tắt gần nhất.",
                )

        ai_attempt = await enrich_decision_brief(
            settings=settings,
            period_name=str(period["name"]),
            deterministic_content=content,
            citations=citations,
            safety_subject=profile.id,
        )
        if same_evidence_latest and ai_attempt.status != "enhanced":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "AI tạm thời chưa tạo được phân tích mới; "
                    "bản tóm tắt có căn cứ gần nhất vẫn được giữ nguyên."
                ),
            )
        if ai_attempt.citation:
            citations.append(ai_attempt.citation)
        rows = await client._rest_request("POST", "/rest/v1/ai_action_drafts", {
            "commune_id": commune_id, "period_id": str(payload.period_id), "kind": payload.kind,
            "content": content, "citations": citations, "confidence": confidence,
            "model_provider": ai_attempt.model_provider, "created_by": profile.id,
        }, prefer="return=representation")
    except SupabaseAdminError as exc:
        if exc.error_code == "23505":
            database_error = (
                status.HTTP_409_CONFLICT,
                "Đã có một bản phân tích đang chờ duyệt cho kỳ này.",
            )
        else:
            database_error = (
                status.HTTP_400_BAD_REQUEST,
                "Unable to create reviewed draft",
            )
    if database_error is not None:
        raise HTTPException(
            status_code=database_error[0],
            detail=database_error[1],
        )
    return rows[0]


@router.post("/ai-drafts/{draft_id}/review")
async def review_ai_draft(
    draft_id: UUID,
    payload: AiDraftReviewRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    review_error: tuple[int, str] | None = None
    try:
        rows = await _caller_client(supabase, authorization)._rest_request("PATCH", f"/rest/v1/ai_action_drafts?id=eq.{quote(str(draft_id), safe='')}&status=eq.pending_review", {
            # PostgreSQL derives reviewed_by from auth.uid() and reviewed_at
            # from the database clock; callers may not choose either value.
            "status": payload.decision, "review_notes": payload.notes,
        }, prefer="return=representation")
    except SupabaseAdminError as exc:
        if exc.error_code == "42501" or exc.status_code in {401, 403}:
            review_error = (
                status.HTTP_403_FORBIDDEN,
                "Unable to review draft",
            )
        elif exc.error_code == "23514":
            review_error = (
                status.HTTP_409_CONFLICT,
                "Draft review conflicts with its current state",
            )
        else:
            review_error = (
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Draft review service is temporarily unavailable",
            )
    if review_error is not None:
        raise HTTPException(
            status_code=review_error[0],
            detail=review_error[1],
        )
    if not rows:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Draft is missing or already reviewed")
    return rows[0]


__all__ = ["router", "MATURITY_DIMENSIONS"]
