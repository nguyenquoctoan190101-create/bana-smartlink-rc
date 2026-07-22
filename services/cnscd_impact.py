from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from services.supabase_admin import SupabaseAdminClient


@dataclass(frozen=True)
class VillageCnscdImpact:
    village_id: str
    village_name: str
    report_id: str | None
    assisted_report_count: int
    ct13_value: int | None
    difference: int | None
    absolute_difference: int | None


@dataclass(frozen=True)
class CnscdImpact:
    period_id: str
    period_name: str
    has_report_data: bool
    submitted_report_count: int
    assisted_report_count: int
    ct13_total: int | None
    difference: int | None
    absolute_difference: int | None
    missing_ct13_report_count: int
    villages: list[VillageCnscdImpact]
    interpretation: str


class CnscdImpactService:
    def __init__(self, supabase: SupabaseAdminClient) -> None:
        self._supabase = supabase

    async def calculate(self, period_id: str) -> CnscdImpact:
        """Compare actual CNSCD-assisted submissions with self-declared CT13."""
        period = await self._fetch_period(period_id)
        villages = await self._fetch_villages()
        reports = await self._fetch_reports(period_id)
        values_by_report = await self._fetch_ct13_values([str(report["id"]) for report in reports])

        reports_by_village = {str(report["village_id"]): report for report in reports}
        village_impacts: list[VillageCnscdImpact] = []
        for village in villages:
            village_id = str(village["id"])
            report = reports_by_village.get(village_id)
            report_id = str(report["id"]) if report is not None else None
            assisted_count = 1 if report is not None and bool(report.get("assisted_by_cnscd")) else 0
            ct13_value = values_by_report.get(report_id or "") if report_id is not None else None
            difference = ct13_value - assisted_count if ct13_value is not None else None
            village_impacts.append(
                VillageCnscdImpact(
                    village_id=village_id,
                    village_name=str(village["name"]),
                    report_id=report_id,
                    assisted_report_count=assisted_count,
                    ct13_value=ct13_value,
                    difference=difference,
                    absolute_difference=abs(difference) if difference is not None else None,
                )
            )

        assisted_report_count = sum(item.assisted_report_count for item in village_impacts)
        has_report_data = bool(reports)
        missing_ct13_report_count = sum(
            1 for item in village_impacts if item.report_id is not None and item.ct13_value is None
        )
        complete_ct13 = has_report_data and missing_ct13_report_count == 0
        ct13_total = (
            sum(item.ct13_value for item in village_impacts if item.ct13_value is not None)
            if complete_ct13 else None
        )
        difference = ct13_total - assisted_report_count if ct13_total is not None else None
        if not has_report_data:
            interpretation = (
                f"Kỳ {period['name']}: chưa có báo cáo nào được nộp; "
                "chưa thể đối chiếu số lượt hỗ trợ nhập hộ với CT13."
            )
        else:
            interpretation = (
                f"Kỳ {period['name']}: Tổ CNSCĐ hỗ trợ nhập hộ {assisted_report_count} báo cáo; "
                + (
                    f"CT13 do thôn tự khai là {ct13_total} người; chênh lệch {abs(difference or 0)}."
                    if complete_ct13
                    else f"chưa thể tính tổng CT13 vì {missing_ct13_report_count} báo cáo thiếu dữ liệu."
                )
            )
        return CnscdImpact(
            period_id=period_id,
            period_name=str(period["name"]),
            has_report_data=has_report_data,
            submitted_report_count=len(reports),
            assisted_report_count=assisted_report_count,
            ct13_total=ct13_total,
            difference=difference,
            absolute_difference=abs(difference) if difference is not None else None,
            missing_ct13_report_count=missing_ct13_report_count,
            villages=village_impacts,
            interpretation=interpretation,
        )

    async def _fetch_period(self, period_id: str) -> dict[str, Any]:
        encoded_period_id = quote(period_id, safe="")
        rows = await self._supabase._rest_request(
            "GET",
            f"/rest/v1/report_periods?id=eq.{encoded_period_id}&select=id,name",
        )
        if not rows:
            raise CnscdImpactError("Report period not found")

        return rows[0]

    async def _fetch_villages(self) -> list[dict[str, Any]]:
        return await self._supabase._rest_request(
            "GET",
            "/rest/v1/villages?select=id,name&order=name.asc",
        )

    async def _fetch_reports(self, period_id: str) -> list[dict[str, Any]]:
        encoded_period_id = quote(period_id, safe="")
        return await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/reports"
                f"?period_id=eq.{encoded_period_id}"
                "&select=id,village_id,assisted_by_cnscd"
            ),
        )

    async def _fetch_ct13_values(self, report_ids: list[str]) -> dict[str, int | None]:
        if not report_ids:
            return {}

        quoted_ids = ",".join(quote(report_id, safe="") for report_id in report_ids)
        rows = await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/report_values"
                f"?report_id=in.({quoted_ids})"
                "&ct_code=eq.CT13"
                "&select=report_id,value"
            ),
        )
        return {str(row["report_id"]): _int_or_none(row.get("value")) for row in rows}


class CnscdImpactError(RuntimeError):
    """Raised when CNSCD impact data cannot be calculated."""


def _int_or_none(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


__all__ = [
    "CnscdImpact",
    "CnscdImpactError",
    "CnscdImpactService",
    "VillageCnscdImpact",
]
