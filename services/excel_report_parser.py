from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any, TypedDict
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "validation_rules.json"
REPORT_SHEET_NAME = "Phiếu báo cáo"
FIRST_INDICATOR_ROW = 13


class ParsedExcelReport(TypedDict):
    values: dict[str, Any]
    notes: dict[str, str | None]


class ExcelReportParseError(RuntimeError):
    """Raised when the official Excel report template cannot be parsed."""


def parse_official_report_excel(file_bytes: bytes) -> ParsedExcelReport:
    """Parse the official thon Excel template into report values and notes."""
    expected_codes = _load_indicator_codes()
    try:
        workbook = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        raise ExcelReportParseError("Không đọc được file Excel.") from exc

    if REPORT_SHEET_NAME not in workbook.sheetnames:
        raise ExcelReportParseError(f"Không tìm thấy sheet '{REPORT_SHEET_NAME}'.")

    worksheet = workbook[REPORT_SHEET_NAME]
    values: dict[str, Any] = {code: None for code in expected_codes}
    notes: dict[str, str | None] = {code: None for code in expected_codes}

    for row in worksheet.iter_rows(min_row=FIRST_INDICATOR_ROW):
        ct_code = _clean_code(row[0].value if len(row) > 0 else None)
        if ct_code not in expected_codes:
            continue

        values[ct_code] = row[3].value if len(row) > 3 else None
        notes[ct_code] = _clean_note(row[4].value if len(row) > 4 else None)

    return {"values": values, "notes": notes}


def _load_indicator_codes() -> set[str]:
    with RULES_PATH.open("r", encoding="utf-8") as rules_file:
        payload = json.load(rules_file)

    indicators = payload.get("indicators", [])
    if not isinstance(indicators, list):
        raise ValueError("validation_rules.json must contain an indicators list")

    return {
        str(indicator["code"]).strip().upper()
        for indicator in indicators
        if isinstance(indicator, dict) and indicator.get("code")
    }


def _clean_code(value: Any) -> str:
    if value is None:
        return ""

    return str(value).strip().upper()


def _clean_note(value: Any) -> str | None:
    if value is None:
        return None

    note = str(value).strip()
    return note or None


__all__ = ["ExcelReportParseError", "parse_official_report_excel"]
