"""Generate synthetic DOCX/XLSX/PDF exports for visual release QA only."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from routers.reports import generate_docx_file, generate_pdf_file  # noqa: E402 -- direct script bootstrap
from services.export_service import generate_summary_xlsx_file  # noqa: E402 -- direct script bootstrap


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    villages = {"village-synthetic": "Thôn Phước Hưng"}
    values = {f"CT{index:02d}": index * 10 for index in range(1, 15)}
    values["CT04"] = None
    reports = [
        {
            "village_id": "village-synthetic",
            "workflow_status": "approved",
            "timeliness_status": "on_time",
            "submitted_at": "2026-07-13T10:00:00Z",
            "values": values,
        }
    ]
    period_name = "Kỳ demo tổng hợp 2026"
    (args.output / "export_summary.xlsx").write_bytes(
        generate_summary_xlsx_file(period_name, reports, villages)
    )
    (args.output / "export_summary.docx").write_bytes(
        generate_docx_file(period_name, reports, villages)
    )
    (args.output / "export_summary.pdf").write_bytes(
        generate_pdf_file(period_name, reports, villages)
    )
    print(f"Generated synthetic export QA artifacts in {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
