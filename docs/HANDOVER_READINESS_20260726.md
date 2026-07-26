# Đánh giá sẵn sàng bàn giao và lộ trình an toàn — 26/07/2026

## Kết luận điều hành

Ba Na SmartLink đã đạt mức **bản ứng viên phát hành có thể tổ chức thí điểm có
kiểm soát**. Các luồng cốt lõi, phân quyền, kiểm tra dữ liệu, nhật ký, xuất báo
cáo và giao diện năm vai trò đã được triển khai; mã hiện hành vượt qua kiểm thử
tự động, build, kiểm tra hợp đồng API/RLS và kiểm tra phát hành. Kết luận này
không đồng nghĩa hệ thống đã đủ điều kiện sử dụng dữ liệu thật trên diện rộng.

Trước khi cơ quan quyết định đưa vào vận hành chính thức, còn phải hoàn thành
các cổng nằm ngoài mã nguồn: UAT có chữ ký của năm nhóm người dùng, phê duyệt
pháp lý/quyền riêng tư, thay và thu hồi toàn bộ tài khoản/khóa trình diễn, diễn
tập sao lưu–khôi phục, đo tải trên môi trường đích, cấu hình giám sát/cảnh báo và
quyết định chính sách truy cập mạng/IP.

## Những điểm mạnh đã có bằng chứng

| Miền | Trạng thái | Bằng chứng kỹ thuật |
|---|---|---|
| Luồng báo cáo | Đạt ở mức ứng viên phát hành | Chọn kỳ → nhập/xem trước → kiểm tra → sửa → xác nhận → gửi → theo dõi; trạng thái nháp, đã gửi, cần sửa, đã duyệt, đã khóa và công bố |
| Phân quyền | Đạt bằng mã và kiểm thử | Supabase Auth/JWT, vai trò, phạm vi xã/thôn, RLS và RPC; lãnh đạo không sửa báo cáo, chỉ được quyết định yêu cầu thay đổi kỳ qua luồng riêng |
| Dữ liệu công khai | Đạt bằng hợp đồng | Chỉ năm chỉ tiêu được phép công bố; CT14, thông tin người lập và nội dung nội bộ không nằm trong DTO công khai |
| Chất lượng dữ liệu | Đạt bằng quy tắc xác định | Giữ `null` là thiếu, validator chặn lỗi, nguồn/phiên bản/checksum/evidence và chỉnh sửa trước–sau được theo dõi |
| Xóa/chỉnh kỳ | Đạt | Quản trị gửi yêu cầu kèm lý do; lãnh đạo phê duyệt/từ chối; xóa là lưu trữ mềm, lịch sử quyết định không bị sửa âm thầm |
| Giao diện vai trò | Đạt visual QA kỹ thuật | Người dân, cán bộ thôn, CNSCĐ, quản trị và lãnh đạo đã được kiểm tra desktop/mobile; lãnh đạo có ba không gian chính |
| Dashboard lãnh đạo | Đạt ở mức sản phẩm | Dữ liệu đã duyệt/khóa; ma trận ưu tiên, Pareto, bullet, phân tán, cơ cấu, dải tín hiệu và liên kết tới báo cáo nguồn |
| An toàn ứng dụng | Đạt baseline | CSP, HSTS, chống nhúng trang, no-store cho API nghiệp vụ, CORS rõ nguồn, giới hạn tần suất, giới hạn tệp/ZIP/PDF/ảnh, parser XML chống entity bomb |
| Kiểm thử tự động | Đạt trước khi phát hành MFA/IP | Backend 546 kiểm thử; frontend 97 kiểm thử/24 tệp; typecheck, build, bundle budget, Ruff và release scan 489 tệp đều đạt |
| Chuỗi cung ứng | Đạt tại lần kiểm tra 26/07 | `pip-audit` không có lỗ hổng đã biết; `npm audit --omit=dev` có 0 lỗ hổng; Bandit mức cao, secret/release scan và SBOM trong CI |
| CI đa nền tảng | Đạt | GitHub Actions run `30206056071`: supply-chain, Ubuntu, Windows và database-contract đều hoàn tất thành công |
| Tải đọc giới hạn | Đạt ngày 26/07 | 100/100 yêu cầu ở concurrency 10 cho từng endpoint: p95 live 602 ms, ready 437 ms, dữ liệu công khai 582 ms; ngưỡng 2.000 ms. Chưa thay thế tải ghi và tải nghiệp vụ có xác thực |

## Trạng thái bảo vệ địa chỉ IP và mạng

### Những gì đang có

- Dịch vụ Render nhận HTTPS qua bộ cân bằng tải của nền tảng; container không
  mở trực tiếp cổng ứng dụng ra Internet.
- Ứng dụng dùng CORS với đúng origin triển khai, CSP/HSTS, JWT và RLS. Đây là
  các lớp bảo vệ danh tính và dữ liệu, không phải IP allowlist.
- Ứng dụng đã có cổng CIDR tùy chọn: khi cấu hình
  `INTERNAL_ALLOWED_IP_CIDRS`, `/app` và mọi yêu cầu mang bearer token chỉ được
  nhận từ mạng cho phép, trong khi endpoint người dân vẫn công khai. Cổng chưa
  bật trên Render vì cơ quan chưa cung cấp dải IP/VPN được phê duyệt.
- `FORWARDED_ALLOW_IPS="*"` trong Blueprint chỉ cho Uvicorn tin proxy phía trước
  để đọc đúng thông tin chuyển tiếp. Giá trị này **không có nghĩa chỉ các IP
  được phép mới vào hệ thống**.
- `render.yaml` hiện không khai báo `ipAllowList`; vì vậy web service vẫn nhận
  kết nối công khai. Trạng thái network restriction của Supabase không thể suy
  ra từ mã nguồn và phải được chủ dự án kiểm tra trong Dashboard/CLI.

### Vì sao không nên khóa toàn bộ dịch vụ theo IP ngay lúc này

Cùng một web service đang phục vụ cả cổng người dân không cần tài khoản và khu
vực nội bộ. Nếu allowlist toàn dịch vụ theo IP văn phòng, người dân sẽ không thể
xem dữ liệu công khai, gửi phản ánh hoặc tra cứu. IP di động của cán bộ cũng có
thể thay đổi, gây tự khóa người dùng hợp lệ.

### Kiến trúc bảo vệ được đề xuất

1. **Ngắn hạn trước thí điểm:** thay toàn bộ tài khoản demo; mật khẩu riêng từng
   người; buộc đổi mật khẩu; thời hạn phiên hợp lý; rà nhật ký đăng nhập; khóa
   tài khoản nghỉ/chuyển việc; bật cảnh báo lỗi và truy cập bất thường.
2. **Bắt buộc cho quản trị/lãnh đạo:** triển khai MFA và yêu cầu `aal2` cho các
   thao tác nhạy cảm. IP không thay thế MFA.
3. **Tách đường công khai và nội bộ:** dùng miền công khai cho người dân, miền
   nội bộ hoặc cổng Zero Trust cho `/app` và API nghiệp vụ. Áp dụng danh tính,
   thiết bị và phiên, thay vì chỉ một IP tĩnh.
4. **Nếu đơn vị có VPN/IP tĩnh:** allowlist IP VPN/văn phòng ở lớp edge cho miền
   nội bộ. Trên Render, inbound IP rules của web service cần gói hỗ trợ tương
   ứng; nếu vẫn dùng một service phải tách public/internal trước.
5. **Bảo vệ cơ sở dữ liệu:** bật Supabase Network Restrictions cho Postgres và
   pooler, chỉ cho phép nguồn egress đã phê duyệt. Nếu cần IP egress cố định từ
   Render, dùng Dedicated IP hoặc một gateway/VPN được quản trị.
6. **Không cho đi vòng qua lớp bảo vệ:** nếu dùng Cloudflare/Zero Trust/WAF,
   phải chặn truy cập trực tiếp vào origin `onrender.com` hoặc tách API private;
   nếu không, người tấn công có thể bỏ qua lớp edge qua URL gốc.

## Các cổng còn mở trước dữ liệu thật

| Cổng | Hiện trạng | Điều kiện đóng cổng |
|---|---|---|
| UAT năm vai trò | Chưa có biên bản ký | Mỗi vai trò thực hiện kịch bản chính, ghi lỗi, kết luận và chữ ký |
| Bảo mật tài khoản | TOTP MFA đã bắt buộc bằng `aal2` cho quản trị/lãnh đạo; tài khoản demo còn phục vụ kiểm thử | Từng người quét mã bằng ứng dụng xác thực; thu hồi demo, tạo tài khoản định danh và hoàn tất quy trình joiner–mover–leaver |
| IP/Zero Trust | Cổng CIDR đã có trong mã, chưa điền allowlist trên Render | Cung cấp dải IP/VPN đã phê duyệt hoặc chọn Zero Trust; thử khóa, truy cập di động và phương án khôi phục |
| Quyền riêng tư/pháp lý | Chưa có phê duyệt chính thức | Chủ quản dữ liệu phê duyệt notice, mục đích, thời hạn lưu, quyền của chủ thể và xử lý sự cố |
| Sao lưu/khôi phục | Đã có smoke lịch sử, chưa có drill cho bản phát hành cuối | Backup có hash, restore vào môi trường biệt lập, kiểm số đếm và RPO/RTO |
| Hiệu năng | Đạt tải đọc giới hạn 100 yêu cầu/concurrency 10; chưa có tải ghi/xác thực theo nghiệp vụ | Định nghĩa số người dùng đồng thời và SLO, chạy kịch bản kỳ cao điểm trên staging, đo p50/p95/error rate và dung lượng DB |
| Giám sát/sự cố | Mã hỗ trợ Sentry/log, cấu hình owner chưa được xác nhận | Dashboard, cảnh báo, trực ca, runbook, diễn tập và kênh báo sự cố |
| OCR ảnh/PDF | Chủ động tắt ngoài production | Chỉ mở sau bộ dữ liệu benchmark, privacy review, redaction và giới hạn chi phí |
| Độ chính xác/hiệu quả | Chưa có đo thực địa | Không công bố tỷ lệ chính xác hoặc giảm thời gian cho đến khi có dữ liệu đo và chữ ký |

## Lộ trình đưa vào sử dụng

### Giai đoạn 0 — chốt ứng viên phát hành

- CI đa nền tảng và smoke Render đã gắn đúng ứng viên `cf3dc20`; khi có commit
  mới phải lặp lại phép kiểm tra full SHA trước bàn giao.
- Chốt danh sách tài khoản, phân công thôn, dữ liệu minh họa và người chịu trách
  nhiệm.
- Không nhập thông tin cá nhân thật; giữ OCR ngoài ở trạng thái tắt.

### Giai đoạn 1 — thí điểm đóng có kiểm soát

- 1–2 kỳ báo cáo với nhóm người dùng hạn chế; sao lưu trước mỗi kỳ.
- MFA cho quản trị/lãnh đạo; giám sát lỗi và truy cập; hỗ trợ trực tiếp.
- Ghi thời gian xử lý, lỗi nghiệp vụ, tỷ lệ hoàn thành và phản hồi người dùng.
- Chỉ mở rộng khi không còn lỗi nghiêm trọng và UAT được ký.

### Giai đoạn 2 — vận hành chính thức

- Phê duyệt dữ liệu thật, retention và quy trình sự cố.
- Tách/bao bọc khu vực nội bộ bằng Zero Trust/VPN; hạn chế mạng DB.
- Backup định kỳ và phục hồi được kiểm chứng; theo dõi p95, lỗi và chi phí.
- Đánh giá hàng quý về quyền truy cập, nhật ký, rủi ro và các cờ tính năng.

## Nguyên tắc truyền thông khi bàn giao

Nên nhấn mạnh các kết quả đã có bằng chứng: sản phẩm đầy đủ luồng cốt lõi, phân
quyền nhiều lớp, dữ liệu có nguồn, dashboard phục vụ quyết định và kiểm thử tự
động rộng. Các nội dung chưa đủ bằng chứng được trình bày như cổng kiểm soát và
lộ trình triển khai. Không dùng các từ “đã xác minh”, “chính xác”, “thời gian
thực”, “tự động” hay “production-ready” nếu chưa có phép đo/phê duyệt tương ứng.
