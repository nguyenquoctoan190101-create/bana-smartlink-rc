from datetime import datetime
from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# Standard styling constants
BLUE_HEADER_FILL = PatternFill(start_color="3B74B4", end_color="3B74B4", fill_type="solid")
WHITE_BOLD_FONT = Font(name="Times New Roman", size=11, bold=True, color="FFFFFF")
BLACK_BOLD_FONT = Font(name="Times New Roman", size=11, bold=True, color="000000")
NORMAL_FONT = Font(name="Times New Roman", size=11, color="000000")
TITLE_FONT = Font(name="Times New Roman", size=13, bold=True, color="000000")
NATION_HEADER_FONT = Font(name="Times New Roman", size=11, bold=True, color="000000")
NATION_SUBHEADER_FONT = Font(name="Times New Roman", size=11, bold=True, italic=True, color="000000")

THIN_BORDER = Border(
    left=Side(style='thin'), 
    right=Side(style='thin'), 
    top=Side(style='thin'), 
    bottom=Side(style='thin')
)

CENTER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT_ALIGN = Alignment(horizontal="left", vertical="center", wrap_text=True)
INDICATORS_DICT = {
    "CT01": ("Tổng số hộ dân", "Hộ"),
    "CT02": ("Tổng số nhân khẩu", "Người"),
    "CT03": ("Số hộ nghèo", "Hộ"),
    "CT04": ("Số hộ cận nghèo", "Hộ"),
    "CT05": ("Số người có công với cách mạng", "Người"),
    "CT06": ("Số đối tượng bảo trợ xã hội đang hưởng trợ cấp", "Người"),
    "CT07": ("Số trẻ em dưới 16 tuổi", "Người"),
    "CT08": ("Số trẻ em có hoàn cảnh đặc biệt", "Người"),
    "CT09": ("Số hộ đạt 'Gia đình văn hóa'", "Hộ"),
    "CT10": ("Số người trong độ tuổi lao động", "Người"),
    "CT11": ("Số người tham gia BHYT", "Người"),
    "CT12": ("Số thành viên Tổ công nghệ số cộng đồng", "Người"),
    "CT13": ("Số người dân được hướng dẫn dùng DVC trực tuyến trong kỳ", "Người"),
    "CT14": ("Số vụ bạo lực gia đình ghi nhận trong kỳ", "Vụ")
}
INDICATOR_CODES = tuple(INDICATORS_DICT)


def _safe_excel_text(value: object | None) -> str | None:
    """Prevent untrusted text from being interpreted as a spreadsheet formula."""
    if value is None:
        return None
    text = str(value)
    return f"'{text}" if text.lstrip().startswith(("=", "+", "-", "@")) else text


def _safe_excel_value(value: object | None) -> int | float | str | None:
    """Keep numeric cells typed, null cells blank, and text cells formula-safe."""
    if value is None:
        return None
    if isinstance(value, bool):
        return _safe_excel_text(value)
    if isinstance(value, (int, float)):
        return value
    return _safe_excel_text(value)


def _format_submitted_at(value: object | None) -> str:
    if value is None:
        return ""
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return text


def _submission_status_label(report: dict[str, Any]) -> str:
    workflow = str(report.get("workflow_status") or "")
    timeliness = report.get("timeliness_status")
    if workflow == "needs_revision":
        suffix = {
            "on_time": "Đúng hạn",
            "late": "Trễ hạn",
        }.get(str(timeliness), "Đã nộp")
        return f"Cần chỉnh sửa · {suffix}"
    if timeliness == "on_time":
        return "Đúng hạn"
    if timeliness == "late":
        return "Trễ hạn"
    return {
        "draft": "Bản nháp",
        "submitted": "Đã nộp",
        "needs_revision": "Cần chỉnh sửa",
        "approved": "Đã duyệt",
        "locked": "Đã khóa",
    }.get(workflow, "Đã nộp")

def generate_village_xlsx_file(period_name: str, report_data: dict, village_name: str) -> bytes:
    """Generates the Single Village Report exactly matching Page 1 format."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Phiếu báo cáo"

    # Header section
    ws.merge_cells('A1:E1')
    ws['A1'] = "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
    ws['A1'].font = NATION_HEADER_FONT
    ws['A1'].alignment = CENTER_ALIGN

    ws.merge_cells('A2:E2')
    ws['A2'] = "Độc lập - Tự do - Hạnh phúc"
    ws['A2'].font = NATION_SUBHEADER_FONT
    ws['A2'].alignment = CENTER_ALIGN

    ws.merge_cells('A4:E4')
    ws['A4'] = "PHIẾU BÁO CÁO SỐ LIỆU VĂN HÓA – XÃ HỘI ĐỊNH KỲ"
    ws['A4'].font = TITLE_FONT
    ws['A4'].alignment = CENTER_ALIGN

    ws.merge_cells('A5:E5')
    ws['A5'] = _safe_excel_text(f"Kỳ báo cáo: {period_name}")
    ws['A5'].font = Font(name="Times New Roman", size=11, italic=True)
    ws['A5'].alignment = CENTER_ALIGN

    # Metadata
    submitter_name = report_data.get("reporter_name") or ""
    submitter_phone = report_data.get("reporter_phone") or ""
    submitted_at = _format_submitted_at(report_data.get("submitted_at"))
        
    ws['A7'] = _safe_excel_text(f"Đơn vị báo cáo (Thôn): {village_name}")
    ws['A8'] = _safe_excel_text(f"Người lập báo cáo: {submitter_name}")
    ws['A9'] = "Chức danh: Cán bộ thôn"
    ws['A10'] = _safe_excel_text(f"Số điện thoại: {submitter_phone}")
    ws['A11'] = _safe_excel_text(f"Thời điểm nộp: {submitted_at}")

    for r in range(7, 12):
        ws[f'A{r}'].font = NORMAL_FONT

    # Table Header
    headers = ["Mã CT", "Tên chỉ tiêu", "Đơn vị tính", "Số liệu", "Ghi chú"]
    ws.append([]) # A12 empty
    ws.append(headers) # row 13
    
    for col_num in range(1, 6):
        cell = ws.cell(row=13, column=col_num)
        cell.fill = BLUE_HEADER_FILL
        cell.font = WHITE_BOLD_FONT
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER

    # Table Data
    vals = report_data.get("values", {})
    for code, (name, unit) in INDICATORS_DICT.items():
        row_data = [
            code,
            name,
            unit,
            _safe_excel_value(vals.get(code)),
            ""
        ]
        ws.append(row_data)
        current_row = ws._current_row
        
        ws.cell(row=current_row, column=1).alignment = CENTER_ALIGN
        ws.cell(row=current_row, column=2).alignment = LEFT_ALIGN
        ws.cell(row=current_row, column=3).alignment = CENTER_ALIGN
        ws.cell(row=current_row, column=4).alignment = CENTER_ALIGN
        ws.cell(row=current_row, column=5).alignment = LEFT_ALIGN
        
        for col_num in range(1, 6):
            cell = ws.cell(row=current_row, column=col_num)
            cell.font = NORMAL_FONT
            cell.border = THIN_BORDER

    # Set column widths
    ws.column_dimensions['A'].width = 10
    ws.column_dimensions['B'].width = 60
    ws.column_dimensions['C'].width = 15
    ws.column_dimensions['D'].width = 15
    ws.column_dimensions['E'].width = 25

    # Export to bytes
    output = BytesIO()
    wb.save(output)
    return output.getvalue()


def generate_summary_xlsx_file(period_name: str, reports_data: list, villages_map: dict) -> bytes:
    """Generates the All Villages Summary matching Pages 2,3,4."""
    wb = Workbook()
    
    # Sheet 1: BẢNG TỔNG HỢP SỐ LIỆU
    ws1 = wb.active
    ws1.title = "Bảng tổng hợp"
    
    ws1.merge_cells('A1:Q1')
    ws1['A1'] = "BẢNG TỔNG HỢP SỐ LIỆU VĂN HÓA – XÃ HỘI THEO THÔN"
    ws1['A1'].font = TITLE_FONT
    ws1['A1'].alignment = LEFT_ALIGN
    
    ws1.merge_cells('A2:Q2')
    ws1['A2'] = _safe_excel_text(f"Xã Bà Nà — Kỳ báo cáo: {period_name}")
    ws1['A2'].font = Font(name="Times New Roman", size=11, italic=True)
    ws1['A2'].alignment = LEFT_ALIGN
    
    # Headers
    headers = ["STT", "Thôn"]
    for code, (name, _) in INDICATORS_DICT.items():
        headers.append(f"{code}\n{name}")
    headers.append("Trạng thái nộp")
    
    ws1.append([])
    ws1.append(headers)
    
    # Style Header
    for col_num in range(1, 18):
        cell = ws1.cell(row=4, column=col_num)
        cell.fill = BLUE_HEADER_FILL
        cell.font = WHITE_BOLD_FONT
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER
        
    ws1.column_dimensions['A'].width = 5
    ws1.column_dimensions['B'].width = 25
    for c in range(3, 17):
        ws1.column_dimensions[get_column_letter(c)].width = 14
    ws1.column_dimensions['Q'].width = 15

    # Sort villages
    sorted_villages = sorted(villages_map.items(), key=lambda x: x[1])
    
    # Data Rows
    sums = {code: 0 for code in INDICATORS_DICT.keys()}
    incomplete_totals = {code: False for code in INDICATORS_DICT.keys()}
    submitted_count = 0
    row_idx = 5
    
    for i, (v_id, v_name) in enumerate(sorted_villages, 1):
        report = next((r for r in reports_data if r["village_id"] == v_id), None)
        if report:
            vals = report.get("values", {})
            status_text = _submission_status_label(report)
            
            row_data = [i, _safe_excel_text(v_name)]
            for code in INDICATORS_DICT.keys():
                val = vals.get(code)
                row_data.append(_safe_excel_value(val))
                if isinstance(val, bool) or not isinstance(val, (int, float)):
                    incomplete_totals[code] = True
                else:
                    sums[code] += val
            row_data.append(status_text)
            submitted_count += 1
        else:
            row_data = [i, _safe_excel_text(v_name)]
            for _ in INDICATORS_DICT.keys():
                row_data.append("")
            row_data.append("Chưa nộp")
            
        ws1.append(row_data)
        
        for col_num in range(1, 18):
            cell = ws1.cell(row=row_idx, column=col_num)
            cell.font = NORMAL_FONT
            cell.border = THIN_BORDER
            if col_num > 2 and col_num < 17:
                cell.alignment = CENTER_ALIGN
        
        row_idx += 1
        
    # Total Row
    total_row = ["", "TỔNG CỘNG (các thôn đã nộp)"]
    for code in INDICATORS_DICT.keys():
        total_row.append("" if incomplete_totals[code] else sums[code])
    total_row.append(f"{submitted_count}/{len(villages_map)}")
    
    ws1.append(total_row)
    for col_num in range(1, 18):
        cell = ws1.cell(row=row_idx, column=col_num)
        cell.font = BLACK_BOLD_FONT
        cell.border = THIN_BORDER
        cell.fill = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")
        if col_num > 2:
            cell.alignment = CENTER_ALIGN
            
    ws1.freeze_panes = 'C5'

    # Sheet 2: THEO DÕI TIẾN ĐỘ
    ws2 = wb.create_sheet("Theo dõi tiến độ")
    ws2.merge_cells('A1:G1')
    ws2['A1'] = "THEO DÕI TIẾN ĐỘ NỘP BÁO CÁO"
    ws2['A1'].font = TITLE_FONT
    ws2['A1'].alignment = LEFT_ALIGN
    
    ws2.merge_cells('A2:G2')
    ws2['A2'] = _safe_excel_text(f"Kỳ báo cáo: {period_name} — Thời điểm tổng hợp: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    ws2['A2'].font = Font(name="Times New Roman", size=11, italic=True)
    ws2['A2'].alignment = LEFT_ALIGN
    
    ws2.append([])
    headers_progress = ["STT", "Thôn", "Người lập", "SĐT", "Thời điểm nộp", "Trạng thái", "Số ngày trễ"]
    ws2.append(headers_progress)
    
    for col_num in range(1, 8):
        cell = ws2.cell(row=4, column=col_num)
        cell.fill = BLUE_HEADER_FILL
        cell.font = WHITE_BOLD_FONT
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER
        
    row_idx = 5
    for i, (v_id, v_name) in enumerate(sorted_villages, 1):
        report = next((r for r in reports_data if r["village_id"] == v_id), None)
        if report:
            submitter_name = report.get("reporter_name") or ""
            submitter_phone = report.get("reporter_phone") or ""
            submitted_at = _format_submitted_at(report.get("submitted_at"))
            status_text = _submission_status_label(report)
            days_late = _safe_excel_value(report.get("days_late"))
        else:
            submitter_name = ""
            submitter_phone = ""
            submitted_at = ""
            status_text = "Chưa nộp"
            days_late = ""
            
        row_data = [
            i,
            _safe_excel_text(v_name),
            _safe_excel_text(submitter_name),
            _safe_excel_text(submitter_phone),
            _safe_excel_text(submitted_at),
            status_text,
            days_late,
        ]
        ws2.append(row_data)
        
        for col_num in range(1, 8):
            cell = ws2.cell(row=row_idx, column=col_num)
            cell.font = NORMAL_FONT
            cell.border = THIN_BORDER
            if col_num in [1, 4, 5, 6, 7]:
                cell.alignment = CENTER_ALIGN
                
            if status_text == "Chưa nộp" and col_num == 6:
                cell.fill = PatternFill(start_color="F4CCCC", end_color="F4CCCC", fill_type="solid")
            elif status_text == "Trễ hạn" and col_num == 6:
                cell.fill = PatternFill(start_color="FCE5CD", end_color="FCE5CD", fill_type="solid")
            elif col_num == 6:
                cell.fill = PatternFill(start_color="D9EAD3", end_color="D9EAD3", fill_type="solid")
                
        row_idx += 1
        
    ws2.column_dimensions['A'].width = 5
    ws2.column_dimensions['B'].width = 25
    ws2.column_dimensions['C'].width = 25
    ws2.column_dimensions['D'].width = 15
    ws2.column_dimensions['E'].width = 20
    ws2.column_dimensions['F'].width = 20
    ws2.column_dimensions['G'].width = 15

    output = BytesIO()
    wb.save(output)
    return output.getvalue()
