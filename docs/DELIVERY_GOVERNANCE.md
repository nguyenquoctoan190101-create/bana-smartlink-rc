# Quản trị phát hành và bàn giao Ba Na SmartLink

Tài liệu này là chỉ mục vận hành hiện hành. Tài liệu có ngày trong tên là bằng
chứng lịch sử của lần phát hành đó, không được dùng để suy ra trạng thái hiện
tại. Mọi tuyên bố nghiệm thu phải trỏ tới commit và bằng chứng của lần phát hành
đang xét.

## Nguồn mã và trạng thái

- GitHub `main` là nguồn mã duy nhất. Không phát hành trực tiếp từ ZIP, thư mục
  Downloads hoặc nhánh làm việc.
- Một thay đổi tồn tại trong mã nguồn không đồng nghĩa đã được triển khai, bật
  trên production hoặc được đơn vị sử dụng phê duyệt.
- Tài liệu phải phân biệt ba trạng thái: **đã kiểm chứng tự động**, **cần bằng
  chứng môi trường/người dùng**, **đề xuất chưa triển khai**.
- Không đưa đường dẫn máy cá nhân, secret, cache, database cục bộ, dữ liệu thật,
  fixture kiểm thử hoặc archive lồng vào gói bàn giao.

## Quy trình tạo gói duy nhất

Tạo một thư mục phát hành mới, trống và nằm ngoài repository. Không đặt các ZIP
cũ vào thư mục này.

```powershell
git switch main
git pull --ff-only
git status --porcelain
python scripts/release_check.py
python -m pytest tests -q
npm run check

$commit = git rev-parse HEAD
$releaseDir = Join-Path .. ("release-" + $commit.Substring(0, 12))
New-Item -ItemType Directory -Path $releaseDir
python zip_project.py --output (Join-Path $releaseDir "BaNaSmartLink_release.zip")
python scripts/scan_archives.py (Join-Path $releaseDir "BaNaSmartLink_release.zip")
```

`git status --porcelain` phải không có output. Trình đóng gói tiếp tục tự kiểm
tra nhánh `main`, HEAD trùng `origin/main`, working tree sạch và từ chối thư mục
có ZIP khác. Kết quả gồm:

- đúng một `BaNaSmartLink_release.zip`;
- `BaNaSmartLink_release.zip.sha256` để đối chiếu bên ngoài;
- `RELEASE_MANIFEST.json` bên trong ZIP, ghi commit đủ 40 ký tự và SHA-256 của
  từng tệp.

Manifest không tự ghi hash của chính nó hoặc hash ZIP để tránh vòng lặp. Các
gói cũ được chuyển sang kho lưu trữ có phân quyền, không gửi cùng gói hiện hành.

## Môi trường đám mây và phương án chuyển đổi

Giai đoạn thí điểm dùng Render cho container FastAPI/React và Supabase cho Auth,
PostgreSQL/RLS, storage và backup theo cấu hình đã được duyệt. Secret chỉ nằm
trong secret store; frontend chỉ nhận biến công khai `VITE_*`.

Khi chuyển sang hạ tầng khác, giữ nguyên ranh giới React/Vite → FastAPI →
PostgreSQL/RLS. Hạ tầng đích phải có:

- container image bất biến gắn commit/digest, TLS và health/readiness;
- PostgreSQL tương thích RLS, migration transaction và phục hồi theo thời điểm;
- object storage private có version/lifecycle;
- Auth/JWT tương thích contract, secret manager, scheduler và log có che dữ liệu;
- giám sát p95, 4xx/5xx, pool DB, hàng đợi, chi phí OCR/AI và cảnh báo;
- diễn tập chuyển/rollback bằng dữ liệu tổng hợp trước khi chuyển dữ liệu thật.

Không chuyển traffic khi chưa so sánh RLS, backup/restore, hiệu năng, UAT và
quyền truy cập trên hạ tầng đích.

## Mô hình OPEX kỹ thuật

Không ghi giá từ trí nhớ. Người lập dự toán lấy bảng giá nhà cung cấp tại ngày
lập, lưu URL/bản chụp, đơn vị tiền, thuế và tỷ giá. Báo cáo tách chi phí cố định,
theo mức sử dụng và dự phòng; không bao gồm nhân sự, đào tạo hoặc quản lý dự án.

| Mức tải | Cơ sở định cỡ | Thành phần phải tính |
| --- | --- | --- |
| Thí điểm | 10 thôn, ít tài khoản nội bộ, dữ liệu tổng hợp, tải không liên tục | Render/container, Supabase/Auth/DB, storage/backup tối thiểu, tên miền/TLS, log, số trang OCR và lượt AI thực tế |
| Dự kiến | 10 thôn vận hành thường xuyên, kỳ báo cáo đầy đủ, phản ánh công khai | Tài nguyên app/DB có headroom, backup/PITR, storage và egress, giám sát/cảnh báo, OCR/AI theo quota, môi trường staging |
| Cao | Nhiều kỳ đồng thời hoặc mở rộng liên xã, tăng media và người dùng | Scale app/DB, read/connection capacity, object storage/egress, retention log/backup, OCR/AI rate limit, DR và môi trường dự phòng |

Công thức tháng:

```text
OPEX kỹ thuật =
  app/container + database/auth + storage + backup/DR
  + egress + monitoring/log + OCR pages + AI requests
  + domain/TLS + contingency
```

Mỗi biến phải có đơn giá, số lượng, giả định tăng trưởng, nguồn giá và owner.
Trình bày thấp/dự kiến/cao cùng độ nhạy cho số trang OCR, dung lượng media và
lượt AI; không quy đổi thành “chi phí tiết kiệm” nếu chưa đo thời gian UAT.

## Lưu trữ và xóa dữ liệu

| Loại dữ liệu | Quy tắc |
| --- | --- |
| Tệp xem trước chưa cam kết | Mục tiêu xóa trong tối đa 7 ngày; trước production phải có job, log xóa và kiểm thử bằng chứng |
| Báo cáo/tệp nguồn đã cam kết | Giữ theo lịch hồ sơ được cơ quan có thẩm quyền phê duyệt; hash, phiên bản và audit không bị thay đổi âm thầm |
| Thông tin cá nhân/ảnh phản ánh | Chỉ giữ tối thiểu cần thiết cho xử lý; thời hạn, quyền xóa/ẩn danh và legal hold phải được phê duyệt |
| Audit/security log | Giữ đủ điều tra và trách nhiệm giải trình; che nội dung nhạy cảm và hạn chế người đọc |
| Backup | Kế thừa lịch xóa và legal hold; ghi rõ độ trễ xóa khỏi bản sao lưu |
| Bộ benchmark | Chỉ dùng dữ liệu tổng hợp/khử định danh; ground-truth được phân quyền và version hóa bằng SHA-256 |

Không coi “đã ghi trong tài liệu” là đã triển khai retention. Gate production
phải dẫn tới cấu hình/job và bằng chứng thử xóa hoặc phục hồi thực tế.

## Ngôn ngữ hành chính

| Không dùng trong giao diện chính | Dùng thống nhất |
| --- | --- |
| Brief quyết định | Tóm tắt điều hành |
| KPI | Chỉ tiêu trọng tâm |
| Policy scorecard | Theo dõi thực hiện kế hoạch |
| What-if | Mô phỏng phương án — không phải dự báo |
| PII | Thông tin cá nhân |
| AI draft | Nội dung gợi ý — chờ phê duyệt |
| Online / Offline | Đang kết nối / Ngoại tuyến |
| Pilot | Mô hình thử nghiệm |

Chỉ dùng “thời gian thực”, “đã xác minh”, “chính xác”, “tự động” hoặc “giảm
80%” khi có định nghĩa phép đo, nguồn và bằng chứng được ký.

## Lộ trình 12 tuần và sản phẩm bàn giao

1. **Tuần 1:** khóa đường cơ sở, nguồn mã, tài sản, dữ liệu và ma trận vai trò.
2. **Tuần 2–3:** kiến trúc thông tin, thuật ngữ hành chính và luồng báo cáo.
3. **Tuần 3–4:** nhận diện, responsive và WCAG.
4. **Tuần 4–7:** trợ lý Excel và bằng chứng human review; OCR ảnh/PDF chỉ làm
   prototype, tiếp tục khóa nếu chưa có semantic redaction/privacy approval.
5. **Tuần 6–8:** không gian lãnh đạo, cán bộ, quản trị, CNSCĐ và công dân.
6. **Tuần 8–9:** RLS, dữ liệu, retention, AI safety và benchmark.
7. **Tuần 9–10:** hiệu năng, bundle, ngoại tuyến và accessibility.
8. **Tuần 10–11:** UAT năm nhóm người dùng, đo thời gian ba lượt tại 10 thôn.
9. **Tuần 12:** nghiệm thu, báo cáo, slide, video, ZIP, checksum và production.

Mỗi nhóm có diff review, test liên quan, toàn bộ hồi quy, build tuần tự và QA
1280px/768px/360px cùng mức phóng đại chữ 200%. Bộ bàn giao cuối gồm báo cáo
33–36 trang và phụ lục, slide 10
phút, video không quá 5 phút có phụ đề, OpenAPI, data dictionary, phân quyền,
traceability, threat model, SBOM/license, runbook, backup/restore, incident
response, hướng dẫn năm nhóm người dùng, UAT và biên bản nghiệm thu.

## Kiểm chứng đúng commit trên production

Sau khi push `main`, ghi đủ SHA và chờ Render kết thúc deployment. Không xác
nhận bằng thời gian deploy hoặc tên release:

```powershell
$expected = git rev-parse HEAD
python scripts/production_sha_smoke.py `
  --base-url https://bana-smartlink-rc-toan-2026.onrender.com `
  --expected-commit $expected
python scripts/performance_smoke.py `
  --base-url https://bana-smartlink-rc-toan-2026.onrender.com
```

Sau khi SHA khớp mới kiểm thử trực tiếp desktop/mobile: cổng công khai, năm chỉ
tiêu được phép công bố, phản ánh/tra cứu, đăng nhập từng vai trò, nhập–duyệt–
công bố báo cáo, export, 403 ngoài phạm vi và log lỗi. Lưu ảnh không chứa thông
tin cá nhân, thời điểm, trình duyệt, commit, kết quả và người xác nhận vào ticket
phát hành.
