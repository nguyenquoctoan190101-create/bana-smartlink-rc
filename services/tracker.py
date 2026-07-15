from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime
from typing import Any, Literal


SubmissionStatus = Literal["chua_nop", "dung_han", "tre_han"]


def get_submission_status(
    village_name: str,
    submitted_files: Mapping[str, Any] | Iterable[str],
    due_date: date | datetime | None = None,
    submitted_at: date | datetime | None = None,
) -> SubmissionStatus:
    """Return submission status for one village from the tracking list."""
    if not _has_submission(village_name, submitted_files):
        return "chua_nop"

    # Submitted reports are late only when both dates are known.
    if due_date is None or submitted_at is None:
        return "dung_han"

    return "dung_han" if _to_date(submitted_at) <= _to_date(due_date) else "tre_han"


def _has_submission(village_name: str, submitted_files: Mapping[str, Any] | Iterable[str]) -> bool:
    normalized_name = _normalize_name(village_name)

    if isinstance(submitted_files, Mapping):
        return bool(submitted_files.get(village_name)) or bool(submitted_files.get(normalized_name))

    return normalized_name in {_normalize_name(name) for name in submitted_files}


def _normalize_name(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def _to_date(value: date | datetime) -> date:
    if isinstance(value, datetime):
        return value.date()

    return value


__all__ = ["get_submission_status"]
