# Bộ dữ liệu kiểm thử độc lập

Thư mục `pdfs/` chứa 21 biểu mẫu/báo cáo PDF do ban tổ chức cung cấp cho
BaNa SmartLink. Các tệp chỉ được dùng làm golden fixtures trong kiểm thử, không
được đóng gói vào frontend production và không được coi là dữ liệu dân cư thật.

Thư mục `xlsx/` chứa 21 workbook **được tạo hoàn toàn bằng dữ liệu tổng hợp**,
không phải bản sao Excel thô. Chúng giữ đúng hình dạng biểu mẫu và các ca lỗi
cần kiểm tra để CI chạy độc lập trên Windows/Linux. `xlsx_manifest.json` ghi
phân loại dữ liệu, kích thước và SHA-256; có thể tái tạo bộ này bằng lệnh
`python tests/generate_synthetic_xlsx_fixtures.py`.

Bộ đối chiếu cần phát hiện tối thiểu các trường hợp: CT04 trống, CT07 nhập chữ,
CT02 dùng dấu phân cách, CT02 có outlier 25.000, CT03 lớn hơn CT01, CT11 lớn hơn
CT02, số điện thoại sai định dạng và ba thôn chưa nộp báo cáo.

Trường hợp dữ liệu thôn Đông Sơn vẫn là điểm chưa được xã xác nhận. Hệ thống
phải hiển thị cờ chất lượng dữ liệu và không tự suy đoán cách phân bổ chính thức.
