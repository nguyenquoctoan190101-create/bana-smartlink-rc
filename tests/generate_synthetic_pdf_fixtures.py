"""Generate deterministic, PII-free PDF fixtures matching the XLSX fixture set."""

from __future__ import annotations

import hashlib
import json
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics


ROOT = Path(__file__).resolve().parent
XLSX_ROOT = ROOT / "fixtures" / "xlsx"
PDF_ROOT = ROOT / "fixtures" / "pdfs"
MANIFEST = ROOT / "fixtures" / "pdf_manifest.json"
FONT_PATH = Path("C:/Windows/Fonts/arial.ttf")


def _register_font() -> str:
    if FONT_PATH.exists():
        pdfmetrics.registerFont(TTFont("FixtureArial", str(FONT_PATH)))
        return "FixtureArial"
    return "Helvetica"


def _build_pdf(stem: str, fixture_number: int, font_name: str) -> bytes:
    output = BytesIO()
    document = canvas.Canvas(
        output,
        pagesize=A4,
        pageCompression=1,
        invariant=1,
    )
    document.setTitle("DU LIEU TONG HOP - CHI DUNG KIEM THU")
    document.setAuthor("Ba Na SmartLink automated fixture generator")
    width, height = A4

    document.setFillColor(colors.HexColor("#0B4A35"))
    document.rect(0, height - 92, width, 92, fill=1, stroke=0)
    document.setFillColor(colors.white)
    document.setFont(font_name, 15)
    document.drawString(40, height - 48, "BA NA SMARTLINK - BIEU MAU KIEM THU")
    document.setFont(font_name, 9)
    document.drawString(40, height - 68, "DU LIEU TONG HOP, KHONG CHUA THONG TIN CA NHAN")

    document.setFillColor(colors.HexColor("#7F1D1D"))
    document.setFont(font_name, 11)
    document.drawCentredString(
        width / 2,
        height - 122,
        "SYNTHETIC TEST FIXTURE - NOT AN OFFICIAL RECORD",
    )
    document.setFillColor(colors.black)
    document.setFont(font_name, 9)
    document.drawString(40, height - 148, f"Ma bo kiem thu: PDF-{fixture_number:02d}")
    document.drawString(40, height - 164, f"Ten tep tham chieu: {stem}.pdf")

    top = height - 205
    left = 40
    row_height = 27
    widths = (70, 325, 90)
    headers = ("Ma", "Chi tieu tong hop", "Gia tri")
    document.setFillColor(colors.HexColor("#DAAF37"))
    document.rect(left, top - row_height, sum(widths), row_height, fill=1, stroke=0)
    document.setFillColor(colors.HexColor("#102A22"))
    document.setFont(font_name, 9)
    cursor = left
    for header, column_width in zip(headers, widths, strict=True):
        document.drawString(cursor + 6, top - 18, header)
        cursor += column_width

    indicator_names = (
        "Tong so ho dan",
        "Tong so nhan khau",
        "So ho ngheo",
        "So ho can ngheo",
        "Nguoi co cong dang quan ly",
        "Doi tuong bao tro xa hoi",
        "Tre em duoi 16 tuoi",
        "Tre em co hoan canh dac biet",
        "Ho gia dinh van hoa",
        "Nguoi trong do tuoi lao dong",
        "Nguoi tham gia BHYT",
        "Thanh vien to cong nghe so",
        "Luot huong dan dich vu cong",
        "Vu bao luc gia dinh",
    )
    base = 100 + fixture_number
    values = (
        base,
        base * 4,
        5,
        7,
        3,
        4,
        base,
        2,
        base - 4,
        base * 2,
        base * 3,
        8,
        12,
        0,
    )
    for index, (label, value) in enumerate(
        zip(indicator_names, values, strict=True),
        start=1,
    ):
        y = top - (index + 1) * row_height
        if index % 2 == 0:
            document.setFillColor(colors.HexColor("#F1F5F3"))
            document.rect(left, y, sum(widths), row_height, fill=1, stroke=0)
        document.setFillColor(colors.black)
        document.setFont(font_name, 8)
        document.drawString(left + 6, y + 9, f"CT{index:02d}")
        document.drawString(left + widths[0] + 6, y + 9, label)
        document.drawRightString(left + sum(widths) - 8, y + 9, str(value))

    document.setStrokeColor(colors.HexColor("#94A3B8"))
    document.rect(
        left,
        top - 15 * row_height,
        sum(widths),
        15 * row_height,
        fill=0,
        stroke=1,
    )
    document.setFillColor(colors.HexColor("#475569"))
    document.setFont(font_name, 8)
    document.drawString(
        40,
        50,
        "Tao tu dong de kiem thu parser/hinh hoc. Khong dung cho nghiep vu hoac danh gia OCR.",
    )
    document.save()
    return output.getvalue()


def main() -> None:
    PDF_ROOT.mkdir(parents=True, exist_ok=True)
    font_name = _register_font()
    xlsx_files = sorted(XLSX_ROOT.glob("*.xlsx"))
    records: list[dict[str, object]] = []
    for index, workbook in enumerate(xlsx_files, start=1):
        output_path = PDF_ROOT / f"{workbook.stem}.pdf"
        content = _build_pdf(workbook.stem, index, font_name)
        output_path.write_bytes(content)
        records.append(
            {
                "name": output_path.name,
                "sha256": hashlib.sha256(content).hexdigest(),
                "size": len(content),
            }
        )

    expected = {f"{path.stem}.pdf" for path in xlsx_files}
    for stale in PDF_ROOT.glob("*.pdf"):
        if stale.name not in expected:
            stale.unlink()

    MANIFEST.write_text(
        json.dumps(
            {
                "version": 1,
                "classification": "synthetic-test-data",
                "contains_pii": False,
                "official_record": False,
                "generator": "tests/generate_synthetic_pdf_fixtures.py",
                "files": records,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
