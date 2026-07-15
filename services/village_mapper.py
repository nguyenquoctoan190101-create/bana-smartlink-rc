def map_report_file_to_village(filename: str, mapping_data: dict) -> str:
    """
    Map an Excel report filename to its new village ID based on village_merge_map_CHINH_THUC.json.
    
    Args:
        filename: e.g., 'BC_T10_Thôn_Phước_Hưng_Nam.xlsx'
        mapping_data: parsed dictionary from the JSON file
        
    Returns:
        The new_village_id string (e.g., 'thai_lai'), or None if no match is found.
    """
    parts = filename.replace(".xlsx", "").split("_", 2)
    if len(parts) < 2:
        return None
        
    t_code = parts[1] # e.g. "T08", "T10"
    
    t_map = {
        "T01": "Thôn Phú Hòa 1",
        "T02": "Thôn Phú Hòa 2",
        "T03": "Thôn Thạch Nham Đông",
        "T04": "Thôn Phước Thái",
        "T05": "Thôn Thái Lai",
        "T06": "Thôn Hòa Khương Đông",
        "T07": "Thôn Hòa Khương Tây",
        "T08": "Thôn Phước Thuận - Phước Hậu",
        "T09": "Thôn Phước Hưng",
        "T10": "Thôn Phước Hưng Nam",
        "T11": "Thôn Ninh An",
        "T12": "Thôn Trước Đông",
        "T13": "Thôn Diêu Phong",
        "T14": "Thôn Sơn Phước",
        "T15": "Thôn Mỹ Sơn",
        "T16": "Thôn Năm",
        "T17": "Thôn Hòa Trung",
        "T18": "Thôn Một",
        "T19": "Thôn Trung Nghĩa",
        "T20": "Thôn Đông Sơn",
        "T22": "Thôn An Sơn",
    }
    
    extracted_name = t_map.get(t_code)
    if not extracted_name and len(parts) >= 3:
        extracted_name = parts[2].replace("_", " ")
        
    if extracted_name:
        for entry in mapping_data.get("anh_xa_thon_cu", []):
            if entry["ten_thon_cu"] == extracted_name:
                return entry["new_village_id"]
                
    return None
