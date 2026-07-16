import json
from pathlib import Path
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "tests" / "fixtures" / "xlsx"
MAP_PATH = PROJECT_ROOT / "DU_LIEU_CHINH_THUC" / "village_merge_map_CHINH_THUC.json"

def get_test_cases():
    if not DATA_DIR.exists() or not MAP_PATH.exists():
        return []
        
    with open(MAP_PATH, "r", encoding="utf-8") as f:
        merge_data = json.load(f)
        
    old_to_new_map = {}
    for entry in merge_data["anh_xa_thon_cu"]:
        old_to_new_map[entry["ten_thon_cu"]] = entry.get("new_village_id")
        
    excel_files = list(DATA_DIR.glob("BC_T*.xlsx"))
    return [(f.name, old_to_new_map) for f in excel_files]

test_cases = get_test_cases()

@pytest.mark.parametrize("filename,old_to_new_map", test_cases)
def test_village_mapping_golden(filename, old_to_new_map):
    """
    Xác nhận từng file excel được map đúng vào new_village_id 
    dựa trên field ten_thon_cu một cách chính xác tuyệt đối.
    """
    from services.village_mapper import map_report_file_to_village
    
    # We must load the actual mapping_data dict structure since the function needs it
    with open(MAP_PATH, "r", encoding="utf-8") as f:
        mapping_data = json.load(f)
        
    new_id = map_report_file_to_village(filename, mapping_data)
    
    # To verify it's the expected ID based on our ten_thon_cu logic
    parts = filename.replace(".xlsx", "").split("_", 2)
    extracted_name = parts[2].replace("_", " ")
    expected_id = old_to_new_map.get(extracted_name)
    
    assert new_id == expected_id, f"Filename {filename} mapped to {new_id} instead of {expected_id}"


def test_dong_son_fails_closed_until_official_boundary_is_available():
    from services.village_mapper import resolve_village_mapping

    with open(MAP_PATH, "r", encoding="utf-8") as f:
        mapping_data = json.load(f)

    resolution = resolve_village_mapping("Thôn Đông Sơn", mapping_data)

    assert resolution["mapping_status"] == "pending_official_decision"
    assert resolution["target_village_id"] is None
    assert resolution["proposed_target_village_id"] == "hoa_ninh"
