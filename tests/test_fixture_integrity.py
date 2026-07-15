from __future__ import annotations

import json
import hashlib
from pathlib import Path

from openpyxl import load_workbook


PROJECT_ROOT = Path(__file__).resolve().parents[1]
XLSX_ROOT = PROJECT_ROOT / "tests" / "fixtures" / "xlsx"
XLSX_MANIFEST = PROJECT_ROOT / "tests" / "fixtures" / "xlsx_manifest.json"
PDF_ROOT = PROJECT_ROOT / "tests" / "fixtures" / "pdfs"
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


def test_official_village_map_keeps_east_son_as_unresolved() -> None:
    mapping = json.loads(VILLAGE_MAP.read_text(encoding="utf-8"))

    assert len(mapping["villages_moi"]) == 10
    east_son = next(
        row for row in mapping["anh_xa_thon_cu"] if row["ten_thon_cu"] == "Thôn Đông Sơn"
    )
    assert east_son["new_village_id"] == "hoa_ninh"
    assert "CHUA CHAC CHAN" in east_son["ghi_chu"]
