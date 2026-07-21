from __future__ import annotations

import json
import unicodedata
from io import BytesIO
from pathlib import Path
from typing import Any, TypedDict
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "validation_rules.json"
REPORT_SHEET_NAME = "Phiếu báo cáo"
FIRST_INDICATOR_ROW = 13


class ParsedExcelMetadata(TypedDict):
    period_name: str | None
    village_name: str | None
    reporter_name: str | None
    reporter_title: str | None
    reporter_phone: str | None
    deadline: str | None


class ParsedExcelReport(TypedDict):
    values: dict[str, Any]
    notes: dict[str, str | None]
    metadata: ParsedExcelMetadata


class ExcelReportParseError(RuntimeError):
    """Raised when the official Excel report template cannot be parsed."""


def parse_official_report_excel(file_bytes: bytes) -> ParsedExcelReport:
    """Parse the official thon Excel template into report values and notes."""
    expected_codes = _load_indicator_codes()
    try:
        workbook = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        raise ExcelReportParseError("Không đọc được file Excel.") from exc

    sheet_name = next(
        (name for name in workbook.sheetnames if _normalize_sheet_name(name) == _normalize_sheet_name(REPORT_SHEET_NAME)),
        None,
    )
    if sheet_name is None:
        raise ExcelReportParseError(f"Không tìm thấy sheet '{REPORT_SHEET_NAME}'.")

    worksheet = workbook[sheet_name]
    values: dict[str, Any] = {code: None for code in expected_codes}
    notes: dict[str, str | None] = {code: None for code in expected_codes}
    metadata: ParsedExcelMetadata = {
        "period_name": _clean_prefixed_text(worksheet["A5"].value, "Kỳ báo cáo:"),
        "village_name": _clean_text(worksheet["B7"].value),
        "reporter_name": _clean_text(worksheet["B8"].value),
        "reporter_title": _clean_text(worksheet["B9"].value),
        "reporter_phone": _clean_text(worksheet["B10"].value),
        "deadline": _clean_text(worksheet["B11"].value),
    }

    for row in worksheet.iter_rows(min_row=FIRST_INDICATOR_ROW):
        ct_code = _clean_code(row[0].value if len(row) > 0 else None)
        if ct_code not in expected_codes:
            continue

        values[ct_code] = row[3].value if len(row) > 3 else None
        notes[ct_code] = _clean_note(row[4].value if len(row) > 4 else None)

    return {"values": values, "notes": notes, "metadata": metadata}


def _normalize_sheet_name(value: Any) -> str:
    """Match the official sheet despite harmless whitespace/Unicode differences."""
    text = unicodedata.normalize("NFKC", str(value or ""))
    return " ".join(text.split()).casefold()


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


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _clean_prefixed_text(value: Any, prefix: str) -> str | None:
    text = _clean_text(value)
    if text is None:
        return None
    if text.casefold().startswith(prefix.casefold()):
        text = text[len(prefix):].strip()
    return text or None


__all__ = ["ExcelReportParseError", "parse_official_report_excel"]
