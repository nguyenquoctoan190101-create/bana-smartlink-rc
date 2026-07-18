# BaNa SmartLink

Nền tảng báo cáo chỉ tiêu thôn của xã Bà Nà. Kiến trúc được hỗ trợ là:

```text
React/Vite -> FastAPI -> Supabase Auth + PostgreSQL/RLS
                         \-> Gemini (chỉ OCR và diễn giải)
```

Không sử dụng Express, Firebase, tài khoản/OTP cho công dân hoặc kênh Zalo. Gemini
không quyết định báo cáo hợp lệ; `services/validator.py` và
`config/validation_rules.json` là nguồn quy tắc nghiệp vụ.

> Trạng thái phát hành: release candidate dùng dữ liệu tổng hợp. Không đưa dữ
> liệu thật lên hệ thống trước khi hoàn tất UAT, kiểm thử RLS trên staging mới và
> rà soát bảo mật. Mọi credential từng xuất hiện trong gói cũ phải được thu hồi.

## Quyền truy cập

| Người dùng | Phạm vi |
| --- | --- |
| Công dân ẩn danh | Xem CT01, CT02, CT09, CT12, CT13 đã công bố; gửi đề xuất |
| `can_bo_thon` | Tạo, sửa và nộp báo cáo đúng thôn được giao |
| `to_cnscd` | Hỗ trợ các thôn được phân công; không duyệt |
| `admin_xa` | Tạo kỳ, duyệt, khóa, công bố và quản trị trong xã |
| `lanh_dao` | Chỉ đọc dữ liệu nội bộ và xuất báo cáo |

CT14 và dữ liệu định danh không có trong projection công khai.

## Điều hành, chất lượng và đổi mới

Gói vận hành production gồm trung tâm chất lượng dữ liệu theo kỳ/thôn, action có owner,
scorecard trưởng thành số, portfolio đổi mới và brief AI chỉ ở trạng thái chờ duyệt. Chi tiết
contract, RLS và các giới hạn AI/PII nằm ở [docs/PRODUCTION_OPERATIONS.md](docs/PRODUCTION_OPERATIONS.md).
Mã tra cứu kiến nghị công dân chỉ trả trạng thái khử PII; không có tài khoản công dân hoặc OTP.
Các mô-đun phản ánh hiện trường, kho tri thức, what-if và pilot IoT/du lịch được mô tả cùng
điều kiện bật tại [docs/FEATURE_PILOTS.md](docs/FEATURE_PILOTS.md).

## Chuẩn bị môi trường

Yêu cầu: Python 3.11+, Node.js 20+ và PostgreSQL/Supabase staging riêng.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci
Copy-Item .env.example .env
```

Điền `.env` bằng credential staging mới. Không dùng lại secret trong bất kỳ ZIP
cũ nào. Gemini có thể để trống; ứng dụng sẽ tắt tính năng AI thay vì dùng key mặc
định. Chỉ biến `VITE_*` được phép đi vào bundle trình duyệt; tuyệt đối không đặt
service-role hoặc `DATABASE_URL` dưới tiền tố này.

Chạy phát triển:

```powershell
npm run dev
```

- Frontend: `http://127.0.0.1:5173`
- API/OpenAPI: `http://127.0.0.1:8000/docs`
- Liveness/readiness: `/health/live` và `/health/ready`

Build production và chạy cùng origin qua FastAPI:

```powershell
npm run build
npm start
```

## Cơ sở dữ liệu

Database mới áp dụng baseline:

```powershell
python migrate.py --baseline
python scripts/migrate_and_seed.py
```

Database cũ áp dụng migration theo thứ tự:

```powershell
python migrate.py
python scripts/migrate_and_seed.py
```

`DATABASE_URL` là bắt buộc. Script chỉ in tên migration và checksum, không in
DSN. Trước khi upgrade phải backup và thử restore. Dữ liệu legacy không tương
thích được ghi vào bảng quarantine thay vì tự suy đoán.

Hai RPC nghiệp vụ chính:

- `create_report_period(...)`: tạo kỳ, phạm vi thôn, thông báo trong ứng dụng và
  audit log trong một transaction.
- `save_report_submission(...)`: tạo/cập nhật report, CT01-CT14, validation flags,
  optimistic version và idempotency receipt trong một transaction. RPC phải được
  gọi bằng JWT của người dùng, không phải service-role.
- `commit_report_import_batch(...)`: chỉ tổng hợp các nhóm thôn mới có đủ toàn bộ
  nguồn đã kiểm duyệt; không yêu cầu giả tạo đủ 22 tệp và không cộng dở nhóm.

Quy tắc nhập bộ XLSX 22 thôn cũ, xử lý 19/22 tệp mẫu và khóa Đông Sơn được mô tả
tại [docs/LEGACY_DATA_IMPORT.md](docs/LEGACY_DATA_IMPORT.md).

## Kiểm thử

```powershell
python -m pytest tests -q
npm run check
python scripts/release_check.py
```

Kiểm thử mô phỏng trong `tests/test_rls_policies.py` không thay thế kiểm thử RLS
thật. Trước release phải chạy ma trận anonymous/admin/cán bộ/CNSCĐ/lãnh đạo trên
PostgreSQL/Supabase staging.

## Gate staging và production

Các lệnh dưới đây không tự kết nối production, không in DSN và đều fail-closed.
Chạy RLS trên một database staging trống/biệt lập có tên chứa `stage`, `test`,
`restore` hoặc `sandbox`:

```powershell
$env:STAGING_DATABASE_URL = "..."
$env:BANA_STAGING_RLS_APPROVED = "YES"
python scripts/staging_release_gate.py --run-rls
```

Đo public API chỉ-đọc (mặc định 20 request/endpoint, p95 <= 500 ms):

```powershell
python scripts/performance_smoke.py --base-url https://staging.example.gov.vn
```

Backup luôn được kiểm tra; restore là thao tác phá hủy và đòi hỏi hai cờ chấp
nhận cùng restore target khác DB nguồn:

```powershell
$env:BACKUP_DATABASE_URL = "..."
python scripts/backup_restore_smoke.py
$env:RESTORE_DATABASE_URL = "..."
$env:BANA_BACKUP_RESTORE_APPROVED = "YES"
python scripts/backup_restore_smoke.py --restore --i-understand-restore-destroys-target
```

Trước khi tuyên bố production-ready, sao chép
`config/production_attestation.example.json`, điền owner/bằng chứng/timestamp
thật cho từng control và kiểm tra:

```powershell
python scripts/production_gate.py --attestation-file .\production_attestation.json
```

Lệnh này là kiểm tra hồ sơ, không thay thế việc rotate secret, xem access log,
UAT, review pháp lý hoặc phê duyệt của đơn vị phụ trách.

## Hồ sơ phát hành và bàn giao

- `docs/STAGING_UPGRADE_20260716.md`: backup, migration 0004-0006, seed và post-check.
- `docs/TRACEABILITY_MATRIX.md`: yêu cầu -> code/API/UI -> bằng chứng test.
- `docs/TEST_REPORT_20260716.md`: kết quả CI, coverage, RLS và các gate còn thiếu.
- `docs/DEMO_AND_HANDOVER_SCRIPT.md`: kịch bản demo năm nhóm người dùng và biên bản bàn giao.
- `docs/LEGACY_DATA_IMPORT.md`: quy trình kiểm duyệt 19/22 file và lineage 22 -> 10.
- `docs/RC_HANDOFF_20260718.md`: phạm vi RC, kết quả gate tự động, SHA-256 gói bàn giao và các gate bên ngoài còn phải ký.

## Tạo gói bàn giao

```powershell
python zip_project.py --output ..\BaNaSmartLink_fixed.zip
```

Trình đóng gói dùng allowlist, từ chối symlink, secret, DB local, `.env`, cache,
build cũ và archive lồng. Chạy `scripts/release_check.py` trước khi tạo ZIP.

## Vận hành an toàn

- In-app notification là kênh mặc định; Web Push chỉ bật khi VAPID hợp lệ.
- Reminder dùng `Asia/Ho_Chi_Minh`, advisory lock và khóa idempotency trong DB.
- Không log tên, số điện thoại, access token, DSN, nội dung OCR gốc hoặc key.
- Mục tiêu ban đầu: RPO 24 giờ, RTO 4 giờ; phải có restore smoke test.
- Khi có sự cố: cô lập deployment, thu hồi secret/session, bảo toàn log, đánh giá
  phạm vi ảnh hưởng rồi mới phát hành lại.
