from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook

from services.excel_report_parser import parse_official_report_excel
from services.validator import validate_phone, validate_report


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORT_ROOT = (
    PROJECT_ROOT
    / "tests"
    / "fixtures"
    / "xlsx"
)


@pytest.mark.parametrize(
    ("filename", "ct_code", "error_type"),
    [
        ("BC_T04_Thôn_Phước_Thái.xlsx", "CT04", "BLANK"),
        ("BC_T07_Thôn_Hòa_Khương_Tây.xlsx", "CT07", "TEXT"),
        ("BC_T09_Thôn_Phước_Hưng.xlsx", "CT02", "SEP"),
        ("BC_T12_Thôn_Trước_Đông.xlsx", "CT02", "OUTLIER"),
        ("BC_T15_Thôn_Mỹ_Sơn.xlsx", "CT03", "LOGIC"),
        ("BC_T18_Thôn_Một.xlsx", "CT11", "LOGIC"),
    ],
)
def test_intentional_errors_are_detected_in_official_workbooks(
    filename: str,
    ct_code: str,
    error_type: str,
) -> None:
    parsed = parse_official_report_excel((REPORT_ROOT / filename).read_bytes())
    errors = validate_report(parsed["values"])

    assert any(
        error["ct_code"] == ct_code and error["error_type"] == error_type
        for error in errors
    ), errors


def test_bad_phone_is_detected_in_east_son_workbook() -> None:
    content = (REPORT_ROOT / "BC_T20_Thôn_Đông_Sơn.xlsx").read_bytes()
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    worksheet = workbook["Phiếu báo cáo"]

    assert validate_phone(worksheet["B10"].value) == {
        "ct_code": "PHONE",
        "error_type": "BADPHONE",
        "message": "Số điện thoại không hợp lệ.",
    }


def test_three_expected_missing_villages_have_no_report_file() -> None:
    filenames = "\n".join(path.name for path in REPORT_ROOT.glob("*.xlsx"))

    assert "Ninh_An" not in filenames
    assert "Sơn_Phước" not in filenames
    assert "Thạch_Nham_Tây" not in filenames
