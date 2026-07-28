# Runbook triển khai và vận hành

## Nguyên tắc

- Chỉ dùng dữ liệu tổng hợp cho demo/staging.
- GitHub `main` là nguồn mã duy nhất; ZIP là hiện vật tạo từ đúng commit, không
  phải nguồn để tiếp tục phát triển.
- Không sử dụng bất kỳ credential nào có trong gói nguồn ban đầu.
- Migration phải chạy và được kiểm tra trước khi chuyển traffic.
- Không gọi hệ thống là production-ready nếu chưa qua RLS integration test,
  UAT, backup/restore và rà soát bảo mật.

## Chuẩn bị môi trường

1. Tạo Supabase project/staging mới và credential mới.
2. Sao chép `.env.example` sang secret store của nền tảng; không tạo `.env`
   trong artifact phát hành.
3. Chạy canonical migrations từ đầu trên DB trắng.
4. Seed danh mục 10 thôn và dữ liệu tổng hợp có nhãn `synthetic`.
5. Build frontend rồi khởi động FastAPI; kiểm tra `/health/live` và
   `/health/ready`.

## Smoke test sau triển khai

- Anonymous chỉ thấy CT01, CT02, CT09, CT12, CT13 của bản đã publish.
- Anonymous không thể gọi submit, upload, export nội bộ, approve, notification
  hoặc push.
- Cán bộ thôn không đọc/ghi được thôn khác.
- Lãnh đạo không thực hiện được mutation.
- Admin tạo kỳ, cán bộ nộp, admin duyệt/khóa/publish và public portal cập nhật.
- Export nội bộ yêu cầu Authorization và không bị formula injection.
- Queue offline giữ lại item reject và hiển thị lỗi có thể xử lý.

## Backup và phục hồi

- Backup DB tự động tối thiểu hằng ngày; RPO mục tiêu 24 giờ.
- Mỗi release phải có restore smoke test trên môi trường cô lập; RTO mục tiêu
  4 giờ.
- File template/export trong object storage phải có versioning và lifecycle.
- Dùng `scripts/backup_restore_smoke.py` để tạo custom archive và kiểm tra nó
  đọc được trước mỗi release. Chỉ chạy `--restore` với database biệt lập có tên
  stage/test/restore, `BANA_BACKUP_RESTORE_APPROVED=YES` và cờ xác nhận phá hủy.

## Gate staging và xác nhận production

1. Chạy `scripts/staging_release_gate.py --run-rls` trên DB staging trống/biệt
   lập; script từ chối `DATABASE_URL`, yêu cầu `STAGING_DATABASE_URL` khác DB
   ứng dụng và `BANA_STAGING_RLS_APPROVED=YES`.
2. Chạy `scripts/performance_smoke.py --base-url <staging-origin>`; lưu output
   p50/p95 cùng thời điểm và cấu hình tải vào ticket release.
3. Hoàn tất UAT năm nhóm người dùng theo `docs/UAT_OPERATIONS.md`,
   keyboard/screen-reader + axe trên trình duyệt thật, kiểm access log sau
   rotation và privacy/legal review.
4. Copy `config/production_attestation.example.json` vào secret/ticket quản lý
   release; đổi khóa UAT cũ `uat_four_roles` thành `uat_five_principals`, rồi
   gắn owner, evidence và timestamp timezone-aware cho mỗi control.
   `scripts/production_gate.py` tạm chấp nhận khóa cũ để đọc hồ sơ lịch sử,
   nhưng bằng chứng mới phải bao phủ đủ năm nhóm. Gate phải đạt trước khi ghi
   nhận production-ready.

Các script chỉ kiểm chứng thông tin/target được operator cung cấp; chúng không
thay thế approval hay cho phép bỏ qua incident response.

## Xác nhận đúng commit sau triển khai

Lấy SHA đủ 40 ký tự từ commit `main` đã phát hành, chờ Render kết thúc rồi bắt
buộc `/health/live` báo đúng SHA:

```powershell
$expected = git rev-parse HEAD
python scripts/production_sha_smoke.py `
  --base-url https://bana-smartlink-rc-toan-2026.onrender.com `
  --expected-commit $expected
```

Chỉ sau khi gate này đạt mới chạy smoke test nghiệp vụ và responsive
360/768/1280px cùng phóng chữ 200%. Không dùng tên release, thời gian triển khai hoặc short SHA làm bằng
chứng phiên bản production.

## Retention và chuyển hạ tầng

- Tệp xem trước chưa cam kết có mục tiêu xóa trong tối đa 7 ngày; phải có bằng
  chứng job và log xóa trước khi bật dữ liệu thật.
- Báo cáo đã cam kết, thông tin cá nhân, media, audit và backup tuân theo lịch
  được đơn vị có thẩm quyền phê duyệt; legal hold được ưu tiên.
- Khi rời Render/Supabase, giữ ranh giới React/Vite → FastAPI →
  PostgreSQL/RLS và chạy lại toàn bộ migration, RLS, backup/restore, hiệu năng,
  UAT trước khi chuyển traffic.
- Chi tiết phát hành, OPEX và bàn giao nằm trong
  `docs/DELIVERY_GOVERNANCE.md`.

## Rollback/forward-fix

- Không rollback migration phá hủy dữ liệu. Ưu tiên forward-fix migration.
- Nếu health/readiness hoặc smoke test thất bại, dừng traffic vào release mới,
  giữ DB ở phiên bản tương thích và quay lại image/app trước đó.
- Mọi hotfix phải có regression test và ghi audit release.

## Quan sát và cảnh báo

- Theo dõi p95 latency, 4xx/5xx, DB pool, job reminder, queue sync và Gemini
  usage/cost.
- Nhật ký có mã yêu cầu và che dữ liệu; không ghi thông tin cá nhân hoặc secret.
- Cảnh báo ngay khi secret scan, RLS matrix, backup hoặc reminder job thất bại.
