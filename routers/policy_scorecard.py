from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from routers.auth import _extract_bearer_token, get_supabase_admin, require_admin_or_leader
from routers.reports import safe_resolve_period
from services.policy_scorecard import PolicyScorecardError, PolicyScorecardService
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile


router = APIRouter(tags=["policy-scorecard"])


class PolicyMetricResponse(BaseModel):
    numerator: int
    denominator: int
    percent: float


class PolicyScorecardResponse(BaseModel):
    period_id: UUID
    period_name: str
    electronic_profile_rate: PolicyMetricResponse
    once_only_score: PolicyMetricResponse
    interpretation: str


def get_policy_scorecard_service(
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> PolicyScorecardService:
    return PolicyScorecardService(supabase)


@router.get("/policy-scorecard", response_model=PolicyScorecardResponse)
async def get_policy_scorecard(
    period_id: str,
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> PolicyScorecardResponse:
    """Return policy scorecard metrics calculated from existing DB data."""
    service = PolicyScorecardService(
        supabase.as_user(_extract_bearer_token(authorization))
    )
    resolved_uuid, _ = await safe_resolve_period(service._supabase, period_id)
    try:
        scorecard = await service.calculate(str(resolved_uuid))
    except PolicyScorecardError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy kỳ báo cáo.",
        ) from exc
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không lấy được dữ liệu scorecard.",
        ) from exc

    return PolicyScorecardResponse(
        period_id=UUID(scorecard.period_id),
        period_name=scorecard.period_name,
        electronic_profile_rate=PolicyMetricResponse(
            numerator=scorecard.electronic_profile_rate.numerator,
            denominator=scorecard.electronic_profile_rate.denominator,
            percent=scorecard.electronic_profile_rate.percent,
        ),
        once_only_score=PolicyMetricResponse(
            numerator=scorecard.once_only_score.numerator,
            denominator=scorecard.once_only_score.denominator,
            percent=scorecard.once_only_score.percent,
        ),
        interpretation=scorecard.interpretation,
    )


__all__ = ["router"]
