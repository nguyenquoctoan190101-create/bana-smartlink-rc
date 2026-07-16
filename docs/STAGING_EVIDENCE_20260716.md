# Bằng chứng nâng cấp và UAT staging - 16/07/2026

## Phiên bản đã triển khai

- Nhánh phát hành: `main`.
- Commit cuối: `7890b18fed5bf9149ff2f3c9aa1825d8a8b61867`.
- Pull request dữ liệu: `#1` (merged).
- Pull request phục hồi lazy chunk: `#2` (merged).
- GitHub Actions: `https://github.com/nguyenquoctoan190101-create/bana-smartlink-rc/actions/runs/29511101180`.
- Render: `https://bana-smartlink-rc-toan-2026.onrender.com/`.
- Bundle được xác minh: `/assets/index-DozboyjC.js`; readiness trả HTTP 200.

## Backup và restore smoke

- Backup custom archive được tạo trước migration: `bana-smartlink-pre-migration-20260716-193007.dump`.
- Kích thước: 349.249 byte.
- SHA-256: `cf9065f1dfcccaeff10dd63abfce72580540e470f7e09bd756d973199f51e393`.
- `pg_restore --list`: 607 mục, archive đọc được.
- Restore smoke trên PostgreSQL 17 biệt lập đạt với số đếm: 10 thôn, 1 kỳ, 10 báo cáo, 140 giá trị, 1 hồ sơ người dùng.
- File backup được giữ ngoài gói phát hành và không đưa credential vào báo cáo.

## Migration, seed và hậu kiểm Supabase

- Preflight: `reports`, `pending_updates`, `action_items` đều tồn tại; 10 thôn, 1 kỳ, 10 báo cáo.
- Migration `20260715_0004` đến `20260715_0007`: áp dụng thành công theo thứ tự.
- Seed mapping: 10 thôn mới và 24 mục lịch sử (22 thôn cũ + 2 khu tái định cư).
- Hậu kiểm: 10 thôn mới, 22 thôn cũ, 2 khu tái định cư, 1 mapping chờ quyết định, 10 báo cáo và 140 giá trị.
- Đông Sơn: target chính thức là `null`, target đề xuất có giá trị, trạng thái `pending_official_decision`.
- ACL Supabase: anonymous và service role không được gọi helper import/validator; authenticated chỉ được gọi RPC commit đã kiểm quyền.

## Đối chiếu 19 workbook trên API thật

- API preview trả HTTP 200.
- Số nguồn mong đợi: 22; số workbook nhận được: 19.
- Thiếu đúng: Thạch Nham Tây, Ninh An, Sơn Phước.
- Đông Sơn bị khóa do chưa có quyết định chính thức.
- Không có thôn trùng lặp; 6 workbook có lỗi chặn; bộ tệp đủ điều kiện chuyển sang kiểm duyệt.
- Preview không ghi dữ liệu vào staging. Không lưu PII từ workbook nguồn trong bước UAT này.

## Ma trận JWT và public privacy

Các tài khoản tổng hợp tạm thời được tạo chỉ để kiểm thử rồi xóa hoàn toàn sau khi hoàn tất.

| Principal | Bằng chứng |
|---|---|
| Anonymous | `/auth/me` trả 401; public report trả 200 và không chứa CT14/số điện thoại |
| `can_bo_thon` | `/auth/me` trả đúng role; UI chỉ có 1 báo cáo/thôn; `/auth/officers` trả 403 |
| `to_cnscd` | UI chỉ có 2 báo cáo thuộc hai thôn được phân công |
| `lanh_dao` | UI đọc brief toàn xã/10 báo cáo; import preview trả 403 |
| `admin_xa` | `/auth/officers` trả 200; import preview 19/22 trả 200 |

Số tài khoản UAT còn lại sau cleanup: 0.

## Lỗi phát hiện trong UAT và hồi quy

1. CI PostgreSQL trước đây không bật `ON_ERROR_STOP`, có thể xanh dù SQL báo lỗi. Tất cả lệnh `psql` đã fail-closed; fixture RLS được bọc transaction và rollback.
2. Supabase snapshot giữ grant trực tiếp trên function dù đã revoke PUBLIC. Migration `0007` thu hồi rõ `anon`, `authenticated`, `service_role`, sau đó chỉ cấp RPC commit cho `authenticated`.
3. Tab chạy bundle cũ có thể gọi lazy chunk đã bị Render thay. Ứng dụng nay tự tải lại đúng một lần, có guard chống vòng lặp và 3 regression test.

## Các gate ngoài mã nguồn còn mở

- Privacy/legal review và phê duyệt notice/retention của đơn vị chịu trách nhiệm.
- Biên bản UAT khách hàng và phê duyệt phát hành dữ liệu thật.
- Quyết định chính thức về phần Đông Sơn và ba workbook nguồn còn thiếu.
- Xác nhận rotate/revoke toàn bộ credential từng xuất hiện trong các gói cũ và rà access log bởi chủ tài khoản.

Bản triển khai tiếp tục là release candidate dùng dữ liệu tổng hợp; bằng chứng này không thay thế phê duyệt production.
