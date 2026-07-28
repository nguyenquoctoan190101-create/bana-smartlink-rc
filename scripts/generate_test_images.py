# -*- coding: utf-8 -*-
"""
Ba Na SmartLink - Test Image Generator
Programmatically draws 5 realistic report forms under different lighting/skew conditions
using Pillow to provide offline test assets for OCR.
"""

import os
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

def create_base_report_image(values: dict, text_color=(0, 0, 0), bg_color=(255, 255, 255)) -> Image.Image:
    # 800x1200 image
    img = Image.new("RGB", (800, 1200), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Try using default font
    try:
        # Fallback to standard platform fonts if available
        font_title = ImageFont.load_default()
        font_text = ImageFont.load_default()
    except Exception:
        font_title = None
        font_text = None
        
    # 1. Draw top 30% header (metadata to be cropped)
    draw.text((100, 50), "DU LIEU KIEM THU TONG HOP", fill=text_color, font=font_title)
    draw.text((100, 80), "PHIEU BAO CAO CHI TIEU VAN HOA - XA HOI", fill=text_color, font=font_title)
    draw.text((100, 140), "Khong co du lieu ca nhan hoac ho so nghiep vu", fill=text_color, font=font_text)
    draw.text((100, 170), "Chi dung de kiem thu OCR tu dong", fill=text_color, font=font_text)
    draw.text((100, 200), "Ky kiem thu: 2026-07", fill=text_color, font=font_text)
    draw.text((100, 230), "Pham vi: Thon tong hop gia lap", fill=text_color, font=font_text)
    
    # Separation line at 300px (30% of 1200 is 360, so this is well within the top 30%)
    draw.line((50, 310, 750, 310), fill=(180, 180, 180), width=2)
    
    # 2. Draw table header from line 340
    draw.text((80, 330), "Mã CT", fill=text_color, font=font_text)
    draw.text((180, 330), "Tên Chỉ Tiêu Thẩm Định", fill=text_color, font=font_text)
    draw.text((580, 330), "Số Liệu", fill=text_color, font=font_text)
    
    draw.line((50, 355, 750, 355), fill=text_color, width=2)
    
    # Indicators detail list
    ct_names = [
        ("CT01", "Tổng số hộ dân"),
        ("CT02", "Tổng số nhân khẩu"),
        ("CT03", "Số hộ nghèo"),
        ("CT04", "Số hộ cận nghèo"),
        ("CT05", "Số người có công với cách mạng đang được quản lý"),
        ("CT06", "Số đối tượng bảo trợ xã hội hưởng trợ cấp"),
        ("CT07", "Số trẻ em dưới 16 tuổi"),
        ("CT08", "Số trẻ em có hoàn cảnh đặc biệt"),
        ("CT09", "Số hộ đạt 'Gia đình văn hóa'"),
        ("CT10", "Số người trong độ tuổi lao động"),
        ("CT11", "Số người tham gia BHYT"),
        ("CT12", "Số thành viên Tổ công nghệ số cộng đồng"),
        ("CT13", "Số người dân được hướng dẫn dùng DVC trực tuyến"),
        ("CT14", "Số vụ bạo lực gia đình ghi nhận trong kỳ")
    ]
    
    y = 370
    for code, name in ct_names:
        val = values.get(code, "0")
        draw.text((80, y), code, fill=text_color, font=font_text)
        draw.text((180, y), name, fill=text_color, font=font_text)
        draw.text((580, y), str(val), fill=text_color, font=font_text)
        
        # Grid horizontal lines
        draw.line((50, y+22, 750, y+22), fill=(200, 200, 200), width=1)
        y += 35
        
    # Vertical grid borders
    draw.line((50, 320, 50, y-13), fill=text_color, width=1)
    draw.line((160, 320, 160, y-13), fill=text_color, width=1)
    draw.line((560, 320, 560, y-13), fill=text_color, width=1)
    draw.line((750, 320, 750, y-13), fill=text_color, width=1)
    
    # Bottom border
    draw.line((50, y-13, 750, y-13), fill=text_color, width=2)
    
    return img

def main():
    os.makedirs("tests/ocr_test_images", exist_ok=True)
    
    # Synthetic baseline values shared with tests/test_ocr_accuracy.py.
    base_values = {
        "CT01": "145",
        "CT02": "512",
        "CT03": "18",
        "CT04": "22",
        "CT05": "7",
        "CT06": "14",
        "CT07": "89",
        "CT08": "3",
        "CT09": "110",
        "CT10": "285",
        "CT11": "498",
        "CT12": "5",
        "CT13": "42",
        "CT14": "1"
    }
    
    # 1. Normal/Clean Image
    print("Generating ocr_test_normal.jpg...")
    normal_img = create_base_report_image(base_values)
    normal_img.save("tests/ocr_test_images/ocr_test_normal.jpg", quality=95)
    
    # 2. Skewed / Warm Light Image
    print("Generating ocr_test_tilted.jpg...")
    tilted_canvas = create_base_report_image(base_values, text_color=(10, 10, 30), bg_color=(254, 253, 245))
    # Rotate slightly to simulate phone skew
    rotated = tilted_canvas.rotate(-4, resample=Image.BICUBIC, expand=True, fillcolor=(235, 230, 210))
    # Add yellowish yellow/warm lighting overlay
    overlay = Image.new("RGB", rotated.size, (255, 240, 200))
    tilted_img = Image.blend(rotated, overlay, 0.15)
    tilted_img.save("tests/ocr_test_images/ocr_test_tilted.jpg", quality=90)
    
    # 3. Low Light / Grainy Image
    print("Generating ocr_test_lowlight.jpg...")
    lowlight_canvas = create_base_report_image(base_values, text_color=(30, 30, 30), bg_color=(190, 190, 190))
    # Add shadows & darkness
    enhancer = ImageEnhance.Brightness(lowlight_canvas)
    dark_img = enhancer.enhance(0.4)
    # Add noise or grain using simple pixel manipulation or compression artifacts
    contrast_enhancer = ImageEnhance.Contrast(dark_img)
    final_low_light = contrast_enhancer.enhance(0.8)
    final_low_light.save("tests/ocr_test_images/ocr_test_lowlight.jpg", quality=50) # low quality adds real artifacts
    
    # 4. Blue Ballpoint Pen Image
    print("Generating ocr_test_bluepen.jpg...")
    # Use dark blue for ink text
    blue_values = dict(base_values)
    blue_pen_img = create_base_report_image(blue_values, text_color=(20, 50, 180), bg_color=(255, 255, 255))
    blue_pen_img.save("tests/ocr_test_images/ocr_test_bluepen.jpg", quality=92)
    
    # 5. Folded / Creased Paper Image
    print("Generating ocr_test_folded.jpg...")
    folded_canvas = create_base_report_image(base_values)
    draw = ImageDraw.Draw(folded_canvas)
    # Draw gray horizontal/vertical fold lines to simulate paper creases
    draw.line((0, 400, 800, 403), fill=(160, 160, 160), width=4)
    draw.line((0, 400, 800, 401), fill=(245, 245, 245), width=2)
    draw.line((0, 800, 800, 804), fill=(150, 150, 150), width=3)
    draw.line((0, 800, 800, 801), fill=(240, 240, 240), width=2)
    draw.line((380, 0, 384, 1200), fill=(160, 160, 160), width=4)
    draw.line((380, 0, 381, 1200), fill=(240, 240, 240), width=2)
    
    # Enhance slightly and save
    folded_canvas.save("tests/ocr_test_images/ocr_test_folded.jpg", quality=90)
    
    print("Successfully generated all 5 offline test report images inside tests/ocr_test_images/")

if __name__ == "__main__":
    main()
