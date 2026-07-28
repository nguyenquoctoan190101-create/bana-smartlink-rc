from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from routers.auth import (
    _extract_bearer_token,
    get_supabase_admin,
    require_authenticated_user,
)
from routers.reports import safe_resolve_period
from services.cnscd_impact import (
    CnscdImpactError,
    CnscdImpactGovernanceError,
    CnscdImpactService,
)
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile


router = APIRouter(tags=["cnscd-impact"])


class VillageCnscdImpactResponse(BaseModel):
    village_id: UUID
    village_name: str
    report_id: UUID | None
    assisted_report_count: int
    ct02_value: int | None
    ct13_value: int | None
    guided_people_per_1000: float | None
    data_status: Literal["not_submitted", "incomplete", "complete"]
    next_action: Literal[
        "create_report",
        "complete_report",
        "record_assistance",
        "view_work_queue",
    ]


class CnscdImpactResponse(BaseModel):
    period_id: UUID
    period_name: str
    scope: Literal["commune", "assigned_villages"]
    scope_village_count: int
    has_report_data: bool
    submitted_report_count: int
    assisted_report_count: int
    ct02_total: int | None
    ct13_total: int | None
    guided_people_per_1000: float | None
    metric_registry_version: str
    metric_interpretation_limit: str
    missing_ct02_report_count: int
    missing_ct13_report_count: int
    zero_ct02_report_count: int
    villages: list[VillageCnscdImpactResponse]
    interpretation: str


def get_cnscd_impact_service(
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> CnscdImpactService:
    return CnscdImpactService(supabase)


@router.get("/cnscd-impact", response_model=CnscdImpactResponse)
async def get_cnscd_impact(
    period_id: str,
    profile: Annotated[
        UserProfile,
        Depends(require_authenticated_user),
    ],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> CnscdImpactResponse:
    """Summarize assisted reports and CT13 independently for a period."""
    if profile.role not in {"admin_xa", "lanh_dao", "to_cnscd"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Role cannot access CNSCĐ impact data",
        )
    caller = supabase.as_user(_extract_bearer_token(authorization))
    service = CnscdImpactService(caller)
    resolved_uuid, _ = await safe_resolve_period(service._supabase, period_id)
    try:
        village_ids: tuple[str, ...] | None = None
        scope: Literal["commune", "assigned_villages"] = "commune"
        if profile.role == "to_cnscd":
            assignments = await caller.list_user_village_ids(profile.id)
            if profile.village_id:
                assignments.append(profile.village_id)
            village_ids = tuple(sorted(set(assignments)))
            scope = "assigned_villages"
        impact = await service.calculate(
            str(resolved_uuid),
            village_ids=village_ids,
            scope=scope,
        )
    except CnscdImpactGovernanceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Thiếu hợp đồng chỉ số CT13 trên 1.000 dân.",
        ) from exc
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
        scope=impact.scope,
        scope_village_count=impact.scope_village_count,
        has_report_data=impact.has_report_data,
        submitted_report_count=impact.submitted_report_count,
        assisted_report_count=impact.assisted_report_count,
        ct02_total=impact.ct02_total,
        ct13_total=impact.ct13_total,
        guided_people_per_1000=impact.guided_people_per_1000,
        metric_registry_version=impact.metric_registry_version,
        metric_interpretation_limit=impact.metric_interpretation_limit,
        missing_ct02_report_count=impact.missing_ct02_report_count,
        missing_ct13_report_count=impact.missing_ct13_report_count,
        zero_ct02_report_count=impact.zero_ct02_report_count,
        villages=[
            VillageCnscdImpactResponse(
                village_id=UUID(item.village_id),
                village_name=item.village_name,
                report_id=UUID(item.report_id) if item.report_id is not None else None,
                assisted_report_count=item.assisted_report_count,
                ct02_value=item.ct02_value,
                ct13_value=item.ct13_value,
                guided_people_per_1000=item.guided_people_per_1000,
                data_status=item.data_status,
                next_action=item.next_action,
            )
            for item in impact.villages
        ],
        interpretation=impact.interpretation,
    )


__all__ = ["router"]
