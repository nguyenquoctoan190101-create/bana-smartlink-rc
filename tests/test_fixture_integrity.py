from __future__ import annotations

import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
XLSX_ROOT = PROJECT_ROOT / "DU_LIEU_CHINH_THUC" / "DỮ LIỆU MẪU - BaNa Smartlink"
PDF_ROOT = PROJECT_ROOT / "tests" / "fixtures" / "pdfs"
VILLAGE_MAP = PROJECT_ROOT / "DU_LIEU_CHINH_THUC" / "village_merge_map_CHINH_THUC.json"


def test_official_fixture_packages_are_complete_and_non_empty() -> None:
    xlsx_files = sorted(XLSX_ROOT.rglob("*.xlsx"))
    pdf_files = sorted(PDF_ROOT.glob("*.pdf"))

    assert len(xlsx_files) == 21
    assert len(pdf_files) == 21
    assert all(path.stat().st_size > 1_000 for path in xlsx_files + pdf_files)
    assert all(path.read_bytes()[:4] == b"PK\x03\x04" for path in xlsx_files)
    assert all(path.read_bytes()[:4] == b"%PDF" for path in pdf_files)


def test_official_village_map_keeps_east_son_as_unresolved() -> None:
    mapping = json.loads(VILLAGE_MAP.read_text(encoding="utf-8"))

    assert len(mapping["villages_moi"]) == 10
    east_son = next(
        row for row in mapping["anh_xa_thon_cu"] if row["ten_thon_cu"] == "Thôn Đông Sơn"
    )
    assert east_son["new_village_id"] == "hoa_ninh"
    assert "CHUA CHAC CHAN" in east_son["ghi_chu"]

