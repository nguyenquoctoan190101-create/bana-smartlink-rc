# Bằng chứng release candidate — 26/07/2026

> **Trạng thái: bản nháp kỹ thuật, chưa phải biên bản phát hành.** Kết quả dưới
> đây được ghi nhận trên working tree cục bộ đang có thay đổi, trước commit/tag
> cuối. Phải chạy lại trên full SHA phát hành và thay các chỗ `<chưa điền>`
> trước khi dùng làm bằng chứng nghiệm thu.

## 1. Định danh bản đang kiểm tra

| Trường | Giá trị |
|---|---|
| Repository | Ba Na SmartLink |
| Nhánh | `main` |
| Base HEAD khi tiếp tục công việc | `796b874c4c15bd2f4138561f8e1065f94529a437` |
| Full SHA phát hành | `<chưa điền — working tree chưa commit>` |
| Tag phát hành | `<chưa điền>` |
| Người/thời gian chạy | `<bổ sung từ log CI hoặc biên bản>` |
| Loại dữ liệu kiểm thử | Fixture/dữ liệu tổng hợp |

Base HEAD chỉ cho biết điểm bắt đầu; không chứng minh các thay đổi chưa commit đã
được phát hành.

## 2. Kết quả tự động đã quan sát trên candidate cục bộ

| Lệnh/gate | Kết quả quan sát | Phạm vi và giới hạn |
|---|---|---|
| `python -m pytest tests -q --cov=routers --cov=services ...` | 526 test đạt trong 98,68 giây; coverage tổng 84,18% | Candidate cục bộ; phải chạy lại trên full SHA phát hành |
| Security-critical branch coverage | 98 test đạt; statement và branch coverage 100% cho validator/security/settings/upload validator | Không thay kiểm thử xâm nhập độc lập |
| `npm run check` | 20 tệp test, 78 test đạt; typecheck và Vite production build đạt | Candidate cục bộ; không thay browser UAT |
| `npm run openapi:generate` và contract snapshot | Đạt; OpenAPI và TypeScript contract đã đồng bộ | Phải reject drift lại trên full SHA phát hành |
| PostgreSQL 17.10 biệt lập | Đạt cả đường nâng cấp từ snapshot và đường cài sạch: schema/migrations, contract, overlay, RLS matrix, seed và seed verify | Chưa thay log CI/staging gắn full SHA |
| SCA/SAST mức chặn | `pip-audit` và `npm audit --omit=dev` không phát hiện lỗ hổng đã biết; Bandit mức high đạt | Snapshot cục bộ ngày 26/07/2026; cần lưu artifact CI |
| `python scripts/release_check.py` | Đạt; quét 458 tệp tại thời điểm chạy | Không phải attestation secret rotation/access-log |
| `python -m ruff check .` | Đạt | Static lint cục bộ |
| `npm run budget` | Đạt ngưỡng JS ≤500 KiB, CSS ≤150 KiB | Không chứng minh LCP p75 trên thiết bị thật |
| `git diff --check` | Đạt; chỉ có cảnh báo chuyển dòng CRLF | Không chứng minh working tree sạch |
| `python -m compileall -q ...` | Đạt | Chỉ kiểm cú pháp Python trong phạm vi lệnh đã chạy |

Các số liệu này không được sao chép sang biên bản cuối nếu lần chạy trên commit
phát hành cho kết quả khác. CI run, log, phiên bản Python/Node và full SHA phải
được đính kèm khi chốt.

## 3. Kiểm tra giao diện đã quan sát

Đã render và kiểm tra cục bộ bằng dữ liệu tổng hợp ở cả desktop 1440×900 và
mobile 390×844. Bộ ảnh hiện có trong gói bàn giao gồm cổng dữ liệu công khai,
tổng quan điều hành, báo cáo toàn xã và bảng workflow nháp → duyệt → khóa →
công bố. Đây là bằng chứng visual review để rà bố cục và trạng thái; chưa phải
accessibility/browser acceptance hoặc UAT gắn full SHA. Trước phát hành cần chạy
lại các luồng cốt lõi trên môi trường đích, lưu ảnh không chứa thông tin cá nhân
và ghi browser, viewport, thời gian, URL cùng commit.

## 4. Cổng bên ngoài còn chờ

| Cổng | Trạng thái 26/07/2026 | Bằng chứng cần bổ sung |
|---|---|---|
| Commit/tag/push `main` cuối | Chờ | Full SHA, tag, remote SHA, clean status |
| CI cho commit cuối | Chờ | URL run và artifact test/coverage/SBOM |
| RLS trên Supabase/PostgreSQL staging biệt lập | PostgreSQL 17.10 cục bộ biệt lập đã đạt; staging vẫn chờ | Log ma trận năm principal gắn full SHA, DB target đã che secret |
| Backup và restore drill của release | Chờ | Hash backup, `pg_restore --list`, số đếm hậu kiểm, RPO/RTO |
| Credential/session rotation và access-log review | Chờ owner dịch vụ | Biên bản có owner/thời gian/kết luận |
| Security và privacy/legal approval | Chờ | Biên bản độc lập |
| Accessibility trên browser thật | Chờ | Keyboard/screen reader/axe, 390/768/1440, không serious/critical |
| LCP p75/API p95 tại tải mục tiêu | Chờ | Cấu hình tải, mẫu đo, p50/p75/p95 và log |
| UAT năm nhóm người dùng | Chờ chữ ký | Ma trận người dân, cán bộ thôn, CNSCĐ, quản trị, lãnh đạo |
| Đo thời gian 10 thôn × 3 lượt | Chờ | Dữ liệu thô, trung vị, độ biến thiên và chữ ký |
| Benchmark AI ≥100 tài liệu/holdout | Chờ bộ dữ liệu hợp lệ | Manifest/hash, exact-match từng trường/nguồn, failure matrix |
| OPEX ba mức có nguồn giá hiện hành | Chờ | URL/bản chụp giá, ngày, tỷ giá, thuế, giả định |
| Render đúng full SHA và production smoke | Chờ deploy | Output `production_sha_smoke.py`, health, desktop/mobile và log lỗi |
| Biên bản nghiệm thu/phê duyệt dữ liệu thật | Chờ | [ACCEPTANCE_TEMPLATE.md](ACCEPTANCE_TEMPLATE.md) đã ký |

Không công bố “production-ready”, độ chính xác OCR/AI hoặc “giảm ít nhất 80%”
cho đến khi các bằng chứng tương ứng được hoàn tất.

## 5. Lệnh chốt bằng chứng trên commit cuối

Thực hiện tuần tự theo [README](../README.md) và [runbook](RUNBOOK.md):

```powershell
git status --porcelain
git rev-parse HEAD
python -m pytest tests -q
npm run check
python scripts/release_check.py
python -m ruff check .
npm run budget
git diff --check
```

Sau khi CI, staging và các phê duyệt đạt:

```powershell
$expected = git rev-parse HEAD
python scripts/production_sha_smoke.py `
  --base-url https://bana-smartlink-rc-toan-2026.onrender.com `
  --expected-commit $expected
python scripts/performance_smoke.py `
  --base-url https://bana-smartlink-rc-toan-2026.onrender.com
```

Không đưa DSN, token, email thật, dữ liệu OCR gốc hoặc output chứa thông tin cá
nhân vào log bàn giao.

## 6. Danh mục bằng chứng cuối cần gắn hash

| Hiện vật | Đường dẫn/CI run | SHA-256 | Người kiểm tra |
|---|---|---|---|
| Test/coverage/JUnit | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |
| Node/Python SBOM và license report | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |
| RLS staging | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |
| Backup/restore report | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |
| Browser/accessibility/performance | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |
| UAT/benchmark/approval | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |
| Báo cáo DOCX/PDF và slide (không thực hiện video theo chỉ đạo) | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |
| Release ZIP/checksum/manifest | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` |

Quyết định phát hành cuối phải dùng [mẫu nghiệm thu](ACCEPTANCE_TEMPLATE.md) và
đối chiếu [traceability matrix](TRACEABILITY_MATRIX.md), không dùng riêng tài
liệu bằng chứng tự động này.
