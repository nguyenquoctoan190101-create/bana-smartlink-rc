from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field, field_validator

from routers.auth import (
    get_optional_user,
    get_settings,
    get_supabase_admin,
    require_admin_xa,
    require_authenticated_user,
)
from services.rate_limit import limiter
from services.case_media_validator import (
    CaseMediaValidationError,
    MAX_IMAGE_COUNT,
    validate_case_media,
)
from services.settings import Settings
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile

router = APIRouter(prefix="/cases", tags=["citizen-cases"])
_TRACKING_RE = re.compile(r"^[A-F0-9]{32}$")
_MEDIA_BUCKET = "citizen-case-media"


class CaseCreateRequest(BaseModel):
    village_id: UUID | None = None
    category: Literal["road", "waste", "water", "power", "public_building", "drainage", "safety", "other"]
    description: str = Field(min_length=5, max_length=4000)
    priority: Literal["low", "normal", "high", "critical"] = "normal"
    submitter_name: str | None = Field(default=None, max_length=120)
    submitter_phone: str | None = Field(default=None, max_length=20)
    submitter_address: str | None = Field(default=None, max_length=500)
    consent_version: str = Field(min_length=1, max_length=40)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100000)
    location_source: Literal["gps", "manual_pin"] | None = None
    location_confirmed: bool = False

    @field_validator("description", "consent_version")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("submitter_phone")
    @classmethod
    def valid_phone(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"\+?[0-9]{9,15}", value.strip()):
            raise ValueError("invalid phone number")
        return value.strip() if value else None


class CaseStatusRequest(BaseModel):
    status: Literal["verifying", "assigned", "in_progress", "completed", "out_of_scope", "rejected"]
    note: str | None = Field(default=None, max_length=2000)


class CaseAssignmentRequest(BaseModel):
    department: str = Field(min_length=2, max_length=160)
    assignee_id: UUID | None = None


def _tracking_code() -> tuple[str, str]:
    """Return a one-time-display token and its SHA-256 storage value."""
    code = secrets.token_hex(16).upper()
    return code, hashlib.sha256(code.encode("ascii")).hexdigest()


def _hash_tracking_code(code: str) -> str:
    normalized = code.strip().upper()
    if not _TRACKING_RE.fullmatch(normalized):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tracking code")
    return hashlib.sha256(normalized.encode("ascii")).hexdigest()


def _safe_case(row: dict[str, Any]) -> dict[str, Any]:
    """Whitelist the public tracking response; never expose PII or internal notes."""
    return {
        "id": row.get("id"),
        "category": row.get("category"),
        "status": row.get("status"),
        "priority": row.get("priority"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "assigned_department": row.get("assigned_department"),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def create_case(
    request: Request,
    payload: CaseCreateRequest,
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    _user: Annotated[UserProfile | None, Depends(get_optional_user)],
) -> dict[str, Any]:
    """Submit a public field report.  Citizens do not need an account."""
    if not settings.feature_cases:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Citizen reporting is disabled")
    if (payload.latitude is None) != (payload.longitude is None):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Latitude and longitude must be provided together")
    if payload.latitude is not None and not payload.location_confirmed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Location confirmation is required")
    tracking_code, tracking_hash = _tracking_code()
    rpc_payload = {
        "p_commune_id": settings.bana_commune_id,
        "p_village_id": str(payload.village_id) if payload.village_id else None,
        "p_category": payload.category,
        "p_description": payload.description,
        "p_priority": payload.priority,
        "p_submitter_name": payload.submitter_name.strip() if payload.submitter_name else None,
        "p_submitter_phone": payload.submitter_phone,
        "p_submitter_address": payload.submitter_address.strip() if payload.submitter_address else None,
        "p_consent_version": payload.consent_version,
        "p_consent_at": datetime.now(timezone.utc).isoformat(),
        "p_tracking_code_hash": tracking_hash,
        "p_latitude": payload.latitude,
        "p_longitude": payload.longitude,
        "p_accuracy_m": payload.accuracy_m,
        "p_location_source": payload.location_source,
        "p_location_confirmed": payload.location_confirmed,
    }
    try:
        rows = await supabase._rest_request("POST", "/rest/v1/rpc/create_citizen_case", rpc_payload)
    except SupabaseAdminError as exc:
        if exc.status_code in {400, 409}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unable to create field report") from exc
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Field reporting service is unavailable") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Field reporting service returned no case")
    result = rows[0]
    return {"tracking_code": tracking_code, "case": _safe_case(result), "message": "Report received. Keep this code to check status."}


@router.get("/track/{tracking_code}")
@limiter.limit("30/hour")
async def track_case(
    request: Request,
    tracking_code: str,
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> dict[str, Any]:
    """Public, non-PII status lookup by an unguessable token."""
    if not settings.feature_cases:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Citizen reporting is disabled")
    tracking_hash = _hash_tracking_code(tracking_code)
    try:
        rows = await supabase._rest_request(
            "GET",
            "/rest/v1/citizen_cases?tracking_code_hash=eq." + quote(tracking_hash, safe="")
            + "&commune_id=eq." + quote(settings.bana_commune_id, safe="")
            + "&select=id,category,status,priority,created_at,updated_at,assigned_department",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Tracking service is unavailable") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracking code not found")
    safe = _safe_case(rows[0])
    return {"status": safe.get("status"), "case": safe, "privacy": "Personal information and internal notes are not displayed."}


@router.post("/{case_id}/media", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/hour")
async def upload_case_media(
    request: Request,
    case_id: UUID,
    tracking_code: Annotated[str, Form(...)],
    file: Annotated[UploadFile, File(...)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> dict[str, Any]:
    """Store a citizen image only after proving possession of its tracking code.

    The bucket is private and the service key is used only by this narrow,
    server-validated path.  Public responses never expose the storage path.
    """
    if not settings.feature_cases:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Citizen reporting is disabled")
    tracking_hash = _hash_tracking_code(tracking_code)
    case_filter = (
        f"/rest/v1/citizen_cases?id=eq.{quote(str(case_id), safe='')}"
        f"&commune_id=eq.{quote(settings.bana_commune_id, safe='')}"
        f"&tracking_code_hash=eq.{quote(tracking_hash, safe='')}&select=id"
    )
    try:
        cases = await supabase._rest_request("GET", case_filter)
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Media service is unavailable") from exc
    if not cases:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field report not found")

    try:
        media_rows = await supabase._rest_request(
            "GET",
            f"/rest/v1/case_media?case_id=eq.{quote(str(case_id), safe='')}&select=id,mime_type",
        )
        content, mime_type, extension = await validate_case_media(file)
    except CaseMediaValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Media service is unavailable") from exc

    image_count = sum(1 for row in media_rows if str(row.get("mime_type", "")).startswith("image/"))
    if image_count >= MAX_IMAGE_COUNT:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A field report can have at most 5 images")

    object_path = f"{settings.bana_commune_id}/cases/{case_id}/{secrets.token_hex(16)}.{extension}"
    try:
        await supabase.upload_storage_object_admin(_MEDIA_BUCKET, object_path, content, mime_type)
        rows = await supabase._rest_request(
            "POST",
            "/rest/v1/case_media",
            {
                "case_id": str(case_id),
                "storage_path": object_path,
                "sha256": hashlib.sha256(content).hexdigest(),
                "mime_type": mime_type,
                "size_bytes": len(content),
                "moderation_status": "pending",
            },
            prefer="return=representation",
        )
    except SupabaseAdminError as exc:
        try:
            await supabase.delete_storage_object_admin(_MEDIA_BUCKET, object_path)
        except SupabaseAdminError:
            pass
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unable to store attachment") from exc

    if not rows:
        try:
            await supabase.delete_storage_object_admin(_MEDIA_BUCKET, object_path)
        except SupabaseAdminError:
            pass
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Attachment metadata was not stored")
    row = rows[0]
    return {"id": row.get("id"), "mime_type": mime_type, "size_bytes": len(content), "moderation_status": "pending"}


@router.get("")
async def list_cases(
    profile: Annotated[UserProfile, Depends(require_authenticated_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
    status_filter: str | None = None,
) -> list[dict[str, Any]]:
    """Internal queue; Postgres RLS remains the final scope boundary."""
    if profile.role not in {"admin_xa", "lanh_dao", "to_cnscd", "can_bo_thon"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Role cannot view field reports")
    query = "/rest/v1/citizen_cases?select=id,commune_id,village_id,category,description,priority,status,assigned_department,sla_due_at,routing_rule_id,created_at,updated_at&order=created_at.desc"
    if status_filter:
        if status_filter not in {"received", "verifying", "assigned", "in_progress", "completed", "out_of_scope", "rejected"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid status filter")
        query += "&status=eq." + quote(status_filter, safe="")
    try:
        return await supabase.as_user(_extract_bearer(authorization))._rest_request("GET", query)
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to retrieve field reports") from exc


@router.get("/routing-rules")
async def list_routing_rules(
    _: Annotated[UserProfile, Depends(require_authenticated_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    """Return the approved or demo routing catalogue within the caller's RLS scope."""
    query = (
        "/rest/v1/routing_rules?"
        "select=id,category,department,priority,verification_minutes,"
        "resolution_minutes,escalation_department,is_active,is_demo,sla_version"
        "&commune_id=eq."
        + quote(settings.bana_commune_id, safe="")
        + "&is_active=eq.true&order=category.asc,priority.asc"
    )
    try:
        return await supabase.as_user(_extract_bearer(authorization))._rest_request(
            "GET", query
        )
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to retrieve routing rules",
        ) from exc


def _extract_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    return token


@router.patch("/{case_id}/status")
async def update_case_status(
    case_id: UUID,
    payload: CaseStatusRequest,
    profile: Annotated[UserProfile, Depends(require_authenticated_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if profile.role not in {"admin_xa", "to_cnscd"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admin_xa or to_cnscd can update case status")
    try:
        rows = await supabase.as_user(_extract_bearer(authorization))._rest_request(
            "PATCH", f"/rest/v1/citizen_cases?id=eq.{quote(str(case_id), safe='')}",
            {"status": payload.status, "updated_at": datetime.now(timezone.utc).isoformat()},
            prefer="return=representation",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unable to update field report") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field report not found")
    return _safe_case(rows[0])


@router.post("/{case_id}/assignment", status_code=status.HTTP_201_CREATED)
async def assign_case(
    case_id: UUID,
    payload: CaseAssignmentRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Admin-only routing mutation; AI suggestions can never call this endpoint."""
    client = supabase.as_user(_extract_bearer(authorization))
    try:
        rows = await client._rest_request(
            "POST",
            "/rest/v1/rpc/assign_citizen_case",
            {
                "p_case_id": str(case_id),
                "p_department": payload.department.strip(),
                "p_assignee_id": str(payload.assignee_id)
                if payload.assignee_id
                else None,
            },
            prefer="return=representation",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unable to assign field report") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field report not found")
    return rows[0]


__all__ = ["router"]
