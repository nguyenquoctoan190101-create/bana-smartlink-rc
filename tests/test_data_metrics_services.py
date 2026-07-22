from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from services.cnscd_impact import CnscdImpactError, CnscdImpactService, _int_or_none
from services.policy_scorecard import (
    PolicyScorecardError,
    PolicyScorecardService,
    _household_count_for_period,
    _int_or_none as score_int_or_none,
    _note_has_autofill_marker,
)


@pytest.mark.asyncio
async def test_policy_scorecard_uses_lineage_and_historical_household_snapshot() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": "period/1", "name": "Tháng 7/2026", "due_date": "2026-07-31"}],
        [
            {"id": "r1", "village_id": "v1", "report_source": "manual"},
            {"id": "r2", "village_id": "v2", "report_source": "excel"},
        ],
        [
            {"report_id": "r1", "ct_code": "CT01", "value": 100, "note": None},
            {"report_id": "r1", "ct_code": "CT02", "value": 350, "note": "prefill from previous"},
            {"report_id": "r2", "ct_code": "CT01", "value": 200, "note": None},
        ],
        [
            {"id": "v1", "household_count": {"2026-06": 99, "2026-07": 100}},
            {"id": "v2", "household_count": {"2026-06": 200}},
        ],
    ])
    result = await PolicyScorecardService(supabase).calculate("period/1")
    assert result.electronic_profile_rate.numerator == 1
    assert result.electronic_profile_rate.denominator == 2
    assert result.electronic_profile_rate.percent == 50.0
    assert result.once_only_score.numerator == 3
    assert result.once_only_score.denominator == 28
    assert result.once_only_score.percent == 10.71
    assert "50%" in result.interpretation
    assert "period%2F1" in supabase._rest_request.await_args_list[0].args[1]


@pytest.mark.asyncio
async def test_policy_scorecard_empty_period_is_zero_not_missing_data_fabrication() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": "p1", "name": "Kỳ rỗng", "due_date": None}], [], []
    ])
    result = await PolicyScorecardService(supabase).calculate("p1")
    assert result.electronic_profile_rate.denominator == 0
    assert result.electronic_profile_rate.percent == 0.0
    assert result.once_only_score.denominator == 0


@pytest.mark.asyncio
async def test_policy_scorecard_missing_period_fails_closed() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(return_value=[])
    with pytest.raises(PolicyScorecardError, match="not found"):
        await PolicyScorecardService(supabase).calculate("missing")


def test_policy_scorecard_coercion_helpers_reject_boolean_and_bad_values() -> None:
    from datetime import date

    assert _note_has_autofill_marker("  Once-Only   previous value ") is True
    assert _note_has_autofill_marker(None) is False
    assert score_int_or_none(True) is None
    assert score_int_or_none("12") == 12
    assert score_int_or_none("mười") is None
    snapshots = {"2026-01": "100", "2026-06": 120, "2026-09": 130}
    assert _household_count_for_period(snapshots, date(2026, 7, 1)) == 120
    assert _household_count_for_period(snapshots, None) == 130
    assert _household_count_for_period({}, date(2026, 7, 1)) is None


@pytest.mark.asyncio
async def test_cnscd_impact_preserves_missing_ct13_instead_of_zero() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": "p1", "name": "Tháng 7/2026"}],
        [{"id": "v1", "name": "Thôn A"}, {"id": "v2", "name": "Thôn B"}],
        [
            {"id": "r1", "village_id": "v1", "assisted_by_cnscd": True},
            {"id": "r2", "village_id": "v2", "assisted_by_cnscd": False},
        ],
        [{"report_id": "r1", "value": 5}],
    ])
    result = await CnscdImpactService(supabase).calculate("p1")
    assert result.has_report_data is True
    assert result.submitted_report_count == 2
    assert result.assisted_report_count == 1
    assert result.missing_ct13_report_count == 1
    assert result.ct13_total is None
    assert result.difference is None
    assert result.villages[0].ct13_value == 5
    assert result.villages[0].difference == 4
    assert result.villages[1].ct13_value is None
    assert "thiếu dữ liệu" in result.interpretation


@pytest.mark.asyncio
async def test_cnscd_impact_complete_data_calculates_total_and_includes_unsubmitted_village() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": "p1", "name": "Kỳ đủ"}],
        [{"id": "v1", "name": "Thôn A"}, {"id": "v2", "name": "Thôn B"}],
        [{"id": "r1", "village_id": "v1", "assisted_by_cnscd": True}],
        [{"report_id": "r1", "value": "7"}],
    ])
    result = await CnscdImpactService(supabase).calculate("p1")
    assert result.has_report_data is True
    assert result.ct13_total == 7
    assert result.difference == 6
    assert result.absolute_difference == 6
    assert result.missing_ct13_report_count == 0
    assert result.villages[1].report_id is None
    assert result.villages[1].ct13_value is None


@pytest.mark.asyncio
async def test_cnscd_impact_no_reports_skips_value_request() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": "p1", "name": "Kỳ chưa nộp"}],
        [{"id": "v1", "name": "Thôn A"}],
        [],
    ])
    result = await CnscdImpactService(supabase).calculate("p1")
    assert result.has_report_data is False
    assert result.submitted_report_count == 0
    assert result.ct13_total is None
    assert result.difference is None
    assert result.absolute_difference is None
    assert "chưa có báo cáo" in result.interpretation
    assert result.villages[0].ct13_value is None
    assert supabase._rest_request.await_count == 3


@pytest.mark.asyncio
async def test_cnscd_impact_missing_period_and_invalid_ct13_fail_safely() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(return_value=[])
    with pytest.raises(CnscdImpactError, match="not found"):
        await CnscdImpactService(supabase).calculate("missing")
    assert _int_or_none(None) is None
    assert _int_or_none(True) is None
    assert _int_or_none("bad") is None
    assert _int_or_none("9") == 9
