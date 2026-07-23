from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from routers.reports import CreateReportPeriodRequest


def make_request(name: str) -> CreateReportPeriodRequest:
    return CreateReportPeriodRequest(
        name=name,
        due_date=datetime(2027, 1, 31, tzinfo=UTC),
        village_ids=[uuid4()],
    )


@pytest.mark.parametrize(
    "name", ["0/2026", "13/2026", "Tháng 00/2026", "tháng 19 / 2026"]
)
def test_rejects_impossible_calendar_month(name: str) -> None:
    with pytest.raises(ValidationError, match="Tháng của kỳ báo cáo phải từ 1 đến 12"):
        make_request(name)


@pytest.mark.parametrize(
    "name",
    ["1/2027", "12/2026", "Tháng 07/2026", "Bản công bố minh họa — Tháng 7/2026"],
)
def test_accepts_valid_or_descriptive_period_name(name: str) -> None:
    assert make_request(name).name == name


def test_normalizes_period_name_whitespace() -> None:
    assert make_request("  Bản   công bố  tháng 7  ").name == "Bản công bố tháng 7"


def test_migration_relabels_legacy_invalid_periods_before_validating_constraint() -> None:
    sql = Path(
        "migrations/20260723_0019_report_period_name_guard.sql"
    ).read_text(encoding="utf-8")

    assert "Kỳ cần rà soát" in sql
    assert "tên cũ:" in sql
    assert "not between 1 and 12" in sql
    assert ") not valid" not in sql.lower()
