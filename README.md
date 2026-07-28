# Ba Na SmartLink

Nền tảng báo cáo số liệu Văn hóa – Xã hội từ thôn lên xã dành cho xã Bà Nà,
Đà Nẵng.

> **Trạng thái hiện tại:** release candidate đang chạy trên môi trường staging
> tại [bana-smartlink-rc-toan-2026.onrender.com](https://bana-smartlink-rc-toan-2026.onrender.com/).
> Bản này dùng dữ liệu tổng hợp/thử nghiệm và chưa phải tuyên bố
> production-ready.
>
> **Cấu hình demo Ban Giám khảo:** `MFA_ENFORCEMENT_ENABLED=false` tạm bỏ bước
> nhập mã TOTP cho tài khoản dùng chung. Mã MFA và các factor đã đăng ký không
> bị xóa. Sau thời gian chấm, đổi lại thành `true` và triển khai lại để khôi
> phục ngay yêu cầu `aal2` cho `admin_xa` và `lanh_dao`.

Kiến trúc chính:

```text
React 19 + Vite 6 + Service Worker
              |
              v
FastAPI -> Supabase Auth + PostgreSQL/RLS
              |
              \-> Gemini (OCR/diễn giải tùy chọn, không quyết định nghiệp vụ)
```

Không sử dụng Express, Firebase, tài khoản/OTP cho công dân hoặc kênh Zalo. Gemini
không quyết định báo cáo hợp lệ; `services/validator.py` và
`config/validation_rules.json` là nguồn quy tắc nghiệp vụ.

## Chức năng hiện có

- Lập, lưu nháp, đồng bộ ngoại tuyến, nộp, duyệt, khóa và công bố báo cáo
  CT01–CT14 theo kỳ và phạm vi thôn.
- Nhập trực tiếp; xem trước XLSX; nhận dạng bảng in hoặc viết tay từ JPG/JPEG,
  PNG, WebP, BMP, TIFF/TIF nhiều trang và PDF quét.
- OCR chỉ gửi vùng bảng CT01–CT14 đã cắt bỏ phần đầu biểu mẫu; ảnh được kiểm tra,
  xóa metadata và tái mã hóa trước khi gọi nhà cung cấp. Kết quả luôn phải qua
  màn hình rà soát, không tự ghi vào báo cáo.
- Xuất XLSX, DOCX và PDF theo bố cục hành chính: A4, Times New Roman, quốc hiệu –
  tiêu ngữ, bảng dễ đọc, số trang, phụ lục và phần ký xác nhận.
- Dashboard tiến độ, chất lượng dữ liệu, công việc cần xử lý, trung tâm điều hành
  và hồ sơ audit theo phạm vi quyền.
- Trung tâm thông báo có số chưa đọc, phân loại ưu tiên, điều hướng xử lý, âm báo
  bật/tắt và Web Push tùy chọn.
- Cổng công dân chỉ công khai các chỉ tiêu được phép; hỗ trợ tra cứu trạng thái,
  gửi đề xuất đối chiếu và phản ánh hiện trường mà không tạo tài khoản.
- Gemini chỉ hỗ trợ OCR, diễn giải số liệu tổng hợp và trợ lý; quy tắc xác định
  hợp lệ vẫn là mã nguồn tất định và chính sách RLS.

> Không đưa dữ liệu thật lên hệ thống trước khi hoàn tất UAT, kiểm thử RLS trên
> staging mới, privacy/legal review, backup–restore drill và rà soát bảo mật.
> Mọi credential từng xuất hiện trong gói cũ phải được thu hồi.

## Quyền truy cập

| Người dùng | Mã nội bộ | Phạm vi |
| --- | --- | --- |
| Công dân ẩn danh | — | Xem CT01, CT02, CT09, CT12, CT13 đã công bố; gửi đề xuất |
| Cán bộ thôn | `can_bo_thon` | Tạo, sửa và nộp báo cáo đúng thôn được giao |
| Tổ công nghệ số cộng đồng | `to_cnscd` | Hỗ trợ các thôn được phân công; không duyệt |
| Cán bộ xã | `admin_xa` | Tạo kỳ, phân công, duyệt, khóa, công bố và quản lý trong xã |
| Lãnh đạo xã | `lanh_dao` | Chỉ đọc dữ liệu nội bộ, quyết định theo thẩm quyền và xuất báo cáo |

CT14 và dữ liệu định danh không có trong projection công khai.

## Điều hành, chất lượng và đổi mới

Gói vận hành gồm trung tâm chất lượng dữ liệu theo kỳ/thôn, công việc có người
phụ trách, theo dõi thực hiện kế hoạch, danh mục sáng kiến và nội dung gợi ý chỉ
ở trạng thái chờ phê duyệt. Chi tiết contract, RLS và giới hạn AI/thông tin cá
nhân nằm ở [docs/PRODUCTION_OPERATIONS.md](docs/PRODUCTION_OPERATIONS.md).
Mã tra cứu kiến nghị chỉ trả trạng thái đã lọc; không có tài khoản công dân hoặc
OTP. Phản ánh hiện trường, kho tri thức, mô phỏng phương án và các mô hình thử
nghiệm được mô tả cùng điều kiện bật tại
[docs/FEATURE_PILOTS.md](docs/FEATURE_PILOTS.md).

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

Các RPC nghiệp vụ chính:

- `create_report_period(...)`: tạo kỳ, phạm vi thôn, thông báo trong ứng dụng và
  audit log trong một transaction.
- `save_manual_report_submission(...)`: tạo/cập nhật report nhập trực tiếp,
  CT01-CT14, validation flags, optimistic version và idempotency receipt trong
  một transaction.
- `save_report_submission_with_extraction(...)`: chỉ nhận dữ liệu XLSX/OCR đã
  có bằng chứng rà soát ngắn hạn, gắn người dùng và tiêu thụ một lần. Preview
  không được lưu; database chỉ giữ digest và provenance tối thiểu.
- `transition_report_workflow(...)` và `delete_report_submission(...)`: duyệt,
  khóa, công bố hoặc xóa theo phạm vi/phiên bản và ghi audit. Người dùng đã xác
  thực không có quyền ghi trực tiếp vào `reports`/`report_values`.
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

Lần xác nhận gần nhất trên nhánh phát hành: **602 kiểm thử backend** và **144 kiểm
thử frontend** đạt; TypeScript typecheck và production build đạt. Con số có thể
tăng khi bổ sung test mới, vì vậy kết quả của pipeline hiện tại luôn là nguồn
xác nhận cuối cùng.

Kiểm thử mô phỏng trong `tests/test_rls_policies.py` không thay thế kiểm thử RLS
thật. Trước release phải chạy ma trận công dân ẩn danh/Cán bộ xã/Cán bộ
thôn/Tổ CNSCĐ/Lãnh đạo xã trên PostgreSQL/Supabase staging.

OCR ngoài đang bật có điều kiện trên staging khi máy chủ có `GEMINI_API_KEY` và
`FEATURE_EXTERNAL_OCR=true`; nếu thiếu cấu hình, giao diện tự tắt OCR và vẫn cho
nhập trực tiếp/XLSX. Trước production vẫn phải hoàn tất privacy/legal review và
benchmark trên bộ dữ liệu đã đăng ký, có tối thiểu 100 tài liệu cùng holdout độc
lập theo [docs/AI_BENCHMARK_PROTOCOL.md](docs/AI_BENCHMARK_PROTOCOL.md). Fixture
CI không phải bằng chứng chất lượng thực địa.

Nội dung hỗ trợ quyết định dùng kiến trúc lai: luật xác định chốt số liệu, chất
lượng và mức ưu tiên; AI chỉ bổ sung phương án, đánh đổi, rủi ro và câu hỏi phản
biện từ gói bằng chứng tổng hợp không có PII. Bật bằng
`FEATURE_DECISION_AI=true`; `DECISION_AI_PROVIDER=auto` ưu tiên OpenAI
`gpt-5.6-sol`, sau đó dùng Gemini đã cấu hình và cuối cùng fallback về bản xác
định. Mọi đầu ra AI bị khóa schema, kiểm tra mã dẫn chứng và phải qua người
duyệt. Chi tiết vận hành tại
[docs/PRODUCTION_OPERATIONS.md](docs/PRODUCTION_OPERATIONS.md).

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

Khi lập hồ sơ mới, đổi khóa tương thích cũ `uat_four_roles` thành
`uat_five_principals` và đính kèm bằng chứng đủ năm nhóm người dùng.
Control `accessibility_browser_review` phải trỏ tới CI/browser report của đúng
full SHA: axe không có lỗi serious/critical, keyboard/focus hoạt động, không mất
tác vụ ở 360/768/1280 px và khi phóng chữ 200%.

```powershell
python scripts/production_gate.py --attestation-file .\production_attestation.json
```

Lệnh này là kiểm tra hồ sơ, không thay thế việc rotate secret, xem access log,
UAT, review pháp lý hoặc phê duyệt của đơn vị phụ trách.

Sau khi Render triển khai, bắt buộc đối chiếu đủ 40 ký tự commit thay vì dựa vào
tên hoặc thời gian release:

```powershell
$expected = git rev-parse HEAD
python scripts/production_sha_smoke.py `
  --base-url https://bana-smartlink-rc-toan-2026.onrender.com `
  --expected-commit $expected
```

## Hồ sơ phát hành và bàn giao

- `docs/DELIVERY_GOVERNANCE.md`: nguồn mã `main`, lộ trình 12 tuần, OPEX ba
  mức tải, lưu trữ/xóa dữ liệu, chuyển hạ tầng và kiểm chứng production đúng SHA.
- `docs/AI_BENCHMARK_PROTOCOL.md`: đăng ký bộ dữ liệu, holdout, exact-match và
  điều kiện không được tuyên bố quá mức.
- `docs/DEMO_AND_HANDOVER_SCRIPT.md`: kịch bản demo năm nhóm người dùng và biên bản bàn giao.
- `docs/UAT_OPERATIONS.md`: tiêu chí UAT, giao diện đa kích thước và đo thời gian tại 10 thôn.
- `docs/TRACEABILITY_MATRIX.md`: yêu cầu -> code/API/UI -> bằng chứng test.
- `docs/LEGACY_DATA_IMPORT.md`: quy trình kiểm duyệt 19/22 file và lineage 22 -> 10.

Các tệp có ngày trong tên là bằng chứng lịch sử của lần phát hành tương ứng,
không phải trạng thái hiện hành:

- `docs/STAGING_UPGRADE_20260716.md`
- `docs/TEST_REPORT_20260716.md`
- `docs/RC_HANDOFF_20260718.md`: phạm vi RC, kết quả gate tự động, SHA-256 gói bàn giao và các gate bên ngoài còn phải ký.

## Tạo gói bàn giao

```powershell
git switch main
git status --porcelain
python scripts/release_check.py
$commit = git rev-parse HEAD
$releaseDir = Join-Path .. ("release-" + $commit.Substring(0, 12))
New-Item -ItemType Directory -Path $releaseDir
python zip_project.py --output (Join-Path $releaseDir "BaNaSmartLink_release.zip")
```

`git status --porcelain` phải không có output và thư mục phát hành phải mới,
không chứa ZIP cũ. Trình đóng gói chỉ chấp nhận nhánh `main` sạch có HEAD trùng
`origin/main`; dùng allowlist và từ chối symlink, secret, DB local, `.env`,
cache, build cũ và archive lồng. Nó tạo đúng một ZIP, checksum `.sha256` bên cạnh và
`RELEASE_MANIFEST.json` bên trong với commit đủ 40 ký tự cùng hash từng tệp.

## Vận hành an toàn

- Trung tâm thông báo trong ứng dụng là kênh mặc định; âm báo có thể tắt và Web
  Push chỉ bật khi cấu hình VAPID hợp lệ.
- Reminder dùng `Asia/Ho_Chi_Minh`, advisory lock và khóa idempotency trong DB.
- Không log tên, số điện thoại, access token, DSN, nội dung OCR gốc hoặc key.
- OCR từ chối định dạng không hỗ trợ, tệp quá 5 MB, PDF/ảnh quá 5 trang, nội dung
  chủ động và ảnh vượt giới hạn điểm ảnh; HEIC/HEIF chưa được mở vì runtime chưa
  có bộ giải mã an toàn đã kiểm chứng.
- Mục tiêu ban đầu: RPO 24 giờ, RTO 4 giờ; phải có restore smoke test.
- Khi có sự cố: cô lập deployment, thu hồi secret/session, bảo toàn log, đánh giá
  phạm vi ảnh hưởng rồi mới phát hành lại.
