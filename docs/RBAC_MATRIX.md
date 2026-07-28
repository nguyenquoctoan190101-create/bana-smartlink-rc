# Ma trận phân quyền Ba Na SmartLink

Tài liệu này mô tả quyền nghiệp vụ để bàn giao và UAT. Nguồn kiểm chứng kỹ
thuật chi tiết là [route authorization inventory](../tests/route_authorization_inventory.json),
[RLS matrix](../tests/sql/rls_matrix.sql), [kiến trúc](ARCHITECTURE.md) và
[threat model](THREAT_MODEL.md). Giao diện ẩn nút không thay thế kiểm quyền ở
FastAPI và Row Level Security trong PostgreSQL.

## Nguyên tắc

- Cấp quyền tối thiểu theo nhiệm vụ, xã và thôn; không chia sẻ tài khoản.
- Người dân không có tài khoản, không xác thực số điện thoại và không nhận một
  vai trò nội bộ.
- JWT xác nhận phiên đăng nhập; hồ sơ trong database quyết định vai trò, phạm vi
  thôn, trạng thái hoạt động và yêu cầu đổi mật khẩu.
- Backend kiểm quyền trước khi truy vấn; RLS tiếp tục chặn truy cập chéo ngay cả
  khi request hoặc giao diện bị sửa.
- `service_role` không phải vai trò người dùng và không được đưa vào trình
  duyệt. Tác vụ nghiệp vụ báo cáo dùng JWT của người đang thao tác.
- CT14, thông tin cá nhân, tệp nguồn và ghi chú nội bộ không xuất hiện trong
  projection công khai.
- Mọi quyền duyệt, khóa, công bố, phân công và quản trị phải có nhật ký; trợ lý
  AI không được thực hiện các quyền này.

## Nhóm truy cập kỹ thuật

| Nhóm sử dụng | Principal/role kỹ thuật | Phạm vi |
|---|---|---|
| Người dân | Anonymous, không tài khoản | Dữ liệu đã công bố gồm CT01, CT02, CT09, CT12, CT13; gửi phản ánh/kiến nghị và tra cứu trạng thái đã lọc |
| Cán bộ hoặc trưởng thôn | `can_bo_thon` | Báo cáo, công việc và dữ liệu đúng thôn được gán |
| Tổ công nghệ số cộng đồng/điều phối hỗ trợ | `to_cnscd` | Hỗ trợ các thôn được phân công; không duyệt, khóa hoặc công bố |
| Cán bộ xã | `admin_xa` | Quản trị trong đúng xã: kỳ, tài khoản, phân công, duyệt, khóa, công bố, nhập cũ và audit |
| Lãnh đạo | `lanh_dao` | Đọc dữ liệu nội bộ và xuất báo cáo được phép; chỉ ghi quyết định chấp thuận/từ chối yêu cầu thay đổi kỳ |

“Cán bộ xã”, “trưởng thôn” và “điều phối” là chức danh/ngữ cảnh nghiệp vụ, không
phải role mới. Chủ hệ thống phải ánh xạ mỗi người vào một trong bốn role nội bộ
trên theo nhiệm vụ thực tế; không tạo role rộng hơn chỉ để tiện vận hành.

## Ma trận quyền nghiệp vụ

Ký hiệu: `Xem` là đọc; `Ghi` là tạo/sửa trong phạm vi; `—` là bị từ chối.

| Năng lực | Người dân | `can_bo_thon` | `to_cnscd` | `admin_xa` | `lanh_dao` |
|---|---:|---:|---:|---:|---:|
| Xem năm chỉ tiêu đã công bố | Xem | Xem | Xem | Xem | Xem |
| Xem CT14 hoặc báo cáo nội bộ | — | Xem đúng thôn | Xem thôn được giao | Xem trong xã | Xem trong xã |
| Gửi/tra cứu kiến nghị công khai | Ghi/Xem trạng thái đã lọc | Như người dân | Như người dân | Như người dân | Như người dân |
| Tạo, sửa, gửi báo cáo | — | Ghi đúng thôn | Hỗ trợ thôn được giao | — | — |
| Xem trước Excel | — | Đúng phạm vi | Đúng phạm vi hỗ trợ | Trong xã | — |
| OCR ảnh/PDF qua dịch vụ ngoài | — | Khóa | Khóa | Khóa | — |
| Duyệt, yêu cầu sửa, khóa, công bố | — | — | — | Ghi | — |
| Tạo kỳ, biểu mẫu và quản trị tài khoản | — | — | — | Ghi | — |
| Quyết định yêu cầu thay đổi/lưu trữ kỳ | — | — | — | Gửi yêu cầu | Phê duyệt/Từ chối |
| Nhập dữ liệu cũ theo lô | — | — | — | Ghi | — |
| Xem trung tâm chất lượng/công việc | — | Đúng thôn/việc | Thôn/việc được giao | Trong xã | Trong xã |
| Giao việc và cấu hình quản trị | — | — | — | Ghi | — |
| Xem audit log | — | — | — | Xem | — |
| Xuất báo cáo nội bộ | — | Theo endpoint được cấp | Theo endpoint được cấp | Xem/Xuất | Xem/Xuất |
| Quản trị mô hình thử nghiệm | — | — | — | Ghi | Chỉ xem khi được bật |

Quyền chính xác theo từng endpoint nằm trong
[`tests/route_authorization_inventory.json`](../tests/route_authorization_inventory.json);
ma trận trên không mở rộng quyền so với inventory đó.

## Kiểm tra bắt buộc trước phát hành

1. Anonymous không đọc CT14, thông tin cá nhân, export nội bộ hoặc endpoint
   mutation có xác thực.
2. Hai cán bộ thuộc hai thôn khác nhau không đọc hoặc ghi chéo báo cáo, công
   việc, kiến nghị nội bộ hay tệp nguồn.
3. `to_cnscd` chỉ truy cập thôn được phân công và luôn bị chặn khi duyệt, khóa,
   công bố hoặc quản trị tài khoản.
4. `admin_xa` quản trị kỳ và vòng đời báo cáo nhưng không nhập thay dữ liệu
   nghiệp vụ theo luồng chuẩn của thôn.
5. `lanh_dao` đọc được phạm vi được cấp; mọi mutation trả 403, ngoại trừ
   quyết định chấp thuận/từ chối yêu cầu thay đổi kỳ qua endpoint dành riêng
   cho lãnh đạo và có nhật ký kiểm toán.
6. `admin_xa` của xã A không truy cập dữ liệu xã B.
7. Tài khoản bị khóa hoặc hồ sơ không hoạt động không tiếp tục dùng JWT cũ để
   truy cập nghiệp vụ.
8. Chạy RLS matrix trên PostgreSQL/Supabase staging thật; unit test mô phỏng
   không thay thế bằng chứng này.

Kịch bản UAT tương ứng nằm tại [UAT_OPERATIONS.md](UAT_OPERATIONS.md). Mọi ngoại
lệ tạm thời phải có owner, thời hạn, đánh giá rủi ro và phê duyệt bằng văn bản;
không sửa ma trận để hợp thức hóa một cấu hình rộng quyền.
