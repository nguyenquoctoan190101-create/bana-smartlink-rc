from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, TypedDict

from services.excel_report_parser import parse_official_report_excel
from services.validator import BLOCKING_ERROR_TYPES, coerce_storage_value, validate_phone, validate_report
from services.village_mapper import MappingResolution, extract_village_name_from_filename, resolve_village_mapping


MAPPING_PATH = Path(__file__).resolve().parents[1] / "DU_LIEU_CHINH_THUC" / "village_merge_map_CHINH_THUC.json"
INDICATOR_CODES = tuple(f"CT{index:02d}" for index in range(1, 15))


class ImportFlag(TypedDict):
    ct_code: str
    error_type: str
    message: str


class ImportFilePreview(TypedDict):
    source_filename: str
    content_sha256: str
    size_bytes: int
    source_village_name: str
    mapping: MappingResolution
    metadata: dict[str, str | None]
    raw_values: dict[str, Any]
    normalized_values: dict[str, int | None]
    validation_flags: list[ImportFlag]
    has_blocking_errors: bool


class ImportBatchPreview(TypedDict):
    mapping_version: str
    expected_village_count: int
    uploaded_village_count: int
    missing_villages: list[str]
    unresolved_villages: list[str]
    duplicate_villages: list[str]
    files_with_blocking_errors: list[str]
    ready_for_review: bool
    files: list[ImportFilePreview]
    aggregate_preview: dict[str, dict[str, int | None]]


class TargetReadiness(TypedDict):
    target_village_id: str
    target_village_name: str
    eligible: bool
    missing_sources: list[str]
    rejected_sources: list[str]
    pending_sources: list[str]
    unresolved_sources: list[str]


def load_official_mapping() -> dict[str, Any]:
    payload = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Village mapping must be a JSON object")
    return payload


def preview_legacy_workbook(filename: str, content: bytes, mapping: dict[str, Any] | None = None) -> ImportFilePreview:
    mapping_data = mapping or load_official_mapping()
    parsed = parse_official_report_excel(content)
    filename_village = extract_village_name_from_filename(filename)
    source_village = parsed["metadata"].get("village_name") or filename_village
    if not source_village:
        source_village = "Không xác định"

    resolution = resolve_village_mapping(source_village, mapping_data)
    raw_values = {code: parsed["values"].get(code) for code in INDICATOR_CODES}
    normalized_values = {code: coerce_storage_value(raw_values[code]) for code in INDICATOR_CODES}
    flags: list[ImportFlag] = [dict(flag) for flag in validate_report(raw_values)]

    phone = parsed["metadata"].get("reporter_phone")
    if phone:
        phone_error = validate_phone(phone)
        if phone_error:
            flags.append(dict(phone_error))

    if filename_village and parsed["metadata"].get("village_name"):
        filename_resolution = resolve_village_mapping(filename_village, mapping_data)
        if filename_resolution["source_village_name"] != resolution["source_village_name"]:
            flags.append({
                "ct_code": "VILLAGE",
                "error_type": "METADATA_MISMATCH",
                "message": "Tên thôn trong tệp không khớp tên thôn trong biểu mẫu.",
            })

    if resolution["mapping_status"] != "confirmed":
        flags.append({
            "ct_code": "VILLAGE",
            "error_type": "MAPPING_BLOCKED",
            "message": resolution["note"] or "Ánh xạ thôn chưa được xác nhận.",
        })

    blocking_types = set(BLOCKING_ERROR_TYPES) | {"METADATA_MISMATCH", "MAPPING_BLOCKED"}
    return {
        "source_filename": filename,
        "content_sha256": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
        "source_village_name": resolution["source_village_name"] if resolution["mapping_status"] != "unmapped" else source_village,
        "mapping": resolution,
        "metadata": parsed["metadata"],
        "raw_values": raw_values,
        "normalized_values": normalized_values,
        "validation_flags": flags,
        "has_blocking_errors": any(flag["error_type"] in blocking_types for flag in flags),
    }


def build_batch_preview(files: list[ImportFilePreview], mapping: dict[str, Any] | None = None) -> ImportBatchPreview:
    mapping_data = mapping or load_official_mapping()
    meta = mapping_data.get("_meta", {})
    mapping_version = str(meta.get("mapping_version") or "unversioned") if isinstance(meta, dict) else "unversioned"
    entries = mapping_data.get("anh_xa_thon_cu", [])
    expected_names = [
        str(item["ten_thon_cu"])
        for item in entries
        if isinstance(item, dict) and item.get("legacy_unit_type", "village") == "village"
    ]
    uploaded_names = [item["source_village_name"] for item in files]
    duplicate_names = sorted({name for name in uploaded_names if uploaded_names.count(name) > 1})
    missing_names = [name for name in expected_names if name not in set(uploaded_names)]
    unresolved = sorted({
        item["source_village_name"]
        for item in files
        if item["mapping"]["mapping_status"] != "confirmed"
    })
    blocking_files = sorted(item["source_filename"] for item in files if item["has_blocking_errors"])
    # Missing, invalid, and unresolved source files are expected review findings,
    # not a reason to prevent creation of a review batch. Duplicates are the one
    # ambiguity that must be resolved before evidence can be stored.
    ready = bool(files) and not duplicate_names
    return {
        "mapping_version": mapping_version,
        "expected_village_count": len(expected_names),
        "uploaded_village_count": len(set(uploaded_names)),
        "missing_villages": missing_names,
        "unresolved_villages": unresolved,
        "duplicate_villages": duplicate_names,
        "files_with_blocking_errors": blocking_files,
        "ready_for_review": ready,
        "files": files,
        "aggregate_preview": aggregate_by_target(files),
    }


def assess_target_readiness(
    files: list[dict[str, Any]], mapping: dict[str, Any] | None = None
) -> list[TargetReadiness]:
    """Explain which current-village reports can be safely materialized.

    Every legacy village required by a target must have one accepted, confirmed
    file. A target is also blocked while any legacy boundary merely proposes it
    (currently the north-Dong-Son split). Resettlement areas are deliberately
    excluded from the 22-village reporting baseline.
    """
    mapping_data = mapping or load_official_mapping()
    entries = [
        item for item in mapping_data.get("anh_xa_thon_cu", [])
        if isinstance(item, dict) and item.get("legacy_unit_type", "village") == "village"
    ]
    target_names = {
        str(item.get("id")): str(item.get("ten"))
        for item in mapping_data.get("villages_moi", [])
        if isinstance(item, dict) and item.get("id") and item.get("ten")
    }
    files_by_name = {str(item.get("source_village_name")): item for item in files}
    results: list[TargetReadiness] = []
    for target_id, target_name in target_names.items():
        required = [item for item in entries if item.get("new_village_id") == target_id]
        proposed = [item for item in entries if item.get("proposed_new_village_id") == target_id]
        missing: list[str] = []
        rejected: list[str] = []
        pending: list[str] = []
        unresolved: list[str] = [str(item["ten_thon_cu"]) for item in proposed]
        for source in required:
            source_name = str(source["ten_thon_cu"])
            stored = files_by_name.get(source_name)
            if stored is None:
                missing.append(source_name)
            elif stored.get("review_status") == "rejected":
                rejected.append(source_name)
            elif stored.get("review_status") != "accepted":
                pending.append(source_name)
            elif stored.get("mapping_status") != "confirmed" or not stored.get("target_village_id"):
                unresolved.append(source_name)
        results.append({
            "target_village_id": target_id,
            "target_village_name": target_name,
            "eligible": bool(required) and not missing and not rejected and not pending and not unresolved,
            "missing_sources": missing,
            "rejected_sources": rejected,
            "pending_sources": pending,
            "unresolved_sources": sorted(set(unresolved)),
        })
    return results


def aggregate_by_target(files: list[ImportFilePreview]) -> dict[str, dict[str, int | None]]:
    """Create a non-authoritative preview; one missing input keeps that CT missing."""
    grouped: dict[str, list[ImportFilePreview]] = {}
    for item in files:
        target = item["mapping"]["target_village_id"]
        if item["mapping"]["mapping_status"] == "confirmed" and target:
            grouped.setdefault(target, []).append(item)

    result: dict[str, dict[str, int | None]] = {}
    for target, source_files in grouped.items():
        values: dict[str, int | None] = {}
        for code in INDICATOR_CODES:
            source_values = [source["normalized_values"].get(code) for source in source_files]
            values[code] = sum(value for value in source_values if value is not None) if all(value is not None for value in source_values) else None
        result[target] = values
    return result


__all__ = [
    "INDICATOR_CODES",
    "ImportBatchPreview",
    "ImportFilePreview",
    "aggregate_by_target",
    "assess_target_readiness",
    "build_batch_preview",
    "load_official_mapping",
    "preview_legacy_workbook",
]
