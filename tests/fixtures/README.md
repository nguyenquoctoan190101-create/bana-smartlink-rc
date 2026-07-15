# Bộ dữ liệu kiểm thử tổng hợp

Thư mục `pdfs/` chứa 21 biểu mẫu/báo cáo PDF do ban tổ chức cung cấp cho
BaNa SmartLink. Các tệp chỉ được dùng làm golden fixtures trong kiểm thử, không
được đóng gói vào frontend production và không được coi là dữ liệu dân cư thật.

Bộ đối chiếu cần phát hiện tối thiểu các trường hợp: CT04 trống, CT07 nhập chữ,
CT02 dùng dấu phân cách, CT02 có outlier 25.000, CT03 lớn hơn CT01, CT11 lớn hơn
CT02, số điện thoại sai định dạng và ba thôn chưa nộp báo cáo.

Trường hợp dữ liệu thôn Đông Sơn vẫn là điểm chưa được xã xác nhận. Hệ thống
phải hiển thị cờ chất lượng dữ liệu và không tự suy đoán cách phân bổ chính thức.
