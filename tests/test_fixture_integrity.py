from __future__ import annotations

import json
import hashlib
from pathlib import Path

from openpyxl import load_workbook


PROJECT_ROOT = Path(__file__).resolve().parents[1]
XLSX_ROOT = PROJECT_ROOT / "tests" / "fixtures" / "xlsx"
XLSX_MANIFEST = PROJECT_ROOT / "tests" / "fixtures" / "xlsx_manifest.json"
PDF_ROOT = PROJECT_ROOT / "tests" / "fixtures" / "pdfs"
PDF_MANIFEST = PROJECT_ROOT / "tests" / "fixtures" / "pdf_manifest.json"
VILLAGE_MAP = PROJECT_ROOT / "DU_LIEU_CHINH_THUC" / "village_merge_map_CHINH_THUC.json"


def test_official_fixture_packages_are_complete_and_non_empty() -> None:
    xlsx_files = sorted(XLSX_ROOT.glob("*.xlsx"))
    pdf_files = sorted(PDF_ROOT.glob("*.pdf"))

    assert len(xlsx_files) == 21
    assert len(pdf_files) == 21
    assert all(path.stat().st_size > 1_000 for path in xlsx_files + pdf_files)
    assert all(path.read_bytes()[:4] == b"PK\x03\x04" for path in xlsx_files)
    assert all(path.read_bytes()[:4] == b"%PDF" for path in pdf_files)


def test_xlsx_fixture_manifest_proves_synthetic_origin_and_integrity() -> None:
    manifest = json.loads(XLSX_MANIFEST.read_text(encoding="utf-8"))
    assert manifest["classification"] == "synthetic-test-data"
    assert manifest["contains_pii"] is False
    assert len(manifest["files"]) == 21

    for record in manifest["files"]:
        path = XLSX_ROOT / record["name"]
        assert path.stat().st_size == record["size"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == record["sha256"]
        workbook = load_workbook(path, read_only=True, data_only=True)
        assert workbook.properties.title == "DỮ LIỆU TỔNG HỢP - CHỈ DÙNG KIỂM THỬ"


def test_pdf_fixture_manifest_proves_synthetic_origin_and_integrity() -> None:
    manifest = json.loads(PDF_MANIFEST.read_text(encoding="utf-8"))
    assert manifest["classification"] == "synthetic-test-data"
    assert manifest["contains_pii"] is False
    assert manifest["official_record"] is False
    assert manifest["generator"] == "tests/generate_synthetic_pdf_fixtures.py"
    assert len(manifest["files"]) == 21

    for record in manifest["files"]:
        path = PDF_ROOT / record["name"]
        assert path.stat().st_size == record["size"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == record["sha256"]


def test_official_village_map_keeps_east_son_as_unresolved() -> None:
    mapping = json.loads(VILLAGE_MAP.read_text(encoding="utf-8"))

    assert len(mapping["villages_moi"]) == 10
    east_son = next(
        row for row in mapping["anh_xa_thon_cu"] if row["ten_thon_cu"] == "Thôn Đông Sơn"
    )
    assert east_son["new_village_id"] is None
    assert east_son["proposed_new_village_id"] == "hoa_ninh"
    assert east_son["mapping_status"] == "pending_official_decision"
    assert "khong duoc tu dong tong hop" in east_son["ghi_chu"].casefold()


def test_village_map_matches_infographic_household_plan_exactly() -> None:
    mapping = json.loads(VILLAGE_MAP.read_text(encoding="utf-8"))
    expected_households = {
        "thach_nham_dong": 553,
        "thach_nham_tay": 533,
        "phuoc_hung": 571,
        "phu_hoa": 899,
        "thai_lai": 546,
        "phuoc_khuong": 856,
        "hoa_nhon": 726,
        "son_phuoc": 672,
        "hoa_ninh": 911,
        "an_son": 300,
    }

    assert {
        row["id"]: row["quy_mo_ho_du_kien"] for row in mapping["villages_moi"]
    } == expected_households
    assert sum(expected_households.values()) == 6_567
    assert mapping["_meta"]["source_artifact_sha256"] == (
        "9d5533a78ca52c309047a8de283ffeb30710d0119bdae392153938bd4f47201c"
    )
    assert mapping["_meta"]["source_status"] == (
        "tai_lieu_phuong_an_chua_thay_the_quyet_dinh_hanh_chinh"
    )


def test_village_map_distinguishes_22_old_villages_from_two_resettlement_areas() -> None:
    mapping = json.loads(VILLAGE_MAP.read_text(encoding="utf-8"))
    legacy_rows = mapping["anh_xa_thon_cu"]
    resettlement_rows = [
        row for row in legacy_rows if row.get("legacy_unit_type") == "resettlement_area"
    ]

    assert len(legacy_rows) == 24
    assert len(resettlement_rows) == 2
    assert len(legacy_rows) - len(resettlement_rows) == 22
    assert {row["new_village_id"] for row in resettlement_rows} == {"an_son"}
    assert all(
        row.get("legacy_unit_type", "village") == "village"
        for row in legacy_rows
        if row not in resettlement_rows
    )
