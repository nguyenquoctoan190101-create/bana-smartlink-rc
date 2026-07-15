"""
tests/test_ocr_accuracy.py
==========================
Accuracy measurement harness for services/ocr_report.py.

Runs the OCR pipeline on 5 test images (stored in the scratch directory)
and scores each against the known ground-truth values.

Outputs a results table showing:
  - per-image accuracy (% cells read correctly)
  - per-cell accuracy across all images
  - overall accuracy

Usage
-----
    python tests/test_ocr_accuracy.py

No live Gemini API is needed if you pass --dry-run (uses a stub response).
To run against the real Gemini API, ensure .env is configured.

Note: Run with  python -m pytest tests/test_ocr_accuracy.py -v  to execute as
a pytest suite, or  python tests/test_ocr_accuracy.py  for the tabular report.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import pytest
from pathlib import Path
from typing import NamedTuple

# ---------------------------------------------------------------------------
# Ground truth
# These are the values visible in the 5 test images (all images share the
# same form data — only the image quality / angle differs).
# ---------------------------------------------------------------------------
GROUND_TRUTH: dict[str, int | None] = {
    "CT01": 145,
    "CT02": 512,
    "CT03": 18,
    "CT04": 22,
    "CT05": 7,
    "CT06": 14,
    "CT07": 89,
    "CT08": 3,
    "CT09": 110,
    "CT10": 285,
    "CT11": 498,
    "CT12": 5,
    "CT13": 42,
    "CT14": 1,
}

# ---------------------------------------------------------------------------
# Test images
# ---------------------------------------------------------------------------
_SCRATCH = (
    Path(__file__).resolve().parents[1]
    / ".."  # up one from project root -- adjust if needed
)

BRAIN_DIR = Path(
    os.environ.get(
        "OCR_TEST_IMAGE_DIR",
        str(Path(__file__).resolve().parent / "fixtures" / "ocr"),
    )
)

TEST_IMAGES: list[tuple[str, Path]] = [
    ("01_normal   (ideal light, flat)", BRAIN_DIR / "test_ocr_01_normal.png"),
    ("02_tilted   (15° angle, indoor)", BRAIN_DIR / "test_ocr_02_tilted.png"),
    ("03_low_light (dim lamp, shadow)", BRAIN_DIR / "test_ocr_03_low_light.png"),
    ("04_glare    (sunlight reflection)", BRAIN_DIR / "test_ocr_04_glare.png"),
    ("05_crumpled (wrinkled paper)", BRAIN_DIR / "test_ocr_05_crumpled.png"),
]

# ---------------------------------------------------------------------------
# Stub response for --dry-run mode
# Simulates a perfect Gemini response so the harness logic can be tested
# without an API key.
# ---------------------------------------------------------------------------
_STUB_RESPONSE = json.dumps({code: val for code, val in GROUND_TRUTH.items()})


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------
class CellResult(NamedTuple):
    code: str
    expected: int | None
    got: int | None
    correct: bool


class ImageResult(NamedTuple):
    label: str
    cell_results: list[CellResult]
    accuracy_pct: float
    error: str | None


# ---------------------------------------------------------------------------
# Accuracy helpers
# ---------------------------------------------------------------------------

def _score_image(
    label: str,
    values: dict[str, int | None],
    error: str | None,
) -> ImageResult:
    cell_results: list[CellResult] = []
    for code, expected in GROUND_TRUTH.items():
        got = values.get(code)
        correct = got == expected
        cell_results.append(CellResult(code=code, expected=expected, got=got, correct=correct))

    correct_count = sum(1 for c in cell_results if c.correct)
    total = len(cell_results)
    accuracy = (correct_count / total * 100) if total else 0.0
    return ImageResult(
        label=label,
        cell_results=cell_results,
        accuracy_pct=accuracy,
        error=error,
    )


def _print_report(results: list[ImageResult]) -> None:
    print("\n" + "=" * 70)
    print("  OCR ACCURACY REPORT — services/ocr_report.py")
    print("=" * 70)

    # Per-image summary
    print(f"\n{'Image':<38}  {'Correct':>8}  {'Accuracy':>10}")
    print("-" * 60)
    all_cells: list[CellResult] = []
    for r in results:
        total = len(r.cell_results)
        correct = sum(1 for c in r.cell_results if c.correct)
        status = "ERROR" if r.error else f"{correct}/{total}"
        err_tag = f"  [{r.error}]" if r.error else ""
        print(f"  {r.label:<36}  {status:>8}  {r.accuracy_pct:>9.1f}%{err_tag}")
        all_cells.extend(r.cell_results)

    # Per-cell summary across all images
    print(f"\n{'CT Code':<8}  {'Correct / Total':>16}  {'Rate':>8}")
    print("-" * 40)
    codes = list(GROUND_TRUTH.keys())
    for code in codes:
        cells = [c for c in all_cells if c.code == code]
        correct = sum(1 for c in cells if c.correct)
        total = len(cells)
        rate = (correct / total * 100) if total else 0.0
        bar = "#" * int(rate / 10) + "." * (10 - int(rate / 10))
        print(f"  {code:<6}  {correct:>5}/{total:<5}  {rate:>6.1f}%  {bar}")

    # Overall
    overall_correct = sum(1 for c in all_cells if c.correct)
    overall_total = len(all_cells)
    overall_pct = (overall_correct / overall_total * 100) if overall_total else 0.0
    print(f"\n  Overall: {overall_correct}/{overall_total} cells correct  ({overall_pct:.1f}%)")

    # Decision guidance
    print("\n" + "-" * 70)
    if overall_pct >= 90:
        print("  RESULT: OCR accuracy >= 90% -- SUITABLE for demo integration.")
    elif overall_pct >= 75:
        print("  RESULT: OCR accuracy 75-89% -- ACCEPTABLE with manual review UI.")
    else:
        print("  RESULT: OCR accuracy < 75% -- NOT recommended without improvement.")
    print("=" * 70 + "\n")


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

async def _run_ocr_on_image(
    label: str,
    image_path: Path,
    dry_run: bool,
) -> ImageResult:
    if not image_path.exists():
        return ImageResult(
            label=label,
            cell_results=[],
            accuracy_pct=0.0,
            error=f"File not found: {image_path}",
        )

    image_bytes = image_path.read_bytes()

    if dry_run:
        # Bypass real Gemini; use stub response to validate harness logic
        from services.ocr_report import parse_ocr_result, extract_table_region
        _ = extract_table_region(image_bytes)  # still test the crop
        values = parse_ocr_result(_STUB_RESPONSE)
        return _score_image(label, values, error=None)

    try:
        from services.ocr_report import ocr_report_async
        preview = await ocr_report_async(image_bytes)
        return _score_image(label, preview.values, error=None)
    except Exception as exc:
        # OCR failed: mark all cells as incorrect
        return ImageResult(
            label=label,
            cell_results=[
                CellResult(code=code, expected=v, got=None, correct=False)
                for code, v in GROUND_TRUTH.items()
            ],
            accuracy_pct=0.0,
            error=str(exc)[:80],
        )


async def run_all(dry_run: bool = False) -> list[ImageResult]:
    tasks = [
        _run_ocr_on_image(label, path, dry_run)
        for label, path in TEST_IMAGES
    ]
    return list(await asyncio.gather(*tasks))


# ---------------------------------------------------------------------------
# Pytest integration
# ---------------------------------------------------------------------------

def test_parse_ocr_result_perfect_json():
    """parse_ocr_result must correctly parse a perfect Gemini response."""
    from services.ocr_report import parse_ocr_result
    result = parse_ocr_result(_STUB_RESPONSE)
    assert result == GROUND_TRUTH, f"Mismatch: {result}"


def test_parse_ocr_result_null_values():
    """parse_ocr_result must return None for null cells, not 0."""
    from services.ocr_report import parse_ocr_result
    data = {code: None for code in GROUND_TRUTH}
    raw = json.dumps(data)
    result = parse_ocr_result(raw)
    for code, val in result.items():
        assert val is None, f"{code} should be None but got {val}"


def test_parse_ocr_result_strips_markdown_fences():
    """parse_ocr_result must handle Gemini wrapping JSON in code fences."""
    from services.ocr_report import parse_ocr_result
    raw = "```json\n" + _STUB_RESPONSE + "\n```"
    result = parse_ocr_result(raw)
    assert result == GROUND_TRUTH


def test_parse_ocr_result_numeric_strings():
    """parse_ocr_result must cast numeric strings to int."""
    from services.ocr_report import parse_ocr_result
    data = {code: str(val) for code, val in GROUND_TRUTH.items()}
    result = parse_ocr_result(json.dumps(data))
    assert result == GROUND_TRUTH


def test_parse_ocr_result_rejects_boolean():
    """parse_ocr_result must map JSON booleans to None."""
    from services.ocr_report import parse_ocr_result
    data = {"CT01": True, "CT02": False}
    result = parse_ocr_result(json.dumps(data))
    assert result["CT01"] is None
    assert result["CT02"] is None


def test_validate_ocr_report_flags_blank_nulls():
    """validate_ocr_report must flag all-null values as BLANK errors."""
    from services.ocr_report import validate_ocr_report
    values = {code: None for code in GROUND_TRUTH}
    flags = validate_ocr_report(values)
    blank_flags = [f for f in flags if f["error_type"] == "BLANK"]
    assert len(blank_flags) == len(GROUND_TRUTH), (
        f"Expected {len(GROUND_TRUTH)} BLANK flags, got {len(blank_flags)}"
    )


def test_extract_table_region_without_pillow(monkeypatch):
    """Privacy processing must fail closed when Pillow is unavailable."""
    import builtins

    real_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name == "PIL" or name.startswith("PIL."):
            raise ImportError("Pillow not available")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", mock_import)

    from services import ocr_report
    import importlib
    importlib.reload(ocr_report)

    dummy = b"\xff\xd8\xff" + b"\x00" * 100
    with pytest.raises(ocr_report.OcrError, match="privacy processing"):
        ocr_report.extract_table_region(dummy)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    if dry:
        print("Running in DRY-RUN mode (stub Gemini response, no API calls)")

    results = asyncio.run(run_all(dry_run=dry))
    _print_report(results)
