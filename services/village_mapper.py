from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Any, Literal, TypedDict, cast


MappingStatus = Literal["confirmed", "pending_official_decision", "unmapped"]


class MappingResolution(TypedDict):
    source_village_name: str
    target_village_id: str | None
    proposed_target_village_id: str | None
    mapping_status: MappingStatus
    mapping_version: str | None
    note: str | None
    legacy_unit_type: Literal["village", "resettlement_area"]


def _normalized_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = normalized.replace("–", "-").replace("—", "-")
    return " ".join(normalized.casefold().split())


def extract_village_name_from_filename(filename: str) -> str | None:
    """Extract the displayed village name without treating Txx as a domain key."""
    stem = Path(filename).stem
    match = re.match(r"^BC_T\d{2}_(.+)$", stem, flags=re.IGNORECASE)
    if not match:
        return None
    name = match.group(1).replace("_", " ").strip()
    return " ".join(name.split()) or None


def _mapping_version(mapping_data: dict[str, Any]) -> str | None:
    meta = mapping_data.get("_meta")
    if isinstance(meta, dict) and meta.get("mapping_version"):
        return str(meta["mapping_version"])
    value = mapping_data.get("mapping_version")
    return str(value) if value else None


def resolve_village_mapping(village_name: str, mapping_data: dict[str, Any]) -> MappingResolution:
    """Resolve one legacy village while failing closed for unresolved boundaries."""
    normalized = _normalized_name(village_name)
    version = _mapping_version(mapping_data)

    official_entries = mapping_data.get("anh_xa_thon_cu", [])
    frontend_entries = mapping_data.get("old_villages", [])
    entries = official_entries if isinstance(official_entries, list) and official_entries else frontend_entries

    for item in entries:
        if not isinstance(item, dict):
            continue
        item_name = item.get("ten_thon_cu", item.get("name"))
        if not item_name or _normalized_name(str(item_name)) != normalized:
            continue

        raw_status = str(item.get("mapping_status") or "confirmed")
        status = cast(
            MappingStatus,
            raw_status if raw_status in {"confirmed", "pending_official_decision"} else "unmapped",
        )
        raw_target = item.get("new_village_id", item.get("target_new_id"))
        raw_proposed = item.get("proposed_new_village_id", item.get("proposed_target_new_id"))
        target = str(raw_target) if raw_target else None
        proposed = str(raw_proposed) if raw_proposed else None
        if status != "confirmed":
            proposed = proposed or target
            target = None
        return {
            "source_village_name": str(item_name),
            "target_village_id": target,
            "proposed_target_village_id": proposed,
            "mapping_status": status,
            "mapping_version": version,
            "note": str(item.get("ghi_chu", item.get("source_note"))) if item.get("ghi_chu", item.get("source_note")) else None,
            "legacy_unit_type": "resettlement_area"
            if item.get("legacy_unit_type") == "resettlement_area"
            else "village",
        }

    return {
        "source_village_name": village_name,
        "target_village_id": None,
        "proposed_target_village_id": None,
        "mapping_status": "unmapped",
        "mapping_version": version,
        "note": "Không tìm thấy thôn trong phiên bản ánh xạ hiện hành.",
        "legacy_unit_type": "village",
    }


def map_report_file_to_village(filename: str, mapping_data: dict[str, Any]) -> str | None:
    """Return only confirmed targets; unresolved mappings deliberately return ``None``."""
    village_name = extract_village_name_from_filename(filename)
    if not village_name:
        return None
    return resolve_village_mapping(village_name, mapping_data)["target_village_id"]
