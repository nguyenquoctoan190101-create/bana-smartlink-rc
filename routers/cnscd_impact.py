from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from routers.auth import get_supabase_admin, require_admin_or_leader
from routers.reports import safe_resolve_period
from services.cnscd_impact import CnscdImpactError, CnscdImpactService
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile


router = APIRouter(tags=["cnscd-impact"])


class VillageCnscdImpactResponse(BaseModel):
    village_id: UUID
    village_name: str
    report_id: UUID | None
    assisted_report_count: int
    ct13_value: int | None
    difference: int | None
    absolute_difference: int | None


class CnscdImpactResponse(BaseModel):
    period_id: UUID
    period_name: str
    submitted_report_count: int
    assisted_report_count: int
    ct13_total: int | None
    difference: int | None
    absolute_difference: int | None
    missing_ct13_report_count: int
    villages: list[VillageCnscdImpactResponse]
    interpretation: str


def get_cnscd_impact_service(
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> CnscdImpactService:
    return CnscdImpactService(supabase)


@router.get("/cnscd-impact", response_model=CnscdImpactResponse)
async def get_cnscd_impact(
    period_id: str,
    service: Annotated[CnscdImpactService, Depends(get_cnscd_impact_service)],
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
) -> CnscdImpactResponse:
    """Compare assisted submissions with self-declared CT13 for a period."""
    resolved_uuid, _ = await safe_resolve_period(service._supabase, period_id)
    try:
        impact = await service.calculate(str(resolved_uuid))
    except CnscdImpactError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy kỳ báo cáo.",
        ) from exc
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không lấy được dữ liệu tác động CNSCĐ.",
        ) from exc

    return CnscdImpactResponse(
        period_id=UUID(impact.period_id),
        period_name=impact.period_name,
        submitted_report_count=impact.submitted_report_count,
        assisted_report_count=impact.assisted_report_count,
        ct13_total=impact.ct13_total,
        difference=impact.difference,
        absolute_difference=impact.absolute_difference,
        missing_ct13_report_count=impact.missing_ct13_report_count,
        villages=[
            VillageCnscdImpactResponse(
                village_id=UUID(item.village_id),
                village_name=item.village_name,
                report_id=UUID(item.report_id) if item.report_id is not None else None,
                assisted_report_count=item.assisted_report_count,
                ct13_value=item.ct13_value,
                difference=item.difference,
                absolute_difference=item.absolute_difference,
            )
            for item in impact.villages
        ],
        interpretation=impact.interpretation,
    )


__all__ = ["router"]
