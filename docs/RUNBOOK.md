# Runbook triển khai và vận hành

## Nguyên tắc

- Chỉ dùng dữ liệu tổng hợp cho demo/staging.
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
3. Hoàn tất UAT bốn vai trò, keyboard/screen-reader + axe trên browser thật,
   kiểm access log sau rotation và privacy/legal review.
4. Copy `config/production_attestation.example.json` vào secret/ticket quản lý
   release, gắn owner, evidence và timestamp timezone-aware cho mỗi control.
   `scripts/production_gate.py` phải pass trước khi ghi nhận production-ready.

Các script chỉ kiểm chứng thông tin/target được operator cung cấp; chúng không
thay thế approval hay cho phép bỏ qua incident response.

## Rollback/forward-fix

- Không rollback migration phá hủy dữ liệu. Ưu tiên forward-fix migration.
- Nếu health/readiness hoặc smoke test thất bại, dừng traffic vào release mới,
  giữ DB ở phiên bản tương thích và quay lại image/app trước đó.
- Mọi hotfix phải có regression test và ghi audit release.

## Quan sát và cảnh báo

- Theo dõi p95 latency, 4xx/5xx, DB pool, job reminder, queue sync và Gemini
  usage/cost.
- Log có request ID và redaction; không ghi PII/secret.
- Cảnh báo ngay khi secret scan, RLS matrix, backup hoặc reminder job thất bại.
