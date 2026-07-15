# Từ điển dữ liệu v1 - 2026-07

Mọi chỉ tiêu là số nguyên không âm. Rule chi tiết và quan hệ giữa các chỉ tiêu
được version hóa trong `config/validation_rules.json`; validator phía server là
thẩm quyền cuối cùng.

| Mã | Nội dung | Đơn vị | Public |
|---|---|---|---|
| CT01 | Tổng số hộ dân | Hộ | Có |
| CT02 | Tổng số nhân khẩu | Người | Có |
| CT03 | Số hộ nghèo | Hộ | Không |
| CT04 | Số hộ cận nghèo | Hộ | Không |
| CT05 | Người có công với cách mạng | Người | Không |
| CT06 | Đối tượng bảo trợ xã hội đang hưởng trợ cấp | Người | Không |
| CT07 | Trẻ em dưới 16 tuổi | Người | Không |
| CT08 | Trẻ em có hoàn cảnh đặc biệt | Người | Không |
| CT09 | Hộ đạt Gia đình văn hóa | Hộ | Có |
| CT10 | Người trong độ tuổi lao động | Người | Không |
| CT11 | Người tham gia BHYT | Người | Không |
| CT12 | Thành viên Tổ công nghệ số cộng đồng | Người | Có |
| CT13 | Người được hướng dẫn dùng DVC trực tuyến trong kỳ | Người | Có |
| CT14 | Vụ bạo lực gia đình ghi nhận trong kỳ | Vụ | Không, dữ liệu nhạy cảm |

## Nguồn dữ liệu

- `manual`: cán bộ nhập trực tiếp.
- `excel`: nhập từ biểu mẫu XLSX và xác nhận mapping.
- `photo_ocr`: OCR ảnh, luôn qua màn hình xác nhận của người dùng.
- `direct_api`: tích hợp được phê duyệt trong tương lai.

Không được đổi `null` thành 0. `null` có nghĩa là thiếu/chưa xác nhận; 0 là một
giá trị nghiệp vụ đã được người dùng xác nhận.

## Quy tắc chính

- CT03 và CT04 không vượt CT01; CT03 + CT04 không vượt CT01.
- CT07, CT10 và CT11 không vượt CT02; CT08 không vượt CT07; CT09 không vượt
  CT01.
- Tỷ lệ CT02/CT01 ngoài khoảng cấu hình tạo cảnh báo outlier.
- BLANK, TEXT, SEP, code lạ và lỗi logic chặn submit. Outlier cần xác nhận và
  được audit trước khi tiếp tục.

