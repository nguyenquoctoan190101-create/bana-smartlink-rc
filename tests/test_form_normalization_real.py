"""
tests/test_form_normalization_real.py
======================================
Kiểm tra tính năng chuẩn hóa biểu mẫu Excel không đồng nhất từ các file báo cáo thực tế.
"""
from __future__ import annotations

from pathlib import Path

from services.form_normalizer import normalize_excel, load_synonyms, save_synonym

SYNTHETIC_XLSX_DIR = Path(__file__).resolve().parent / "fixtures" / "xlsx"

def test_normalize_synthetic_official_shape_excel_files():
    for filename in ("BC_T01_Thôn_Phú_Hòa_1.xlsx", "BC_T02_Thôn_Phú_Hòa_2.xlsx"):
        normalized = normalize_excel((SYNTHETIC_XLSX_DIR / filename).read_bytes())

        assert normalized["CT01"]["value"] == 500
        assert normalized["CT01"]["confidence"] == 1
        assert normalized["CT02"]["value"] == 1800
        assert normalized["CT02"]["confidence"] == 1


def test_synonyms_boost_confidence():
    # Test synonym mapping confidence boost
    # 1. Lưu một từ đồng nghĩa giả định
    original_label = "Chỉ tiêu kiểm thử từ đồng nghĩa"
    ct_code = "CT14"
    
    save_synonym(original_label, ct_code)
    synonyms = load_synonyms()
    
    # Đảm bảo từ đồng nghĩa đã được lưu thành công
    from services.form_normalizer import _normalize_text
    norm_key = _normalize_text(original_label)
    assert synonyms.get(norm_key) == ct_code
    
    # 2. Kiểm tra hàm chấm điểm _score_label có trả về 100 (độ tin cậy tối đa) không
    from services.form_normalizer import _score_label
    rule = {"code": "CT14", "name": "Bạo lực gia đình"}
    score = _score_label(original_label, rule, synonyms)
    assert score == 100
    
    print("\n[Test Synonyms]: Boost confidence thanh cong!")
