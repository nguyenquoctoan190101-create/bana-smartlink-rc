from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from services.tracker import get_submission_status
from services.validator import validate_phone, validate_report


# Realistic baseline values shaped like the "Tong hop" sheet rows.
BASE_REPORTS: dict[str, dict[str, Any]] = {
    "Thôn Phước Thái": {
        "CT01": 420,
        "CT02": 1600,
        "CT03": 18,
        "CT04": 24,
        "CT05": 35,
        "CT06": 52,
        "CT07": 380,
        "CT08": 12,
        "CT09": 350,
        "CT10": 980,
        "CT11": 1500,
        "CT12": 11,
        "CT13": 260,
        "CT14": 1,
    },
    "Thôn Hòa Khương Tây": {
        "CT01": 510,
        "CT02": 1900,
        "CT03": 25,
        "CT04": 31,
        "CT05": 42,
        "CT06": 68,
        "CT07": 450,
        "CT08": 14,
        "CT09": 430,
        "CT10": 1160,
        "CT11": 1780,
        "CT12": 13,
        "CT13": 310,
        "CT14": 2,
    },
    "Thôn Phước Hưng": {
        "CT01": 650,
        "CT02": 2450,
        "CT03": 32,
        "CT04": 38,
        "CT05": 55,
        "CT06": 80,
        "CT07": 590,
        "CT08": 18,
        "CT09": 560,
        "CT10": 1520,
        "CT11": 2280,
        "CT12": 14,
        "CT13": 370,
        "CT14": 1,
    },
    "Thôn Trước Đông": {
        "CT01": 350,
        "CT02": 1320,
        "CT03": 14,
        "CT04": 20,
        "CT05": 26,
        "CT06": 44,
        "CT07": 310,
        "CT08": 9,
        "CT09": 295,
        "CT10": 820,
        "CT11": 1240,
        "CT12": 10,
        "CT13": 210,
        "CT14": 0,
    },
    "Thôn Mỹ Sơn": {
        "CT01": 300,
        "CT02": 1120,
        "CT03": 16,
        "CT04": 21,
        "CT05": 24,
        "CT06": 40,
        "CT07": 270,
        "CT08": 8,
        "CT09": 250,
        "CT10": 690,
        "CT11": 1040,
        "CT12": 9,
        "CT13": 190,
        "CT14": 1,
    },
    "Thôn Một": {
        "CT01": 280,
        "CT02": 1040,
        "CT03": 12,
        "CT04": 17,
        "CT05": 21,
        "CT06": 36,
        "CT07": 245,
        "CT08": 7,
        "CT09": 235,
        "CT10": 640,
        "CT11": 970,
        "CT12": 8,
        "CT13": 170,
        "CT14": 0,
    },
}

SUBMITTED_FILES: dict[str, str] = {
    "Thôn Phước Thái": "phuoc_thai.xlsx",
    "Thôn Hòa Khương Tây": "hoa_khuong_tay.xlsx",
    "Thôn Phước Hưng": "phuoc_hung.xlsx",
    "Thôn Trước Đông": "truoc_dong.xlsx",
    "Thôn Mỹ Sơn": "my_son.xlsx",
    "Thôn Một": "thon_mot.xlsx",
}


def _report_for(village_name: str, **overrides: Any) -> dict[str, Any]:
    report = BASE_REPORTS[village_name].copy()
    report.update(overrides)
    return report


GOLDEN_DATA_PATH = Path(__file__).parent / "golden_data.json"

with open(GOLDEN_DATA_PATH, encoding="utf-8") as f:
    golden_rows = json.load(f)[4:]  # Skip headers


@pytest.mark.parametrize("village, ct_code, error_type, desc", golden_rows)
def test_golden_cases(village: str, ct_code: str, error_type: str, desc: str) -> None:
    if error_type == "CHƯA NỘP":
        assert get_submission_status(village, SUBMITTED_FILES) == "chua_nop"
        return

    if error_type == "BADPHONE":
        error = validate_phone("09x-abc")
        assert error is not None
        assert error["error_type"] == "BADPHONE"
        return

    invalid_value: Any = None
    if error_type == "BLANK":
        invalid_value = None
    elif error_type == "TEXT":
        invalid_value = "Một nghìn hai trăm"
    elif error_type == "SEP":
        invalid_value = "2.450"
    elif error_type == "OUTLIER":
        invalid_value = 25000
    elif error_type == "LOGIC":
        if ct_code == "CT03":
            invalid_value = 305  # Greater than CT01=300
        elif ct_code == "CT11":
            invalid_value = 1200  # Greater than CT02=1040

    errors = validate_report(_report_for(village, **{ct_code: invalid_value}))

    assert any(
        e["ct_code"] == ct_code and e["error_type"] == error_type for e in errors
    ), f"Expected error {error_type} for {ct_code} in {village}, got {errors}"
