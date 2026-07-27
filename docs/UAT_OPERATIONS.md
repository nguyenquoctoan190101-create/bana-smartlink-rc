# UAT — năm nhóm người dùng, điều hành và chất lượng dữ liệu

Chạy trên staging mới chỉ chứa dữ liệu synthetic. Ghi người thực hiện, thời gian,
trình duyệt/thiết bị, commit đủ 40 ký tự, kết quả và ảnh chụp không chứa thông
tin cá nhân vào ma trận UAT. Mỗi nhóm phải có người đại diện độc lập xác nhận;
test nội bộ của đội phát triển không thay thế chữ ký UAT.

## 1. Người dân không đăng nhập

1. Xem đúng năm chỉ tiêu công khai của một báo cáo đã công bố; CT14 và thông
   tin cá nhân không xuất hiện.
2. Gửi kiến nghị hợp lệ, nhận mã tra cứu 16 ký tự, tra cứu lại chỉ thấy trạng thái/CT/thời điểm.
3. Gửi quá rate limit; xác nhận trả lỗi rõ ràng và không tạo bản ghi dư.

## 2. Cán bộ thôn

1. Đăng nhập, thấy **Việc của tôi** trong phạm vi được giao; không thấy việc/thôn khác.
2. Chọn kỳ, tải/nhập báo cáo, xem cảnh báo, sửa, xác nhận, gửi và theo dõi trạng
   thái; không có bước xem trước nào tự ghi dữ liệu.
3. Chuyển việc `pending → in_progress → completed`; kiểm tra nhật ký với quản trị.
4. Giá trị thiếu hiển thị là thiếu, không phải `0`; nguồn/quy tắc/phiên bản có mặt.

## 3. Tổ công nghệ số cộng đồng

1. Chỉ thấy thôn được phân công; không xem/sửa được thôn khác bằng giao diện,
   deep-link hoặc gọi API trực tiếp.
2. Hỗ trợ sửa bản nháp trong phạm vi được giao nhưng không duyệt, khóa hoặc công bố.
3. Ngoại tuyến–đồng bộ lại không tạo bản ghi trùng và giữ lại mục bị từ chối kèm
   hướng dẫn xử lý.

## 4. Cán bộ xã

1. Thấy kiến nghị chờ xử lý, SLA 72 giờ và nhãn quá hạn nếu có.
2. Duyệt/từ chối kiến nghị; báo cáo được kiểm tra lại và bản công khai phải được
   duyệt/công bố lại khi có thay đổi.
3. Tạo và duyệt tóm tắt điều hành; xác nhận nội dung gợi ý không tự giao việc,
   không chứa thông tin cá nhân/CT14.
4. Tạo kỳ, phân công, duyệt, khóa, công bố, export và kiểm tra nhật ký thay đổi.

## 5. Lãnh đạo

1. Chỉ đọc tổng quan, tóm tắt điều hành và theo dõi kế hoạch; mọi thao tác làm
   thay đổi dữ liệu trả 403.
2. Màn hình hiển thị phạm vi, kỳ, nguồn, thời điểm cập nhật, phiên bản quy tắc và
   việc/trạng thái tiếp theo.
3. Người thử tìm được việc quá hạn, chất lượng dữ liệu và vấn đề cần quyết định
   trong tối đa 60 giây mà không cần hỗ trợ từ đội phát triển.

## Accessibility và responsive

1. Keyboard-only: focus luôn thấy rõ, không bị modal/header che; Enter/Space kích hoạt nút.
2. 390px, 768px, 1440px: không mất nút quan trọng; touch target tối thiểu 44px.
3. Axe: không còn finding serious/critical; `lang="vi"`, heading/label/status message hoạt động.

## Đo thời gian và tiêu chí công bố

Đo cùng một bộ biểu mẫu và điều kiện cho quy trình cũ và SmartLink ở đủ 10 thôn,
ba lượt độc lập. Bắt đầu khi nhận đủ tệp đầu vào và kết thúc khi báo cáo tổng
hợp sẵn sàng cho người có thẩm quyền xem. Ghi lỗi, thời gian chờ và thao tác
phải làm lại; báo cáo trung vị và khoảng biến thiên.

Chỉ công bố “giảm ít nhất 80%” khi trung vị thực đo đạt ngưỡng và biên bản có
người dùng đại diện ký. Nếu chưa đạt, công bố số đo thật và danh sách điểm nghẽn,
không ngoại suy từ demo hoặc fixture.
