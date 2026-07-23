"""Regression tests for heterogeneous Excel report normalization."""

from __future__ import annotations

from pathlib import Path

import pytest

from services.form_normalizer import (
    FormNormalizationError,
    _score_label,
    load_synonyms,
    normalize_excel,
    normalize_field_name,
    save_synonym,
)


SYNTHETIC_XLSX_DIR = Path(__file__).resolve().parent / "fixtures" / "xlsx"


@pytest.mark.parametrize(
    "filename",
    [
        "BC_T01_Thôn_Phú_Hòa_1.xlsx",
        "BC_T02_Thôn_Phú_Hòa_2.xlsx",
    ],
)
def test_normalize_synthetic_official_shape_excel_files(filename: str) -> None:
    normalized = normalize_excel((SYNTHETIC_XLSX_DIR / filename).read_bytes())

    assert normalized["CT01"]["value"] == 500
    assert normalized["CT01"]["confidence"] == 1
    assert normalized["CT02"]["value"] == 1800
    assert normalized["CT02"]["confidence"] == 1


def test_synonyms_boost_confidence_without_mutating_source(
    tmp_path: Path,
) -> None:
    synonym_path = tmp_path / "field_synonyms.json"
    original_label = "Chỉ tiêu kiểm thử từ đồng nghĩa"
    ct_code = "CT14"

    save_synonym(original_label, ct_code, path=synonym_path)
    synonyms = load_synonyms(synonym_path)

    assert synonyms[normalize_field_name(original_label)] == ct_code
    assert (
        _score_label(
            original_label,
            {"code": "CT14", "name": "Bạo lực gia đình"},
            synonyms,
        )
        == 100
    )


def test_load_synonyms_rejects_malformed_json(tmp_path: Path) -> None:
    synonym_path = tmp_path / "field_synonyms.json"
    synonym_path.write_text("{", encoding="utf-8")

    with pytest.raises(FormNormalizationError, match="Không thể đọc"):
        load_synonyms(synonym_path)


def test_normalize_rejects_invalid_runtime_mapping() -> None:
    workbook = (
        SYNTHETIC_XLSX_DIR / "BC_T01_Thôn_Phú_Hòa_1.xlsx"
    ).read_bytes()

    with pytest.raises(FormNormalizationError, match="không hợp lệ"):
        normalize_excel(workbook, synonyms={"Tổng số hộ dân": "CT99"})
