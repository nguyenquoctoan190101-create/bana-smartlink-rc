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
    def __init__(
        self,
        supabase: SupabaseAdminClient,
        *,
        admin_supabase: SupabaseAdminClient | None = None,
    ) -> None:
        self._supabase = supabase
        self._admin_supabase = admin_supabase or supabase

    async def get_period_id_by_name(self, period_name: str) -> str | None:
        """Look up period_id by its exact name."""
        encoded_name = quote(period_name.strip(), safe="")
        rows = await self._supabase._rest_request(
            "GET",
            f"/rest/v1/report_periods?name=eq.{encoded_name}&select=id",
        )
        return str(rows[0]["id"]) if rows else None

    async def field_synonyms(self) -> dict[str, str]:
        """Load caller-scoped Excel field mappings through database RLS."""
        rows = await self._supabase._rest_request(
            "GET",
            "/rest/v1/field_synonyms?select=normalized_name,ct_code",
        )
        if not isinstance(rows, list):
            raise RuntimeError("Field synonym query returned an invalid result")

        synonyms: dict[str, str] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            normalized_name = row.get("normalized_name")
            ct_code = row.get("ct_code")
            if isinstance(normalized_name, str) and isinstance(ct_code, str):
                synonyms[normalized_name] = ct_code
        return synonyms

    async def confirm_field_synonym(
        self,
        original_name: str,
        normalized_name: str,
        ct_code: str,
    ) -> dict[str, str]:
        """Persist an admin-approved mapping atomically with database audit."""
        rows = await self._supabase._rest_request(
            "POST",
            "/rest/v1/rpc/confirm_field_synonym",
            {
                "p_original_name": original_name,
                "p_normalized_name": normalized_name,
                "p_ct_code": ct_code,
            },
        )
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise RuntimeError("Field synonym RPC returned no result")
        row = rows[0]
        return {
            "normalized_name": str(row["normalized_name"]),
            "original_name": str(row["original_name"]),
            "ct_code": str(row["ct_code"]),
        }

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
        extraction_corrections: list[dict[str, Any]] | None = None,
        extraction_metadata: dict[str, Any] | None = None,
        extraction_evidence: dict[str, Any] | None = None,
    ) -> SavedReport:
        """Atomically submit a report via the SECURITY INVOKER database RPC."""
        assisting_member = assisted_member_name.strip() if assisted_member_name else None
        _ = submitted_by_name, submitted_by_phone, notes
        imported = raw_source in {"excel", "photo_ocr"}
        if imported and (
            extraction_metadata is None
            or extraction_evidence is None
            or idempotency_key is None
        ):
            raise ValueError(
                "Imported reports require extraction evidence and an idempotency key"
            )
        if not imported and (
            extraction_metadata is not None
            or extraction_corrections
            or extraction_evidence is not None
        ):
            raise ValueError("Extraction review is only valid for imported reports")
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
        rpc_name = "save_manual_report_submission"
        if imported:
            rpc_name = "save_report_submission_with_extraction"
            await self._admin_supabase._rest_request(
                "POST",
                "/rest/v1/report_extraction_evidence",
                extraction_evidence,
                prefer="resolution=ignore-duplicates,return=minimal",
            )
            payload.update(
                {
                    "p_extraction_corrections": extraction_corrections or [],
                    "p_extraction_metadata": extraction_metadata,
                    "p_extraction_evidence_id": extraction_evidence["id"],
                }
            )
        report_rows = await self._supabase._rest_request(
            "POST",
            f"/rest/v1/rpc/{rpc_name}",
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
        """Return status only for villages assigned to the selected period."""
        encoded_period_id = quote(period_id, safe="")
        assignments = await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/report_period_villages"
                f"?period_id=eq.{encoded_period_id}"
                "&select=village_id"
            ),
        )
        assigned_village_ids = {str(row["village_id"]) for row in assignments}
        villages = await self._supabase._rest_request(
            "GET",
            "/rest/v1/villages?select=id,name&order=name.asc",
        )
        merge_rows = await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/village_merge_map"
                "?mapping_status=eq.confirmed"
                "&new_village_id=not.is.null"
                "&select=old_village_name,new_village_id"
            ),
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
            if village_id not in assigned_village_ids:
                continue
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
