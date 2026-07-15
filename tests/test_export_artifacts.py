from __future__ import annotations

from io import BytesIO

import docx
import openpyxl

from routers.reports import generate_docx_file, generate_pdf_file, generate_preview_html
from services.export_service import generate_summary_xlsx_file, generate_village_xlsx_file


def _report() -> tuple[list[dict], dict[str, str]]:
    return (
        [
            {
                "village_id": "village-1",
                "workflow_status": "approved",
                "timeliness_status": "on_time",
                "submitted_at": "2026-07-13T10:00:00Z",
                "values": {
                    "CT01": 100,
                    "CT02": None,
                    "CT03": "=SUM(1,1)",
                    "CT14": 1,
                },
            }
        ],
        {"village-1": "<script>Village</script>"},
    )


def test_all_export_formats_keep_ct01_to_ct14_nulls_and_formula_safety() -> None:
    reports, villages = _report()
    period = "=Quarter 3/2026"

    summary = openpyxl.load_workbook(
        BytesIO(generate_summary_xlsx_file(period, reports, villages))
    )
    summary_sheet = summary["Bảng tổng hợp"]
    assert "CT14" in str(summary_sheet["P4"].value)
    assert summary_sheet["D5"].value is None  # CT02 is intentionally blank.
    assert summary_sheet["F6"].value in (None, "")  # CT04 total stays incomplete.
    assert summary_sheet["E5"].value == "'=SUM(1,1)"
    assert not str(summary_sheet["A2"].value).startswith("=")

    village = openpyxl.load_workbook(
        BytesIO(generate_village_xlsx_file(period, reports[0], villages["village-1"]))
    )
    village_sheet = village["Phiếu báo cáo"]
    assert village_sheet["D15"].value is None
    assert village_sheet["D16"].value == "'=SUM(1,1)"
    assert village_sheet["D27"].value == 1  # CT14 row.

    document = docx.Document(BytesIO(generate_docx_file(period, reports, villages)))
    cells = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
    assert "CT14" in cells
    assert "" in cells  # CT02 stays blank in the DOCX table.

    pdf = generate_pdf_file(period, reports, villages)
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 1_000


def test_internal_html_preview_escapes_untrusted_cells_and_shows_all_indicators() -> None:
    reports, villages = _report()
    preview = generate_preview_html("<b>period</b>", reports, villages)

    assert "&lt;script&gt;Village&lt;/script&gt;" in preview
    assert "&lt;b&gt;period&lt;/b&gt;" in preview
    assert preview.count("<th>CT") == 14
    assert "<td style=\"padding: 12px 16px; text-align: center;\"></td>" in preview


def test_summary_export_keeps_submitted_report_that_needs_revision() -> None:
    reports = [
        {
            "village_id": "village-1",
            "workflow_status": "needs_revision",
            "timeliness_status": "on_time",
            "submitted_at": "2026-07-15T10:00:00Z",
            "values": {
                code: 320 if code == "CT01" else 1
                for code in (f"CT{i:02d}" for i in range(1, 15))
            },
        }
    ]

    workbook = openpyxl.load_workbook(
        BytesIO(
            generate_summary_xlsx_file(
                "Tháng 7/2026", reports, {"village-1": "Thôn An Sơn"}
            )
        )
    )
    summary = workbook["Bảng tổng hợp"]
    progress = workbook["Theo dõi tiến độ"]

    assert summary["C5"].value == 320
    assert summary["Q5"].value == "Cần chỉnh sửa · Đúng hạn"
    assert summary["C6"].value == 320
    assert summary["Q6"].value == "1/1"
    assert progress["E5"].value == "15/07/2026 10:00"
    assert progress["F5"].value == "Cần chỉnh sửa · Đúng hạn"
