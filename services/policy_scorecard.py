from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.parse import quote

from services.supabase_admin import SupabaseAdminClient


TOTAL_CT_FIELDS = 14
AUTOFILL_NOTE_MARKERS = (
    "auto",
    "prefill",
    "once-only",
    "previous",
    "ky truoc",
    "kỳ trước",
    "tu dong",
    "tự động",
    "villages.household_count",
    "household_count",
)


@dataclass(frozen=True)
class ScoreMetric:
    numerator: int
    denominator: int
    percent: float


@dataclass(frozen=True)
class PolicyScorecard:
    period_id: str
    period_name: str
    electronic_profile_rate: ScoreMetric
    once_only_score: ScoreMetric
    interpretation: str


class PolicyScorecardService:
    def __init__(self, supabase: SupabaseAdminClient) -> None:
        self._supabase = supabase

    async def calculate(self, period_id: str) -> PolicyScorecard:
        """Calculate policy metrics from existing database rows only."""
        period = await self._fetch_period(period_id)
        reports = await self._fetch_reports(period_id)
        report_ids = [str(report["id"]) for report in reports]
        values_by_report = await self._fetch_values_by_report(report_ids)
        villages_by_id = await self._fetch_villages_by_id()

        submitted_report_count = len(reports)
        electronic_report_count = sum(
            1 for report in reports if report.get("report_source") in {"manual", "direct_api"}
        )
        electronic_rate = _metric(electronic_report_count, submitted_report_count)

        autofilled_count = 0
        total_fields = submitted_report_count * TOTAL_CT_FIELDS
        period_due_date = _parse_date(str(period["due_date"])) if period.get("due_date") else None
        for report in reports:
            village = villages_by_id.get(str(report["village_id"]), {})
            report_values = values_by_report.get(str(report["id"]), [])
            autofilled_count += _count_autofilled_fields(
                report_values=report_values,
                village=village,
                period_due_date=period_due_date,
            )

        once_only_score = _metric(autofilled_count, total_fields)
        interpretation = (
            f"Kỳ {period['name']}: {electronic_rate.percent:.0f}% báo cáo nộp điện tử, "
            f"điểm Once-Only {once_only_score.percent:.0f}%."
        )
        return PolicyScorecard(
            period_id=period_id,
            period_name=str(period["name"]),
            electronic_profile_rate=electronic_rate,
            once_only_score=once_only_score,
            interpretation=interpretation,
        )

    async def _fetch_period(self, period_id: str) -> dict[str, Any]:
        encoded_period_id = quote(period_id, safe="")
        rows = await self._supabase._rest_request(
            "GET",
            f"/rest/v1/report_periods?id=eq.{encoded_period_id}&select=id,name,due_date",
        )
        if not rows:
            raise PolicyScorecardError("Report period not found")

        return rows[0]

    async def _fetch_reports(self, period_id: str) -> list[dict[str, Any]]:
        encoded_period_id = quote(period_id, safe="")
        return await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/reports"
                f"?period_id=eq.{encoded_period_id}"
                "&timeliness_status=in.(on_time,late)"
                "&select=id,village_id,report_source"
            ),
        )

    async def _fetch_values_by_report(
        self,
        report_ids: list[str],
    ) -> dict[str, list[dict[str, Any]]]:
        if not report_ids:
            return {}

        quoted_ids = ",".join(quote(report_id, safe="") for report_id in report_ids)
        rows = await self._supabase._rest_request(
            "GET",
            (
                "/rest/v1/report_values"
                f"?report_id=in.({quoted_ids})"
                "&select=report_id,ct_code,value,note"
            ),
        )
        values_by_report: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            values_by_report.setdefault(str(row["report_id"]), []).append(row)

        return values_by_report

    async def _fetch_villages_by_id(self) -> dict[str, dict[str, Any]]:
        rows = await self._supabase._rest_request(
            "GET",
            "/rest/v1/villages?select=id,household_count",
        )
        return {str(row["id"]): row for row in rows}


class PolicyScorecardError(RuntimeError):
    """Raised when policy scorecard data cannot be calculated."""


def _count_autofilled_fields(
    report_values: list[dict[str, Any]],
    village: dict[str, Any],
    period_due_date: date | None,
) -> int:
    count = 0
    for row in report_values:
        ct_code = str(row["ct_code"])
        if _note_has_autofill_marker(row.get("note")):
            count += 1
            continue

        if ct_code == "CT01" and _matches_household_count(row.get("value"), village, period_due_date):
            count += 1

    return count


def _note_has_autofill_marker(note: Any) -> bool:
    if not isinstance(note, str):
        return False

    normalized_note = _normalize_text(note)
    return any(marker in normalized_note for marker in AUTOFILL_NOTE_MARKERS)


def _matches_household_count(
    value: Any,
    village: dict[str, Any],
    period_due_date: date | None,
) -> bool:
    value_int = _int_or_none(value)
    household_count = village.get("household_count")
    if value_int is None or not isinstance(household_count, dict):
        return False

    household_value = _household_count_for_period(household_count, period_due_date)
    return household_value is not None and value_int == household_value


def _household_count_for_period(
    household_count: dict[str, Any],
    period_due_date: date | None,
) -> int | None:
    if not household_count:
        return None

    target_key = period_due_date.strftime("%Y-%m") if period_due_date is not None else None
    if target_key is not None and target_key in household_count:
        return _int_or_none(household_count[target_key])

    sorted_keys = sorted(str(key) for key in household_count)
    if target_key is not None:
        previous_keys = [key for key in sorted_keys if key <= target_key]
        if previous_keys:
            return _int_or_none(household_count[previous_keys[-1]])

    return _int_or_none(household_count[sorted_keys[-1]])


def _metric(numerator: int, denominator: int) -> ScoreMetric:
    percent = 0.0 if denominator == 0 else round((numerator / denominator) * 100, 2)
    return ScoreMetric(numerator=numerator, denominator=denominator, percent=percent)


def _parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _int_or_none(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_text(value: str) -> str:
    normalized = value.casefold()
    return re.sub(r"\s+", " ", normalized).strip()


__all__ = [
    "PolicyScorecard",
    "PolicyScorecardError",
    "PolicyScorecardService",
    "ScoreMetric",
]
