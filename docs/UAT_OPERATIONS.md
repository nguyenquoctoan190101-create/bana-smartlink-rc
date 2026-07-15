# UAT — luồng điều hành, chất lượng dữ liệu và kiến nghị

Chạy trên staging mới chỉ chứa dữ liệu synthetic. Ghi người thực hiện, thời gian,
trình duyệt/thiết bị, kết quả và ảnh chụp không chứa PII vào ma trận UAT.

## Công dân ẩn danh

1. Xem đúng năm chỉ tiêu public của một báo cáo đã publish; CT14 và PII không xuất hiện.
2. Gửi kiến nghị hợp lệ, nhận mã tra cứu 16 ký tự, tra cứu lại chỉ thấy trạng thái/CT/thời điểm.
3. Gửi quá rate limit; xác nhận trả lỗi rõ ràng và không tạo bản ghi dư.

## Cán bộ thôn / Tổ CNSCĐ

1. Đăng nhập, thấy **Việc của tôi** trong phạm vi được giao; không thấy việc/thôn khác.
2. Chuyển việc `pending → in_progress → completed`; kiểm tra audit log với admin.
3. Xem chất lượng dữ liệu: giá trị thiếu hiển thị là thiếu, không phải `0`; source/rule/version có mặt.

## Admin xã

1. Thấy kiến nghị chờ xử lý, SLA 72 giờ và nhãn quá hạn nếu có.
2. Duyệt/từ chối kiến nghị; report được revalidate và public report cần được duyệt/publish lại khi có thay đổi.
3. Tạo và duyệt brief; xác nhận brief không tự giao việc, không chứa PII/CT14.

## Lãnh đạo

1. Chỉ đọc dashboard/brief/scorecard/portfolio; tất cả mutation trả 403.
2. Dashboard hiển thị scope/kỳ/rule version và có action hoặc trạng thái tiếp theo.

## Accessibility và responsive

1. Keyboard-only: focus luôn thấy rõ, không bị modal/header che; Enter/Space kích hoạt nút.
2. 320px, 768px, 1440px: không mất nút quan trọng; touch target tối thiểu 44px.
3. Axe: không còn finding serious/critical; `lang="vi"`, heading/label/status message hoạt động.
