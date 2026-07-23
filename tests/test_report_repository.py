from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest

from services.report_repository import (
    ReportRepository,
    _dashboard_color,
    _days_late,
    _safe_report_status,
)


@pytest.mark.asyncio
async def test_field_synonyms_are_loaded_from_scoped_rest_rows() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(
        return_value=[
            {"normalized_name": "tong so ho", "ct_code": "CT01"},
            {"normalized_name": "tong nhan khau", "ct_code": "CT02"},
        ]
    )

    result = await ReportRepository(supabase).field_synonyms()

    assert result == {"tong so ho": "CT01", "tong nhan khau": "CT02"}
    supabase._rest_request.assert_awaited_once_with(
        "GET",
        "/rest/v1/field_synonyms?select=normalized_name,ct_code",
    )


@pytest.mark.asyncio
async def test_confirm_field_synonym_uses_atomic_scoped_rpc() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(
        return_value=[
            {
                "original_name": "Tổng số hộ thực tế",
                "normalized_name": "tong so ho thuc te",
                "ct_code": "CT01",
            }
        ]
    )

    result = await ReportRepository(supabase).confirm_field_synonym(
        "Tổng số hộ thực tế",
        "tong so ho thuc te",
        "CT01",
    )

    assert result["ct_code"] == "CT01"
    supabase._rest_request.assert_awaited_once_with(
        "POST",
        "/rest/v1/rpc/confirm_field_synonym",
        {
            "p_original_name": "Tổng số hộ thực tế",
            "p_normalized_name": "tong so ho thuc te",
            "p_ct_code": "CT01",
        },
    )


@pytest.mark.asyncio
async def test_period_lookup_is_exact_and_url_encoded() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(side_effect=[[{"id": "p1"}], []])
    repository = ReportRepository(supabase)
    assert await repository.get_period_id_by_name(" Kỳ 7/2026 ") == "p1"
    assert "K%E1%BB%B3%207%2F2026" in supabase._rest_request.await_args_list[0].args[1]
    assert await repository.get_period_id_by_name("không có") is None


@pytest.mark.asyncio
async def test_save_report_uses_atomic_rpc_and_preserves_idempotency_contract() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(return_value=[{
        "report_id": "r1", "workflow_status": "submitted",
        "timeliness_status": "on_time", "version": 3, "replayed": True,
    }])
    repository = ReportRepository(supabase)
    result = await repository.save_report(
        village_id="v1", period_id="p1", submitted_by_name="Không gửi vào RPC",
        submitted_by_phone="0900000001", values={"CT01": 100},
        flags=[{"ct_code": "CT02", "error_type": "OUTLIER", "message": "Cần xem"}],
        raw_source="excel", assisted_by_cnscd=True, assisted_member_name="  Thành viên A  ",
        report_id="r1", expected_version=2, idempotency_key="idem-1",
    )
    assert result.id == "r1" and result.version == 3 and result.replayed is True
    assert result.status == "submitted"
    method, path, payload = supabase._rest_request.await_args.args
    assert method == "POST" and path == "/rest/v1/rpc/save_report_submission"
    assert payload["p_expected_version"] == 2
    assert payload["p_idempotency_key"] == "idem-1"
    assert payload["p_assisted_member_name"] == "Thành viên A"
    assert payload["p_flags"][0]["resolved"] is False
    assert "submitted_by_name" not in payload and "submitted_by_phone" not in payload


@pytest.mark.asyncio
async def test_save_report_empty_rpc_result_is_not_acknowledged() -> None:
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(return_value=[])
    with pytest.raises(RuntimeError, match="no result"):
        await ReportRepository(supabase).save_report(
            "v1", "p1", "A", "0900000001", {"CT01": 1}, [], "manual"
        )


@pytest.mark.asyncio
async def test_submission_statuses_use_only_confirmed_aliases_and_server_timeliness() -> None:
    due = date.today() - timedelta(days=5)
    submitted = (due + timedelta(days=2)).isoformat() + "T08:00:00+00:00"
    supabase = AsyncMock()
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": "v1", "name": "Thôn A"}, {"id": "v2", "name": "Thôn B"}],
        [{"old_village_name": "Thôn A cũ", "new_village_id": "v1"}],
        [{"id": "r1", "village_id": "v1", "timeliness_status": "late", "submitted_at": submitted}],
        [{"due_date": due.isoformat()}],
    ])
    statuses = await ReportRepository(supabase).submission_statuses("period/1")
    assert statuses[0].old_village_names == ["Thôn A cũ"]
    assert statuses[0].status == "late" and statuses[0].days_late == 2
    assert statuses[0].dashboard_color == "yellow"
    assert statuses[1].status == "not_submitted" and statuses[1].report_id is None
    alias_path = supabase._rest_request.await_args_list[1].args[1]
    assert "mapping_status=eq.confirmed" in alias_path
    assert "new_village_id=not.is.null" in alias_path


@pytest.mark.asyncio
async def test_submission_status_helper_and_invalid_db_status_fail_safe() -> None:
    supabase = AsyncMock()
    repository = ReportRepository(supabase)
    supabase._rest_request = AsyncMock(return_value=[])
    assert await repository._submission_status("missing") == "on_time"

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    supabase._rest_request = AsyncMock(return_value=[{"due_date": tomorrow}])
    assert await repository._submission_status("p1") == "on_time"

    assert _safe_report_status("unexpected") == "not_submitted"
    assert _dashboard_color("on_time") == "green"
    assert _dashboard_color("late") == "yellow"
    assert _dashboard_color("not_submitted") == "red"
    assert _days_late("on_time", date.today(), None) == 0
    assert _days_late("not_submitted", None, None) == 0
