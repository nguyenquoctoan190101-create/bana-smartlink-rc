# Kịch bản demo và bàn giao BaNa SmartLink

## Trước buổi demo

1. Mở `/health/live` và `/health/ready`; cả hai phải trả trạng thái đạt.
2. Xác nhận footer/brief ghi rõ release candidate và dữ liệu minh họa.
3. Dùng cửa sổ ẩn danh cho cổng người dân; dùng profile trình duyệt riêng cho admin.
4. Không hiển thị Supabase key, connection string, email thật hoặc terminal có secret.

## Luồng 1 - Người dân

1. Chọn một trong 10 thôn và kỳ minh họa.
2. Chỉ ra đúng năm chỉ tiêu public: CT01, CT02, CT09, CT12, CT13.
3. Gửi một kiến nghị bằng dữ liệu giả, đồng ý privacy notice và lưu mã tra cứu.
4. Tra cứu mã; kết quả chỉ hiển thị trạng thái chung, không lặp lại PII.

## Luồng 2 - Admin xử lý kiến nghị

1. Đăng nhập admin tổng hợp.
2. Mở Duyệt kiến nghị, đối chiếu giá trị cũ/mới, phê duyệt hoặc từ chối.
3. Chỉ ra audit log có actor/action/record/time và không ghi nội dung PII.
4. Quay lại trang tra cứu công dân để chứng minh trạng thái đã cập nhật.

## Luồng 3 - Nhập dữ liệu 22 sang 10

1. Tạo/chọn kỳ thử nghiệm chưa công bố.
2. Tải bộ 19 workbook được cung cấp.
3. Giải thích ba nguồn thiếu và Đông Sơn chờ quyết định.
4. Sửa/xác nhận sáu chênh lệch theo chứng cứ; mọi quyết định phải có lý do.
5. Chỉ ra sáu nhóm đủ nguồn; bốn nhóm chưa đủ không được tạo báo cáo một phần.
6. Chốt batch và kiểm tra lineage SHA-256/source/version.

## Luồng 4 - Cán bộ thôn và CNSCĐ

1. Cán bộ thôn chỉ xem/tạo/sửa báo cáo của thôn mình.
2. CNSCĐ chỉ xem các thôn được phân công và không có quyền duyệt/publish.
3. Thử truy cập deep-link ngoài phạm vi; hệ thống phải trả 403/empty scoped response.

## Luồng 5 - Lãnh đạo

1. Mở brief quyết định, chất lượng dữ liệu và tiến độ 10 thôn.
2. Chỉ ra scope, kỳ, nguồn, rule version và trạng thái chất lượng.
3. Thử thao tác mutation; phải bị chặn.

## Gói bàn giao

- `BaNaSmartLink_fixed.zip`: mã nguồn sạch, không `.env`, cache, DB local hoặc fixture PII.
- Audit JSON và workbook đối chiếu ngoài mã nguồn.
- Báo cáo kỹ thuật/bảo mật Markdown và PDF.
- Ma trận truy vết, test report, coverage/JUnit, SBOM.
- Runbook, hướng dẫn staging, backup/restore, incident response.
- Link PR và GitHub Actions evidence.

## Biên bản xác nhận khách hàng

Ghi riêng các mục: người nhận, phiên bản/commit, môi trường, dữ liệu synthetic hay thật, danh sách tài khoản bàn giao, credential được chuyển qua kênh bí mật, kết quả UAT, vấn đề còn mở, owner và thời hạn. Không đưa mật khẩu hoặc secret vào biên bản.

