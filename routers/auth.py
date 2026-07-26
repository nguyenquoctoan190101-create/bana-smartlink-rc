from __future__ import annotations

import asyncio
import inspect
import json
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator

from services.passwords import generate_temporary_password
from services.rate_limit import limiter
from services.security import (
    AuthError,
    AuthVerificationUnavailable,
    verify_supabase_jwt,
)
from services.settings import Settings, SettingsError, load_settings
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile
from services.validator import validate_report, validate_phone
import asyncpg
from services.proposal_actions import ProposalValidationError, execute_proposal_action


StaffRole = Literal["can_bo_thon", "to_cnscd"]

router = APIRouter(prefix="/auth", tags=["auth"])


class CreateStaffAccountRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, min_length=10, max_length=20)
    role: StaffRole
    village_id: UUID


class CreateStaffAccountResponse(BaseModel):
    user_id: UUID
    role: StaffRole
    village_id: UUID
    force_password_reset: bool
    temporary_password: str

class ResetPasswordResponse(BaseModel):
    temporary_password: str


class ChangePasswordRequest(BaseModel):
    new_password: str = Field(min_length=12, max_length=128)


class CurrentUserResponse(BaseModel):
    id: str
    role: str
    village_id: str | None
    display_name: str | None
    phone: str | None
    is_active: bool
    force_password_reset: bool
    assigned_village_ids: list[str] = Field(default_factory=list)


class CitizenPendingUpdateRequest(BaseModel):
    village_id: UUID
    report_id: UUID
    ct_code: str = Field(min_length=1, max_length=8)
    proposed_value: int
    proposed_by_phone: str
    submitter_name: str | None = Field(default=None, max_length=100)
    submitter_household: str | None = Field(default=None, max_length=100)
    submitter_address: str | None = Field(default=None, max_length=200)
    submitter_relation: str | None = Field(default=None, max_length=100)
    explanation: str | None = Field(default=None, max_length=1000)
    privacy_consent: Literal[True]


class CitizenPendingUpdateResponse(BaseModel):
    id: UUID
    report_id: UUID
    ct_code: str
    proposed_value: int
    status: str
    tracking_code: str | None = None


class CitizenProposalTrackingResponse(BaseModel):
    tracking_code: str
    status: str
    ct_code: str
    submitted_at: str
    message: str


class OfficerResponse(BaseModel):
    id: str
    name: str
    email: str | None
    phone: str | None
    role: str
    village_id: str | None
    is_active: bool
    last_login: str | None

class ProposalResponse(BaseModel):
    id: str
    report_id: str
    village_id: str
    ct_code: str
    proposed_value: int
    previous_value: int | None = None
    proposed_by: str | None
    status: str
    reviewed_by: str | None
    reviewed_at: str | None
    created_at: str
    sla_due_at: str
    sla_status: Literal["on_track", "overdue", "closed"]

class ReportValueResponse(BaseModel):
    report_id: str
    ct_code: str
    value: int
    note: str | None

class AuditLogResponse(BaseModel):
    id: UUID
    action: str
    table_name: str
    record_id: str
    user_id: str | None
    details: str | None
    created_at: str

class ProposalActionRequest(BaseModel):
    action: Literal["approve", "reject"]
    notes: str = Field(min_length=3, max_length=1000)

    @field_validator("notes")
    @classmethod
    def normalize_review_notes(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 3:
            raise ValueError("Review notes must explain the decision")
        return normalized


def get_settings() -> Settings:
    try:
        return load_settings()
    except SettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Application configuration is unavailable",
        ) from exc


def get_supabase_admin(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> SupabaseAdminClient:
    return SupabaseAdminClient(
        settings,
        http_client=getattr(request.app.state, "supabase_http_client", None),
    )


async def get_db(settings: Annotated[Settings, Depends(get_settings)]):
    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        yield conn
    finally:
        await conn.close()


async def get_rls_read_db(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
):
    """Yield a read-only direct connection with the caller's verified RLS role.

    A raw DATABASE_URL connection commonly runs as an owner and therefore
    bypasses row-level security. These legacy aggregate reads explicitly enter
    the Supabase ``authenticated`` role inside a read-only transaction and set
    only claims from a locally verified token.
    """
    token = _extract_bearer_token(authorization)
    try:
        claims = await asyncio.to_thread(
            verify_supabase_jwt,
            token,
            settings.supabase_jwt_secret,
            expected_issuer=_string_setting(settings, "jwt_issuer"),
            expected_audience=_string_setting(settings, "supabase_jwt_audience"),
            jwks_url=_string_setting(settings, "jwks_url"),
        )
    except AuthVerificationUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication signing keys are temporarily unavailable",
        ) from exc
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Supabase Auth token",
        ) from exc

    subject = str(claims.get("sub") or "")
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Supabase Auth token",
        )

    conn = await asyncpg.connect(dsn=settings.database_url)
    transaction_candidate = conn.transaction(readonly=True)
    transaction = (
        await transaction_candidate
        if inspect.isawaitable(transaction_candidate)
        else transaction_candidate
    )
    try:
        await transaction.start()
        await conn.execute(
            """
            select
              set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claims', $2, true)
            """,
            subject,
            json.dumps(claims, separators=(",", ":")),
        )
        await conn.execute("set local role authenticated")
        yield conn
    finally:
        try:
            await transaction.rollback()
        finally:
            await conn.close()


async def require_admin_xa(
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> UserProfile:
    profile = await _authenticated_profile(settings, supabase, authorization)
    _enforce_profile_access(profile)
    if profile.role != "admin_xa":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin_xa can access this resource",
        )

    return profile


async def require_authenticated_user(
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> UserProfile:
    profile = await _authenticated_profile(settings, supabase, authorization)
    _enforce_profile_access(profile)
    return profile


async def require_active_user(
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> UserProfile:
    """Authenticate an active account while permitting a forced password reset."""
    profile = await _authenticated_profile(settings, supabase, authorization)
    if profile.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return profile


async def require_admin_or_leader(
    profile: Annotated[UserProfile, Depends(require_authenticated_user)],
) -> UserProfile:
    if profile.role not in {"admin_xa", "lanh_dao"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin_xa or lanh_dao can access this resource",
        )
    return profile


async def require_lanh_dao(
    profile: Annotated[UserProfile, Depends(require_authenticated_user)],
) -> UserProfile:
    if profile.role != "lanh_dao":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only lanh_dao can access this resource",
        )
    return profile


async def get_optional_user(
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> UserProfile | None:
    if not authorization:
        return None
    profile = await _authenticated_profile(settings, supabase, authorization)
    _enforce_profile_access(profile)
    return profile


async def _authenticated_profile(
    settings: Settings,
    supabase: SupabaseAdminClient,
    authorization: str | None,
) -> UserProfile:
    token = _extract_bearer_token(authorization)
    try:
        claims = await asyncio.to_thread(
            verify_supabase_jwt,
            token,
            settings.supabase_jwt_secret,
            expected_issuer=_string_setting(settings, "jwt_issuer"),
            expected_audience=_string_setting(settings, "supabase_jwt_audience"),
            jwks_url=_string_setting(settings, "jwks_url"),
        )
    except AuthVerificationUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication signing keys are temporarily unavailable",
        ) from exc
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Supabase Auth token",
        ) from exc

    try:
        profile = await supabase.get_user_profile(str(claims["sub"]))
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication profile service is unavailable",
        ) from exc
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile not found",
        )
    return profile


def _string_setting(settings: Settings, name: str) -> str | None:
    value = getattr(settings, name, "")
    return value if isinstance(value, str) and value.strip() else None


def _enforce_profile_access(profile: UserProfile) -> None:
    if profile.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    if profile.force_password_reset is True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password reset is required",
        )


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user(
    profile: Annotated[UserProfile, Depends(require_active_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> CurrentUserResponse:
    """Return the canonical profile without allowing business mutations."""
    assigned_village_ids: list[str] = []
    if profile.role == "can_bo_thon" and profile.village_id:
        assigned_village_ids = [profile.village_id]
    elif profile.role == "to_cnscd":
        try:
            assigned_village_ids = await supabase.list_user_village_ids(profile.id)
        except SupabaseAdminError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Village assignment service is unavailable",
            ) from exc
        if profile.village_id:
            assigned_village_ids.append(profile.village_id)
        assigned_village_ids = sorted(set(assigned_village_ids))
    return CurrentUserResponse(
        id=profile.id,
        role=profile.role,
        village_id=profile.village_id,
        display_name=profile.display_name,
        phone=profile.phone,
        is_active=profile.is_active,
        force_password_reset=profile.force_password_reset,
        assigned_village_ids=assigned_village_ids,
    )


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def change_password(
    payload: ChangePasswordRequest,
    profile: Annotated[UserProfile, Depends(require_active_user)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    """Change the caller's password, including first-login forced resets."""
    _validate_password_strength(payload.new_password)
    token = _extract_bearer_token(authorization)
    user_client = supabase.as_user(token)
    try:
        await user_client.update_current_user_password(payload.new_password)
        # Clearing the profile flag is an auth-administration action.  Do it
        # only after Supabase Auth accepted the new password; a caller cannot
        # clear force_password_reset by directly patching their profile.
        await supabase.update_user_profile_force_reset(profile.id, False)
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to change password",
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.post(
    "/staff-users",
    response_model=CreateStaffAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute")
async def create_staff_account(
    request: Request,
    payload: CreateStaffAccountRequest,
    admin: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> CreateStaffAccountResponse:
    """Create village staff accounts through Supabase Auth Admin API."""
    _validate_email(payload.email)
    phone = _normalize_staff_phone(payload.phone)
    commune_id = admin.commune_id or _string_setting(
        settings,
        "bana_commune_id",
    ) or "ba_na"
    try:
        village_is_valid = await supabase.village_in_commune(
            str(payload.village_id),
            commune_id,
        )
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to validate village assignment",
        ) from exc
    if not village_is_valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Village assignment is outside the administrator commune",
        )
    temporary_password = generate_temporary_password()
    try:
        user_id = await supabase.create_auth_user(
            email=payload.email.strip(),
            password=temporary_password,
            display_name=payload.display_name.strip(),
            role=payload.role,
            phone=phone,
        )
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create Supabase Auth user",
        ) from exc

    try:
        profile = await supabase.create_user_profile(
            user_id=user_id,
            role=payload.role,
            village_id=str(payload.village_id),
            display_name=payload.display_name.strip(),
            phone=phone,
            force_password_reset=True,
            commune_id=commune_id,
        )
    except SupabaseAdminError as exc:
        try:
            await supabase.delete_auth_user(user_id)
        except SupabaseAdminError:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create user profile",
        ) from exc

    return CreateStaffAccountResponse(
        user_id=UUID(profile.id),
        role=payload.role,
        village_id=payload.village_id,
        force_password_reset=profile.force_password_reset,
        temporary_password=temporary_password,
    )

@router.post(
    "/officers/{user_id}/reset-password",
    response_model=ResetPasswordResponse,
)
async def reset_officer_password(
    user_id: UUID,
    admin: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    conn: Annotated[asyncpg.Connection, Depends(get_db)],
) -> ResetPasswordResponse:
    """Reset an officer's password and force them to change it on next login."""
    target_exists = await conn.fetchval(
        """
        SELECT EXISTS (
          SELECT 1
          FROM user_profiles target
          JOIN user_profiles actor ON actor.id = $2::uuid
          WHERE target.id = $1::uuid
            AND target.role IN ('can_bo_thon', 'to_cnscd')
            AND target.commune_id = actor.commune_id
        )
        """,
        user_id,
        admin.id,
    )
    if not target_exists:
        raise HTTPException(status_code=404, detail="Officer not found")
    temporary_password = generate_temporary_password()
    
    try:
        await supabase.update_auth_user_password(str(user_id), temporary_password)
        await supabase.update_user_profile_force_reset(str(user_id), True)
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to reset password",
        ) from exc
    await conn.execute(
        """
        INSERT INTO audit_log (
          action, table_name, record_id, user_id, details
        ) VALUES (
          'RESET_STAFF_PASSWORD',
          'user_profiles',
          $1::uuid,
          $2::uuid,
          jsonb_build_object('force_password_reset', true)
        )
        """,
        user_id,
        admin.id,
    )
        
    return ResetPasswordResponse(temporary_password=temporary_password)


@router.post(
    "/citizen/pending-updates",
    response_model=CitizenPendingUpdateResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def submit_citizen_pending_update(
    request: Request,
    payload: CitizenPendingUpdateRequest,
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> CitizenPendingUpdateResponse:
    """Insert one citizen proposal directly."""
    phone_error = validate_phone(payload.proposed_by_phone)
    if phone_error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=phone_error["message"],
        )

    ct_code = payload.ct_code.strip().upper()
    if ct_code not in {"CT01", "CT02", "CT09", "CT12", "CT13"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Citizens may propose updates only for public indicators",
        )
    value_errors = [
        error
        for error in validate_report({ct_code: payload.proposed_value})
        if error["ct_code"] == ct_code
    ]
    if value_errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=value_errors[0]["message"],
        )

    try:
        commune_id = quote(
            _string_setting(settings, "bana_commune_id") or "ba_na",
            safe="",
        )
        reports = await supabase._rest_request(
            "GET",
            (
                f"/rest/v1/reports?id=eq.{payload.report_id}"
                "&publication_status=eq.published"
                "&workflow_status=in.(approved,locked)"
                "&select=id,village_id,villages!inner(commune_id),"
                "report_periods!inner(commune_id)"
                f"&villages.commune_id=eq.{commune_id}"
                f"&report_periods.commune_id=eq.{commune_id}"
            ),
        )
        if not reports or str(reports[0].get("village_id")) != str(payload.village_id):
            raise HTTPException(status_code=404, detail="Published report not found")
        row = await supabase.insert_pending_update(
            report_id=str(payload.report_id),
            ct_code=ct_code,
            proposed_value=payload.proposed_value,
            submitter_name=payload.submitter_name,
            submitter_phone=payload.proposed_by_phone,
            submitter_household=payload.submitter_household,
            submitter_address=payload.submitter_address,
            submitter_relation=payload.submitter_relation,
            explanation=payload.explanation,
            consent_version="2026-07-13",
        )
    except HTTPException:
        raise
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create pending update",
        ) from exc

    return CitizenPendingUpdateResponse(
        id=UUID(str(row["id"])),
        report_id=UUID(str(row["report_id"])),
        ct_code=str(row["ct_code"]),
        proposed_value=int(row["proposed_value"]),
        status=str(row["status"]),
        tracking_code=str(row["tracking_code"]) if row.get("tracking_code") else None,
    )


@router.get("/citizen/pending-updates/{tracking_code}", response_model=CitizenProposalTrackingResponse)
@limiter.limit("10/minute")
async def get_citizen_pending_update_status(
    request: Request,
    tracking_code: str,
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> CitizenProposalTrackingResponse:
    """Look up a proposal using a high-entropy capability code, never returning PII."""
    code = tracking_code.strip().upper()
    if len(code) != 16 or not code.isalnum():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    try:
        commune_id = quote(
            _string_setting(settings, "bana_commune_id") or "ba_na",
            safe="",
        )
        rows = await supabase._rest_request(
            "GET",
            "/rest/v1/pending_updates?tracking_code=eq."
            f"{code}&select=tracking_code,status,ct_code,created_at,"
            "reports!inner(villages!inner(commune_id),"
            "report_periods!inner(commune_id))"
            f"&reports.villages.commune_id=eq.{commune_id}"
            f"&reports.report_periods.commune_id=eq.{commune_id}",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Proposal status is unavailable") from exc
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    row = rows[0]
    status_value = str(row["status"])
    messages = {
        "pending": "Kiến nghị đã được tiếp nhận và đang chờ đối chiếu.",
        "approved": "Kiến nghị đã được xử lý theo quy trình rà soát.",
        "rejected": "Kiến nghị đã được rà soát; vui lòng liên hệ UBND xã nếu cần làm rõ.",
    }
    return CitizenProposalTrackingResponse(
        tracking_code=str(row["tracking_code"]),
        status=status_value,
        ct_code=str(row["ct_code"]),
        submitted_at=str(row["created_at"]),
        message=messages.get(status_value, "Kiến nghị đang được xử lý."),
    )

@router.get("/officers", response_model=list[OfficerResponse])
async def list_officers(
    admin: Annotated[UserProfile, Depends(require_admin_xa)],
    conn: Annotated[asyncpg.Connection, Depends(get_db)]
) -> list[OfficerResponse]:
    query = """
        SELECT 
            p.id, 
            p.role, 
            p.village_id,
            COALESCE(p.display_name, u.raw_user_meta_data->>'display_name', '') as name,
            u.email,
            COALESCE(p.phone, u.phone) AS phone,
            p.is_active,
            u.last_sign_in_at::text as last_login
        FROM user_profiles p
        LEFT JOIN auth.users u ON p.id = u.id
        JOIN user_profiles actor ON actor.id = $1::uuid
        WHERE p.role IN ('can_bo_thon', 'to_cnscd')
          AND p.commune_id = actor.commune_id
    """
    rows = await conn.fetch(query, admin.id)
    return [
        OfficerResponse(
            id=str(r["id"]),
            name=str(r["name"] or ""),
            email=r["email"] if r["email"] else None,
            phone=r["phone"] if r["phone"] else None,
            role=str(r["role"]),
            village_id=str(r["village_id"]) if r["village_id"] else None,
            is_active=bool(r["is_active"]),
            last_login=r["last_login"]
        )
        for r in rows
    ]

@router.post("/officers/{id}/toggle-active")
async def toggle_active_officer(
    id: UUID,
    admin: Annotated[UserProfile, Depends(require_admin_xa)],
    conn: Annotated[asyncpg.Connection, Depends(get_db)]
):
    query = """
        SELECT target.is_active
        FROM user_profiles target
        JOIN user_profiles actor ON actor.id = $2::uuid
        WHERE target.id = $1::uuid
          AND target.role IN ('can_bo_thon', 'to_cnscd')
          AND target.commune_id = actor.commune_id
    """
    row = await conn.fetchrow(query, id, admin.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
        
    current_active = bool(row["is_active"])
    new_active = not current_active
    
    await conn.execute(
        "UPDATE user_profiles SET is_active = $1 WHERE id = $2::uuid",
        new_active,
        id,
    )
    
    await conn.execute(
        "INSERT INTO audit_log (action, table_name, record_id, user_id, details) VALUES ($1, $2, $3, $4, $5)",
        "TOGGLE_ACTIVE", "user_profiles", id, admin.id, f'{{"is_active": {str(new_active).lower()}}}'
    )
    return {"status": "ok", "is_active": new_active}

@router.get("/proposals", response_model=list[ProposalResponse])
async def list_proposals(
    user: Annotated[UserProfile, Depends(require_authenticated_user)],
    conn: Annotated[asyncpg.Connection, Depends(get_rls_read_db)],
    village_id: str | None = None
) -> list[ProposalResponse]:
    query = """
      SELECT id, report_id,
             (SELECT report.village_id::text FROM reports AS report WHERE report.id = pending_updates.report_id) AS village_id,
             ct_code, proposed_value, proposed_by, status, reviewed_by,
             reviewed_at::text, created_at::text,
             (
               SELECT (audit.details ->> 'previous_value')::integer
               FROM audit_log AS audit
               WHERE audit.table_name = 'pending_updates'
                 AND audit.record_id = pending_updates.id
                 AND audit.action IN ('PROPOSAL_APPROVE', 'PROPOSAL_REJECT')
               ORDER BY audit.created_at DESC
               LIMIT 1
             ) AS previous_value,
             (created_at + interval '72 hours')::text AS sla_due_at,
             CASE
               WHEN status <> 'pending' THEN 'closed'
               WHEN created_at + interval '72 hours' < now() THEN 'overdue'
               ELSE 'on_track'
             END AS sla_status
      FROM pending_updates
    """
    args: list[object] = []
    if user.role in {"admin_xa", "lanh_dao"} and village_id:
        query += " WHERE report_id IN (SELECT id FROM reports WHERE village_id = $1)"
        args.append(village_id)
    elif user.role == "can_bo_thon":
        if not user.village_id:
            return []
        query += " WHERE report_id IN (SELECT id FROM reports WHERE village_id = $1::uuid)"
        args.append(user.village_id)
    elif user.role == "to_cnscd":
        query += """
          WHERE report_id IN (
            SELECT report.id
            FROM reports report
            WHERE report.village_id IN (
              SELECT profile.village_id
              FROM user_profiles profile
              WHERE profile.id = $1::uuid AND profile.village_id IS NOT NULL
              UNION
              SELECT assignment.village_id
              FROM user_village_assignments assignment
              WHERE assignment.user_id = $1::uuid
            )
          )
        """
        args.append(user.id)
    elif user.role not in {"admin_xa", "lanh_dao"}:
        return []
        
    rows = await conn.fetch(query, *args)
    return [
        ProposalResponse(
            id=str(r["id"]),
            report_id=str(r["report_id"]),
            village_id=str(r["village_id"]),
            ct_code=str(r["ct_code"]),
            proposed_value=int(r["proposed_value"]),
            previous_value=int(r["previous_value"]) if r["previous_value"] is not None else None,
            proposed_by=r["proposed_by"],
            status=str(r["status"]),
            reviewed_by=str(r["reviewed_by"]) if r["reviewed_by"] else None,
            reviewed_at=r["reviewed_at"],
            created_at=r["created_at"],
            sla_due_at=r["sla_due_at"],
            sla_status=r["sla_status"],
        ) for r in rows
    ]

@router.get("/report-values", response_model=list[ReportValueResponse])
async def list_report_values(
    user: Annotated[UserProfile, Depends(require_authenticated_user)],
    conn: Annotated[asyncpg.Connection, Depends(get_rls_read_db)],
    village_id: str | None = None
) -> list[ReportValueResponse]:
    query = "SELECT report_id, ct_code, value, note FROM report_values"
    args: list[object] = []
    if user.role in {"admin_xa", "lanh_dao"} and village_id:
        query += " WHERE report_id IN (SELECT id FROM reports WHERE village_id = $1)"
        args.append(village_id)
    elif user.role == "can_bo_thon":
        if not user.village_id:
            return []
        query += " WHERE report_id IN (SELECT id FROM reports WHERE village_id = $1::uuid)"
        args.append(user.village_id)
    elif user.role == "to_cnscd":
        query += """
          WHERE report_id IN (
            SELECT report.id
            FROM reports report
            WHERE report.village_id IN (
              SELECT profile.village_id
              FROM user_profiles profile
              WHERE profile.id = $1::uuid AND profile.village_id IS NOT NULL
              UNION
              SELECT assignment.village_id
              FROM user_village_assignments assignment
              WHERE assignment.user_id = $1::uuid
            )
          )
        """
        args.append(user.id)
    elif user.role not in {"admin_xa", "lanh_dao"}:
        return []
        
    rows = await conn.fetch(query, *args)
    return [
        ReportValueResponse(
            report_id=str(r["report_id"]),
            ct_code=str(r["ct_code"]),
            value=int(r["value"]),
            note=r["note"]
        ) for r in rows
    ]

@router.get("/audit-logs", response_model=list[AuditLogResponse])
async def list_audit_logs(
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    conn: Annotated[asyncpg.Connection, Depends(get_rls_read_db)]
) -> list[AuditLogResponse]:
    query = "SELECT id, action, table_name, record_id, user_id, details::text, created_at::text FROM audit_log ORDER BY created_at DESC LIMIT 100"
    rows = await conn.fetch(query)
    return [
        AuditLogResponse(
            id=r["id"],
            action=str(r["action"]),
            table_name=str(r["table_name"]),
            record_id=str(r["record_id"]),
            user_id=str(r["user_id"]) if r["user_id"] else None,
            details=r["details"],
            created_at=r["created_at"]
        ) for r in rows
    ]

@router.post("/proposals/{proposal_id}/action")
async def action_proposal(
    proposal_id: UUID,
    payload: ProposalActionRequest,
    user: Annotated[UserProfile, Depends(require_admin_xa)]
):
    try:
        return await execute_proposal_action(
            proposal_id,
            payload.action,
            UUID(user.id),
            payload.notes,
        )
    except ProposalValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "proposal_validation_failed",
                "message": "Giá trị đề xuất làm báo cáo không hợp lệ.",
                "details": [
                    {"ct_code": error["ct_code"], "code": error["error_type"]}
                    for error in exc.errors
                ],
            },
        ) from exc
    except ValueError as e:
        err_msg = str(e)
        if "not found" in err_msg.lower():
            raise HTTPException(status_code=404, detail="Proposal not found")
        if "not pending" in err_msg.lower() or "not eligible" in err_msg.lower():
            raise HTTPException(status_code=409, detail="Đề xuất này đã được xử lý trước đó.")
        raise HTTPException(status_code=400, detail="Proposal action is invalid") from e


def _extract_bearer_token(authorization: str | None) -> str:
    if authorization is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Expected Bearer token",
        )

    return token


def _validate_email(email: str) -> None:
    stripped_email = email.strip()
    if "@" not in stripped_email or stripped_email.startswith("@") or stripped_email.endswith("@"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email",
        )


def _validate_password_strength(password: str) -> None:
    classes = (
        any(char.islower() for char in password),
        any(char.isupper() for char in password),
        any(char.isdigit() for char in password),
        any(not char.isalnum() for char in password),
    )
    if not all(classes):
        raise HTTPException(
            status_code=422,
            detail="Password must include upper, lower, number, and symbol characters",
        )


def _normalize_staff_phone(phone: str | None) -> str | None:
    if phone is None:
        return None
    normalized = phone.strip()
    if normalized.startswith("+84"):
        normalized = "0" + normalized[3:]
    error = validate_phone(normalized)
    if error is not None:
        raise HTTPException(
            status_code=422,
            detail=error["message"],
        )
    return normalized


__all__ = ["router"]
