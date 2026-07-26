from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict
from urllib.parse import quote

from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError


RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "validation_rules.json"


class TrendAlert(TypedDict):
    village_id: str
    village_name: str
    ct_code: str
    indicator_name: str
    prev_value: int
    curr_value: int
    change_pct: float  # e.g., +25.5 or -30.2


async def get_trend_alerts_async(
    supabase: SupabaseAdminClient,
    prev_period_id: str,
    curr_period_id: str,
) -> list[TrendAlert]:
    """Compare report values between two periods for all villages.

    Triggers an alert if deviation > threshold_pct (loaded from config).
    """
    # 1. Load rules & indicators metadata
    try:
        with RULES_PATH.open("r", encoding="utf-8") as fh:
            config = json.load(fh)
    except Exception:
        config = {}

    threshold = float(config.get("trend_alert_threshold_pct", 20))
    indicators = {
        item["code"]: item["name"]
        for item in config.get("indicators", [])
        if "code" in item and "name" in item
    }

    # 2. Fetch villages name map
    try:
        villages = await supabase._rest_request("GET", "/rest/v1/villages?select=id,name")
    except SupabaseAdminError as exc:
        raise RuntimeError("Failed to fetch villages for trend analysis.") from exc

    village_names = {str(v["id"]): str(v["name"]) for v in villages}

    # 3. Fetch reports for prev & curr periods
    encoded_prev = quote(prev_period_id, safe="")
    encoded_curr = quote(curr_period_id, safe="")

    try:
        prev_reports = await supabase._rest_request(
            "GET",
            f"/rest/v1/reports?period_id=eq.{encoded_prev}"
            "&workflow_status=in.(approved,locked)&select=id,village_id",
        )
        curr_reports = await supabase._rest_request(
            "GET",
            f"/rest/v1/reports?period_id=eq.{encoded_curr}"
            "&workflow_status=in.(approved,locked)&select=id,village_id",
        )
    except SupabaseAdminError as exc:
        raise RuntimeError("Failed to fetch reports for trend analysis.") from exc

    if not prev_reports or not curr_reports:
        return []

    # Map village_id -> report_id
    prev_report_map = {str(r["village_id"]): str(r["id"]) for r in prev_reports}
    curr_report_map = {str(r["village_id"]): str(r["id"]) for r in curr_reports}

    # Gather report IDs to fetch values
    prev_report_ids = list(prev_report_map.values())
    curr_report_ids = list(curr_report_map.values())

    # Helper to chunk or build in clause
    def to_in_query(ids: list[str]) -> str:
        return ",".join(f"{id_str}" for id_str in ids)

    # 4. Fetch values
    try:
        prev_vals_rows = await supabase._rest_request(
            "GET",
            f"/rest/v1/report_values?report_id=in.({to_in_query(prev_report_ids)})&select=report_id,ct_code,value",
        )
        curr_vals_rows = await supabase._rest_request(
            "GET",
            f"/rest/v1/report_values?report_id=in.({to_in_query(curr_report_ids)})&select=report_id,ct_code,value",
        )
    except SupabaseAdminError as exc:
        raise RuntimeError("Failed to fetch report values for trend analysis.") from exc

    # Map (report_id, ct_code) -> value
    prev_values: dict[tuple[str, str], int] = {}
    for row in prev_vals_rows:
        val = row.get("value")
        if val is not None:
            prev_values[(str(row["report_id"]), str(row["ct_code"]))] = int(val)

    curr_values: dict[tuple[str, str], int] = {}
    for row in curr_vals_rows:
        val = row.get("value")
        if val is not None:
            curr_values[(str(row["report_id"]), str(row["ct_code"]))] = int(val)

    # 5. Compare
    alerts: list[TrendAlert] = []
    # Loop over common villages
    common_village_ids = set(prev_report_map.keys()) & set(curr_report_map.keys())

    for village_id in sorted(common_village_ids):
        prev_rid = prev_report_map[village_id]
        curr_rid = curr_report_map[village_id]
        village_name = village_names.get(village_id, "Unknown Village")

        for ct_code, indicator_name in indicators.items():
            prev_val = prev_values.get((prev_rid, ct_code))
            curr_val = curr_values.get((curr_rid, ct_code))

            if prev_val is not None and curr_val is not None:
                if prev_val > 0:
                    change_pct = ((curr_val - prev_val) / prev_val) * 100
                    if abs(change_pct) > threshold:
                        alerts.append(
                            {
                                "village_id": village_id,
                                "village_name": village_name,
                                "ct_code": ct_code,
                                "indicator_name": indicator_name,
                                "prev_value": prev_val,
                                "curr_value": curr_val,
                                "change_pct": round(change_pct, 1),
                            }
                        )

    return alerts


__all__ = ["get_trend_alerts_async", "TrendAlert"]
