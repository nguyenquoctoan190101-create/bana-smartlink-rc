from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from services.trend_alert import get_trend_alerts_async


@pytest.mark.anyio
async def test_get_trend_alerts_async_no_reports() -> None:
    supabase = MagicMock()
    supabase._rest_request = AsyncMock(side_effect=[
        [{"id": "v1", "name": "Thon Phu Hoa 1"}],  # villages
        [],  # prev_reports
        []   # curr_reports
    ])
    alerts = await get_trend_alerts_async(supabase, "p1", "p2")
    assert alerts == []


@pytest.mark.anyio
async def test_get_trend_alerts_async_with_alerts() -> None:
    supabase = MagicMock()
    
    # Mock calls in order:
    # 1. villages
    # 2. prev_reports
    # 3. curr_reports
    # 4. prev_values
    # 5. curr_values
    supabase._rest_request = AsyncMock(side_effect=[
        # 1. villages
        [
            {"id": "v1", "name": "Thon Phu Hoa 1"},
            {"id": "v2", "name": "Thon Phu Hoa 2"}
        ],
        # 2. prev_reports
        [
            {"id": "r_prev_v1", "village_id": "v1"},
            {"id": "r_prev_v2", "village_id": "v2"}
        ],
        # 3. curr_reports
        [
            {"id": "r_curr_v1", "village_id": "v1"},
            {"id": "r_curr_v2", "village_id": "v2"}
        ],
        # 4. prev_values
        [
            {"report_id": "r_prev_v1", "ct_code": "CT01", "value": 100},
            {"report_id": "r_prev_v1", "ct_code": "CT02", "value": 400},
            {"report_id": "r_prev_v2", "ct_code": "CT01", "value": 200},
        ],
        # 5. curr_values
        [
            # v1 CT01: 100 -> 130 (+30% > 20%) -> Alert
            {"report_id": "r_curr_v1", "ct_code": "CT01", "value": 130},
            # v1 CT02: 400 -> 350 (-12.5% <= 20%) -> No Alert
            {"report_id": "r_curr_v1", "ct_code": "CT02", "value": 350},
            # v2 CT01: 200 -> 150 (-25% > 20%) -> Alert
            {"report_id": "r_curr_v2", "ct_code": "CT01", "value": 150},
        ]
    ])

    alerts = await get_trend_alerts_async(supabase, "prev_period", "curr_period")
    
    # We should have exactly 2 alerts:
    # - v1 CT01 (+30%)
    # - v2 CT01 (-25%)
    assert len(alerts) == 2
    
    alert1 = alerts[0]
    assert alert1["village_id"] == "v1"
    assert alert1["ct_code"] == "CT01"
    assert alert1["prev_value"] == 100
    assert alert1["curr_value"] == 130
    assert alert1["change_pct"] == 30.0
    
    alert2 = alerts[1]
    assert alert2["village_id"] == "v2"
    assert alert2["ct_code"] == "CT01"
    assert alert2["prev_value"] == 200
    assert alert2["curr_value"] == 150
    assert alert2["change_pct"] == -25.0
