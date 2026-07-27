# Hướng dẫn sử dụng Ba Na SmartLink

Hướng dẫn này dùng cho đào tạo và UAT với dữ liệu tổng hợp. Không ghi mật khẩu,
secret, số điện thoại thật hoặc thông tin cá nhân vào tài liệu hay ảnh chụp.
Quyền chi tiết xem [ma trận phân quyền](RBAC_MATRIX.md).

## Bắt đầu và kết thúc phiên

1. Mở địa chỉ do quản trị cung cấp và kiểm tra đúng tên miền.
2. Người dùng nội bộ đăng nhập bằng tài khoản riêng; đổi mật khẩu khi hệ thống
   yêu cầu. Không dùng chung tài khoản giữa các thôn hoặc vai trò.
3. Kiểm tra kỳ báo cáo và thôn đang chọn trước mỗi thao tác.
4. Khi hoàn tất, đăng xuất; không để phiên đăng nhập trên thiết bị dùng chung.
5. Nếu thấy dữ liệu ngoài phạm vi hoặc thông tin cá nhân ở trang công khai, dừng
   thao tác, không chụp/chia sẻ thêm và báo quản trị theo
   [quy trình sự cố](SECURITY_INCIDENT_RESPONSE.md).

## Người dân — không cần tài khoản

### Xem dữ liệu

1. Chọn thôn và kỳ đã công bố.
2. Kiểm tra kỳ dữ liệu, nguồn và thời điểm cập nhật.
3. Trang công khai chỉ hiển thị CT01, CT02, CT09, CT12 và CT13. CT14, thông tin
   người lập và ghi chú nội bộ không được hiển thị.

### Gửi phản ánh hoặc kiến nghị

1. Mở biểu mẫu công khai, chọn nội dung và nhập tối thiểu dữ liệu cần thiết.
2. Đọc thông báo quyền riêng tư rồi xác nhận gửi.
3. Lưu mã tra cứu 16 ký tự tại nơi riêng. Mã này không phải tài khoản hoặc OTP.
4. Dùng trang tra cứu để xem trạng thái chung. Kết quả không lặp lại nội dung
   thông tin cá nhân đã gửi.

Không gửi mật khẩu, giấy tờ định danh, ảnh không liên quan hoặc dữ liệu CT14 qua
ô nội dung tự do.

## Cán bộ hoặc trưởng thôn — `can_bo_thon`

Luồng chuẩn là: **chọn kỳ → tải/nhập → kiểm tra → sửa → xác nhận → gửi → theo
dõi trạng thái**.

1. Mở “Việc của tôi”, xác nhận đúng thôn và hạn xử lý.
2. Chọn kỳ; nhập trực tiếp hoặc xem trước biểu mẫu Excel `.xlsx`.
3. Đối chiếu từng trường với vùng nguồn. Giá trị thiếu phải giữ là thiếu, không
   đổi thành `0` nếu chưa có căn cứ.
4. Sửa trường sai, ghi lý do khi được yêu cầu và xử lý toàn bộ lỗi chặn.
5. Xác nhận nguồn, phiên bản biểu mẫu/quy tắc và gửi báo cáo.
6. Theo dõi trạng thái `nháp → đã gửi → cần sửa/đã duyệt → đã khóa`.
7. Khi bị yêu cầu sửa, đọc lý do, cập nhật đúng phiên bản mới nhất rồi gửi lại.

Không mở deep-link hoặc gọi API của thôn khác. Nếu hệ thống hiển thị nhầm phạm
vi, dừng làm việc và báo quản trị.

## Tổ công nghệ số cộng đồng/điều phối — `to_cnscd`

1. Mở danh sách thôn/công việc được phân công.
2. Hỗ trợ cán bộ kiểm tra biểu mẫu, lỗi dữ liệu và đồng bộ bản nháp.
3. Khi làm ngoại tuyến, xác nhận mục đã lưu trên thiết bị; sau khi có mạng, đồng
   bộ từng mục và xử lý mục bị từ chối. Không xóa hàng đợi chỉ để hết cảnh báo.
4. Không duyệt, khóa, công bố, quản trị tài khoản hoặc tự thay quyết định của cán
   bộ chịu trách nhiệm.

## Cán bộ xã — `admin_xa`

1. Tạo kỳ và biểu mẫu; kiểm tra danh sách thôn, hạn nộp và phạm vi áp dụng.
2. Tạo/kích hoạt tài khoản theo nguyên tắc quyền tối thiểu; không gửi mật khẩu
   qua tài liệu bàn giao.
3. Phân công thôn/công việc, theo dõi báo cáo thiếu, muộn hoặc có lỗi.
4. Với báo cáo đã gửi: đọc nguồn và cảnh báo, yêu cầu sửa hoặc duyệt; chỉ khóa
   và công bố khi đủ căn cứ.
5. Với kiến nghị: đối chiếu giá trị trước/sau, phê duyệt hoặc từ chối và kiểm
   tra nhật ký thao tác.
6. Nhập dữ liệu cũ theo lô chỉ sau khi review từng tệp và lineage; không tự suy
   đoán trường hợp Đông Sơn còn chờ quyết định.
7. Kiểm tra audit log, tài khoản bất thường, lỗi đồng bộ và cảnh báo vận hành.

## Cán bộ xã và lãnh đạo

Hệ thống không có role kỹ thuật riêng tên `can_bo_xa`. Mỗi cán bộ xã được cấp
`admin_xa` nếu thực sự làm nhiệm vụ quản trị, hoặc `lanh_dao` nếu chỉ cần đọc.
Không cấp `admin_xa` mặc định cho mọi cán bộ.

Với `lanh_dao`:

1. Chọn một trong ba không gian: Tổng quan điều hành, Công việc và cảnh báo,
   Báo cáo và quyết định; dùng thanh chức năng con trong từng không gian để đi
   sâu tới tra cứu, căn cứ và các báo cáo chi tiết.
2. Kiểm tra phạm vi, kỳ, nguồn, độ mới và phiên bản quy tắc.
3. Đi từ vấn đề quá hạn tới căn cứ chi tiết; chỉ dùng dữ liệu đã được duyệt.
4. Xuất báo cáo trong phạm vi được cấp. Mọi thao tác thay đổi dữ liệu phải bị
   chặn; gửi yêu cầu cho quản trị thay vì mượn tài khoản.

## Khi gặp lỗi

| Tình huống | Cách xử lý an toàn |
|---|---|
| Không đăng nhập được | Kiểm tra đúng tên miền/kết nối; nhờ quản trị kiểm trạng thái tài khoản. Không gửi mật khẩu qua chat |
| Trang báo chưa sẵn sàng | Chờ rồi tải lại; quản trị kiểm `/health/live` và `/health/ready` theo [runbook](RUNBOOK.md) |
| Ảnh/PDF không được nhận | Đây là khóa bảo vệ dữ liệu cá nhân của bản staging/production; dùng Excel hoặc nhập trực tiếp |
| Báo cáo xung đột phiên bản | Tải phiên bản mới nhất, đối chiếu và gửi lại; không ghi đè mù |
| Đồng bộ ngoại tuyến bị từ chối | Giữ mục trong hàng đợi, đọc lỗi phạm vi/phiên bản và sửa từng mục |
| Thấy dữ liệu không thuộc phạm vi | Dừng, đăng xuất, ghi thời điểm/URL không chứa nội dung nhạy cảm và báo sự cố |

Quản trị triển khai và khôi phục dùng [RUNBOOK.md](RUNBOOK.md); kịch bản đào tạo
và xác nhận người dùng nằm tại [DEMO_AND_HANDOVER_SCRIPT.md](DEMO_AND_HANDOVER_SCRIPT.md)
và [UAT_OPERATIONS.md](UAT_OPERATIONS.md).
