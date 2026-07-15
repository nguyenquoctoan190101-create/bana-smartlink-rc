from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Literal
from urllib.parse import quote

from services.supabase_admin import SupabaseAdminClient
from services.validator import ValidationError


ReportSource = Literal["manual", "excel", "photo_ocr", "direct_api"]
ReportStatus = Literal["not_submitted", "on_time", "late"]


@dataclass(frozen=True)
class SavedReport:
    id: str
    village_id: str
    period_id: str
    workflow_status: str
    timeliness_status: str
    version: int
    replayed: bool = False

    @property
    def status(self) -> str:
        """Compatibility alias for clients migrating to workflow_status."""
        return self.workflow_status


@dataclass(frozen=True)
class VillageSubmissionStatus:
    village_id: str
    village_name: str
    old_village_names: list[str]
    report_id: str | None
    submitted_at: str | None
    due_date: str | None
    days_late: int
    status: ReportStatus
    dashboard_color: str


class ReportRepository:
    def __init__(self, supabase: SupabaseAdminClient) -> None:
        self._supabase = supabase

    async def get_period_id_by_name(self, period_name: str) -> str | None:
        """Look up period_id by its exact name."""
        encoded_name = quote(period_name.strip(), safe="")
        rows = await self._supabase._rest_request(
            "GET",
            f"/rest/v1/report_periods?name=eq.{encoded_name}&select=id",
        )
        return str(rows[0]["id"]) if rows else None

    async def save_report(
        self,
        village_id: str,
        period_id: str,
        submitted_by_name: str,
        submitted_by_phone: str,
        values: dict[str, int | None],
        flags: list[ValidationError],
        raw_source: ReportSource,
        notes: dict[str, str | None] | None = None,
        assisted_by_cnscd: bool = False,
        assisted_member_name: str | None = None,
        report_id: str | None = None,
        expected_version: int | None = None,
        idempotency_key: str | None = None,
    ) -> SavedReport:
        """Atomically submit a report via the SECURITY INVOKER database RPC."""
        assisting_member = assisted_member_name.strip() if assisted_member_name else None
        _ = submitted_by_name, submitted_by_phone, notes
        flag_rows = [
            {
                "ct_code": flag["ct_code"],
                "error_type": flag["error_type"],
                "message": flag["message"],
                "resolved": False,
            }
            for flag in flags
        ]
        payload: dict[str, Any] = {
            "p_report_id": report_id,
            "p_village_id": village_id,
            "p_period_id": period_id,
            "p_report_source": raw_source,
            "p_values": values,
            "p_flags": flag_rows,
            "p_expected_version": expected_version,
            "p_idempotency_key": idempotency_key,
            "p_submit": True,
            "p_assisted_by_cnscd": assisted_by_cnscd,
            "p_assisted_member_name": assisting_member if assisted_by_cnscd else None,
        }
        report_rows = await self._supabase._rest_request(
            "POST",
            "/rest/v1/rpc/save_report_submission",
            payload,
        )
        if not report_rows:
            raise RuntimeError("Report submission RPC returned no result")
        report = report_rows[0]
        return SavedReport(
            id=str(report["report_id"]),
            village_id=village_id,
            period_id=period_id,
            workflow_status=str(report["workflow_status"]),
            timeliness_status=str(report["timeliness_status"]),
            version=int(report["version"]),
            replayed=bool(report.get("replayed", False)),
        )

    async def submission_statuses(self, period_id: str) -> list[VillageSubmissionStatus]:
        """Return dashboard status for all current villages, using merge aliases."""
        encoded_period_id = quote(period_id, safe="")
        villages = await self._supabase._rest_request(
            "GET",
            "/rest/v1/villages?select=id,name&order=name.asc",
        )
        merge_rows = await self._supabase._rest_request(
            "GET",
            "/rest/v1/village_merge_map?select=old_village_name,new_village_id",
        )
        reports = await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/reports"
                f"?period_id=eq.{encoded_period_id}"
                "&select=id,village_id,workflow_status,timeliness_status,submitted_at"
            ),
        )
        period_rows = await self._supabase._rest_request(
            "GET",
            f"/rest/v1/report_periods?id=eq.{encoded_period_id}&select=due_date",
        )
        due_date = _parse_date(str(period_rows[0]["due_date"])) if period_rows else None

        aliases_by_village: dict[str, list[str]] = {}
        for row in merge_rows:
            new_village_id = str(row["new_village_id"])
            aliases_by_village.setdefault(new_village_id, []).append(str(row["old_village_name"]))

        reports_by_village = {str(row["village_id"]): row for row in reports}
        statuses: list[VillageSubmissionStatus] = []
        for village in villages:
            village_id = str(village["id"])
            report = reports_by_village.get(village_id)
            status_value = str(report["timeliness_status"]) if report is not None else "not_submitted"
            status = _safe_report_status(status_value)
            submitted_at = str(report["submitted_at"]) if report is not None else None
            statuses.append(
                VillageSubmissionStatus(
                    village_id=village_id,
                    village_name=str(village["name"]),
                    old_village_names=sorted(aliases_by_village.get(village_id, [])),
                    report_id=str(report["id"]) if report is not None else None,
                    submitted_at=submitted_at,
                    due_date=due_date.isoformat() if due_date is not None else None,
                    days_late=_days_late(status, due_date, submitted_at),
                    status=status,
                    dashboard_color=_dashboard_color(status),
                )
            )

        return statuses

    async def _submission_status(self, period_id: str) -> ReportStatus:
        encoded_period_id = quote(period_id, safe="")
        rows = await self._supabase._rest_request(
            "GET",
            f"/rest/v1/report_periods?id=eq.{encoded_period_id}&select=due_date",
        )
        if not rows:
            return "on_time"

        due_date = _parse_date(str(rows[0]["due_date"]))
        return "on_time" if date.today() <= due_date else "late"


def _parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _parse_datetime_date(value: str) -> date:
    normalized_value = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized_value).date()


def _days_late(status: ReportStatus, due_date: date | None, submitted_at: str | None) -> int:
    if due_date is None or status == "on_time":
        return 0

    comparison_date = date.today()
    if status == "late" and submitted_at is not None:
        comparison_date = _parse_datetime_date(submitted_at)

    return max(0, (comparison_date - due_date).days)


def _safe_report_status(value: str) -> ReportStatus:
    if value in {"not_submitted", "on_time", "late"}:
        return value  # type: ignore[return-value]

    return "not_submitted"


def _dashboard_color(status: ReportStatus) -> str:
    if status == "on_time":
        return "green"
    if status == "late":
        return "yellow"

    return "red"


__all__ = ["ReportRepository", "SavedReport", "VillageSubmissionStatus"]
