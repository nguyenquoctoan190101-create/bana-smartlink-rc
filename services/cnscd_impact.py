from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import quote

from services.metric_registry import MetricRegistryError, load_metric_registry
from services.supabase_admin import SupabaseAdminClient


CnscdDataStatus = Literal[
    "not_submitted",
    "incomplete",
    "complete",
]
CnscdNextAction = Literal[
    "create_report",
    "complete_report",
    "record_assistance",
    "view_work_queue",
]


@dataclass(frozen=True)
class VillageCnscdImpact:
    village_id: str
    village_name: str
    report_id: str | None
    assisted_report_count: int
    ct02_value: int | None
    ct13_value: int | None
    guided_people_per_1000: float | None
    data_status: CnscdDataStatus
    next_action: CnscdNextAction


@dataclass(frozen=True)
class CnscdImpact:
    period_id: str
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
    villages: list[VillageCnscdImpact]
    interpretation: str


class CnscdImpactService:
    def __init__(self, supabase: SupabaseAdminClient) -> None:
        self._supabase = supabase

    async def calculate(
        self,
        period_id: str,
        *,
        village_ids: tuple[str, ...] | None = None,
        scope: Literal["commune", "assigned_villages"] = "commune",
    ) -> CnscdImpact:
        """Summarize CNSCD-assisted reports and CT13 as separate measures."""
        period = await self._fetch_period(period_id)
        villages = await self._fetch_villages(period_id, village_ids)
        scoped_village_ids = tuple(str(village["id"]) for village in villages)
        reports = await self._fetch_reports(period_id, scoped_village_ids)
        values_by_report = await self._fetch_indicator_values(
            [str(report["id"]) for report in reports]
        )
        try:
            registry = load_metric_registry()
        except MetricRegistryError as exc:
            raise CnscdImpactGovernanceError(
                "The metric registry is unavailable"
            ) from exc
        guided_metric = registry.get("guided_people_per_1000")
        if (
            guided_metric is None
            or guided_metric.status != "approved"
            or guided_metric.aggregation != "ratio_of_sums"
            or guided_metric.numerator != {"op": "field", "code": "CT13"}
            or guided_metric.denominator != {"op": "field", "code": "CT02"}
        ):
            raise CnscdImpactGovernanceError(
                "The guided_people_per_1000 metric is not governed"
            )

        reports_by_village = {str(report["village_id"]): report for report in reports}
        village_impacts: list[VillageCnscdImpact] = []
        for village in villages:
            village_id = str(village["id"])
            report = reports_by_village.get(village_id)
            report_id = str(report["id"]) if report is not None else None
            assisted_count = 1 if report is not None and bool(report.get("assisted_by_cnscd")) else 0
            values = values_by_report.get(report_id or "", {})
            ct02_value = values.get("CT02")
            ct13_value = values.get("CT13")
            guided_rate = _guided_rate(
                ct13_value,
                ct02_value,
                scale=guided_metric.scale,
            )
            if report is None:
                data_status: CnscdDataStatus = "not_submitted"
                next_action: CnscdNextAction = "create_report"
            elif guided_rate is None:
                data_status = "incomplete"
                next_action = "complete_report"
            elif assisted_count == 0:
                data_status = "complete"
                next_action = "record_assistance"
            else:
                data_status = "complete"
                next_action = "view_work_queue"
            village_impacts.append(
                VillageCnscdImpact(
                    village_id=village_id,
                    village_name=str(village["name"]),
                    report_id=report_id,
                    assisted_report_count=assisted_count,
                    ct02_value=ct02_value,
                    ct13_value=ct13_value,
                    guided_people_per_1000=guided_rate,
                    data_status=data_status,
                    next_action=next_action,
                )
            )

        assisted_report_count = sum(item.assisted_report_count for item in village_impacts)
        has_report_data = bool(reports)
        missing_ct02_report_count = sum(
            1
            for item in village_impacts
            if item.report_id is not None and item.ct02_value is None
        )
        missing_ct13_report_count = sum(
            1 for item in village_impacts if item.report_id is not None and item.ct13_value is None
        )
        zero_ct02_report_count = sum(
            1
            for item in village_impacts
            if item.report_id is not None and item.ct02_value == 0
        )
        complete_ct02 = (
            has_report_data and missing_ct02_report_count == 0
        )
        complete_ct13 = has_report_data and missing_ct13_report_count == 0
        ct02_total = (
            sum(
                item.ct02_value
                for item in village_impacts
                if item.ct02_value is not None
            )
            if complete_ct02
            else None
        )
        ct13_total = (
            sum(item.ct13_value for item in village_impacts if item.ct13_value is not None)
            if complete_ct13 else None
        )
        guided_people_per_1000 = _guided_rate(
            ct13_total,
            ct02_total,
            scale=guided_metric.scale,
        )
        if not has_report_data:
            interpretation = (
                f"Kỳ {period['name']}: chưa có báo cáo nào được nộp; "
                "chưa có dữ liệu hỗ trợ, CT02 hoặc CT13 để tổng hợp."
            )
        else:
            interpretation = (
                f"Kỳ {period['name']}: Tổ CNSCĐ tham gia lập {assisted_report_count} báo cáo; "
                + (
                    (
                        f"CT13 ghi nhận {ct13_total} người trên {ct02_total} dân, "
                        f"tương đương {guided_people_per_1000:.1f} người/1.000 dân/kỳ."
                    )
                    if guided_people_per_1000 is not None
                    else (
                        "chưa thể tính tỷ lệ trên 1.000 dân vì "
                        f"{missing_ct02_report_count} báo cáo thiếu CT02, "
                        f"{missing_ct13_report_count} báo cáo thiếu CT13 và "
                        f"{zero_ct02_report_count} báo cáo có CT02 bằng 0."
                    )
                )
            )
        return CnscdImpact(
            period_id=period_id,
            period_name=str(period["name"]),
            scope=scope,
            scope_village_count=len(villages),
            has_report_data=has_report_data,
            submitted_report_count=len(reports),
            assisted_report_count=assisted_report_count,
            ct02_total=ct02_total,
            ct13_total=ct13_total,
            guided_people_per_1000=guided_people_per_1000,
            metric_registry_version=registry.registry_version,
            metric_interpretation_limit=(
                guided_metric.interpretation_limit_vi
            ),
            missing_ct02_report_count=missing_ct02_report_count,
            missing_ct13_report_count=missing_ct13_report_count,
            zero_ct02_report_count=zero_ct02_report_count,
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

    async def _fetch_villages(
        self,
        period_id: str,
        village_ids: tuple[str, ...] | None,
    ) -> list[dict[str, Any]]:
        encoded_period_id = quote(period_id, safe="")
        assignments = await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/report_period_villages"
                f"?period_id=eq.{encoded_period_id}"
                "&select=village_id,villages(id,name)"
            ),
        )
        allowed = set(village_ids) if village_ids is not None else None
        villages: list[dict[str, Any]] = []
        for row in assignments:
            village = row.get("villages")
            if (
                isinstance(village, dict)
                and village.get("id") is not None
                and (
                    allowed is None
                    or str(village["id"]) in allowed
                )
            ):
                villages.append(village)
        return sorted(villages, key=lambda item: str(item.get("name", "")))

    async def _fetch_reports(
        self,
        period_id: str,
        village_ids: tuple[str, ...],
    ) -> list[dict[str, Any]]:
        if not village_ids:
            return []
        encoded_period_id = quote(period_id, safe="")
        encoded_village_ids = ",".join(
            quote(village_id, safe="") for village_id in village_ids
        )
        return await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/reports"
                f"?period_id=eq.{encoded_period_id}"
                f"&village_id=in.({encoded_village_ids})"
                "&timeliness_status=in.(on_time,late)"
                "&select=id,village_id,assisted_by_cnscd"
            ),
        )

    async def _fetch_indicator_values(
        self,
        report_ids: list[str],
    ) -> dict[str, dict[str, int | None]]:
        if not report_ids:
            return {}

        quoted_ids = ",".join(quote(report_id, safe="") for report_id in report_ids)
        rows = await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/report_values"
                f"?report_id=in.({quoted_ids})"
                "&ct_code=in.(CT02,CT13)"
                "&select=report_id,ct_code,value"
            ),
        )
        values: dict[str, dict[str, int | None]] = {}
        for row in rows:
            code = str(row.get("ct_code") or "")
            if code not in {"CT02", "CT13"}:
                continue
            values.setdefault(str(row["report_id"]), {})[code] = (
                _int_or_none(row.get("value"))
            )
        return values


class CnscdImpactError(RuntimeError):
    """Raised when CNSCD impact data cannot be calculated."""


class CnscdImpactGovernanceError(CnscdImpactError):
    """Raised when the required metric contract is unavailable."""


def _int_or_none(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _guided_rate(
    ct13_value: int | None,
    ct02_value: int | None,
    *,
    scale: int | float,
) -> float | None:
    if (
        ct13_value is None
        or ct02_value is None
        or ct02_value <= 0
    ):
        return None
    return (ct13_value / ct02_value) * float(scale)


__all__ = [
    "CnscdImpact",
    "CnscdImpactError",
    "CnscdImpactGovernanceError",
    "CnscdImpactService",
    "VillageCnscdImpact",
    "_guided_rate",
]
