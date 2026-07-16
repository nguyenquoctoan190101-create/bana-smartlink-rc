from __future__ import annotations

from pathlib import Path

from services.report_import import (
    assess_target_readiness,
    build_batch_preview,
    load_official_mapping,
    preview_legacy_workbook,
)


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "xlsx"


def _preview(name: str):
    path = FIXTURES / name
    return preview_legacy_workbook(path.name, path.read_bytes())


def test_legacy_preview_keeps_raw_invalid_value_and_blocks_it() -> None:
    preview = _preview("BC_T07_Thôn_Hòa_Khương_Tây.xlsx")

    assert preview["source_village_name"] == "Thôn Hòa Khương Tây"
    assert preview["mapping"]["target_village_id"] == "phuoc_khuong"
    assert preview["raw_values"]["CT07"] == "ba trăm"
    assert preview["normalized_values"]["CT07"] is None
    assert preview["has_blocking_errors"] is True


def test_dong_son_workbook_is_never_aggregated_automatically() -> None:
    preview = _preview("BC_T20_Thôn_Đông_Sơn.xlsx")
    batch = build_batch_preview([preview])

    assert preview["mapping"]["mapping_status"] == "pending_official_decision"
    assert preview["mapping"]["target_village_id"] is None
    assert "Thôn Đông Sơn" in batch["unresolved_villages"]
    assert "hoa_ninh" not in batch["aggregate_preview"]


def test_exact_fixture_set_reports_three_missing_villages_and_data_errors() -> None:
    mapping = load_official_mapping()
    files = [
        preview_legacy_workbook(path.name, path.read_bytes(), mapping)
        for path in sorted(FIXTURES.glob("BC_T*.xlsx"))
    ]
    batch = build_batch_preview(files, mapping)

    assert batch["expected_village_count"] == 22
    assert batch["uploaded_village_count"] == 19
    assert batch["missing_villages"] == ["Thôn Thạch Nham Tây", "Thôn Ninh An", "Thôn Sơn Phước"]
    assert batch["unresolved_villages"] == ["Thôn Đông Sơn"]
    assert batch["ready_for_review"] is True
    assert len(batch["files_with_blocking_errors"]) == 6
    truoc_dong = next(item for item in files if item["source_village_name"] == "Thôn Trước Đông")
    assert any(flag["error_type"] == "OUTLIER" for flag in truoc_dong["validation_flags"])


def test_clean_confirmed_files_are_summed_without_fabricating_missing_values() -> None:
    first = _preview("BC_T01_Thôn_Phú_Hòa_1.xlsx")
    second = _preview("BC_T02_Thôn_Phú_Hòa_2.xlsx")
    batch = build_batch_preview([first, second])

    expected = first["normalized_values"]["CT01"] + second["normalized_values"]["CT01"]  # type: ignore[operator]
    assert batch["aggregate_preview"]["phu_hoa"]["CT01"] == expected


def test_partial_review_only_marks_complete_target_groups_eligible() -> None:
    mapping = load_official_mapping()
    previews = [
        preview_legacy_workbook(path.name, path.read_bytes(), mapping)
        for path in sorted(FIXTURES.glob("BC_T*.xlsx"))
    ]
    stored = []
    for preview in previews:
        stored.append({
            "source_village_name": preview["source_village_name"],
            "mapping_status": preview["mapping"]["mapping_status"],
            "target_village_id": preview["mapping"]["target_village_id"],
            "review_status": "rejected"
            if preview["source_village_name"] == "Thôn Đông Sơn"
            else "accepted",
        })

    readiness = assess_target_readiness(stored, mapping)
    eligible = {item["target_village_id"] for item in readiness if item["eligible"]}

    assert eligible == {
        "thach_nham_dong", "phuoc_hung", "phu_hoa",
        "thai_lai", "phuoc_khuong", "an_son",
    }
    hoa_ninh = next(item for item in readiness if item["target_village_id"] == "hoa_ninh")
    assert hoa_ninh["unresolved_sources"] == ["Thôn Đông Sơn"]
