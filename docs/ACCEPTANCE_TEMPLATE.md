# Biên bản nghiệm thu và phát hành — mẫu

> Đây là biểu mẫu trống, không phải bằng chứng nghiệm thu. Không đổi trạng thái
> thành “Đạt” khi chưa có owner, bằng chứng, thời gian và chữ ký tương ứng.

## 1. Thông tin kiểm soát tài liệu

| Trường | Giá trị |
|---|---|
| Tên hệ thống | Ba Na SmartLink |
| Phiên bản/tag | `<chưa điền>` |
| Commit đủ 40 ký tự | `<chưa điền>` |
| Nhánh nguồn | `main` |
| Môi trường | `<staging/production và URL>` |
| Loại dữ liệu | `<synthetic/đã được phê duyệt>` |
| Thời gian kiểm tra, múi giờ | `<ISO-8601 Asia/Ho_Chi_Minh>` |
| Đơn vị bàn giao | `<chưa điền>` |
| Đơn vị tiếp nhận | `<chưa điền>` |
| Người quản lý phát hành | `<chưa điền>` |

## 2. Phạm vi nghiệm thu

Liệt kê chức năng có trong phiên bản, chức năng mô hình thử nghiệm đang tắt và
mọi nội dung ngoài phạm vi. Không dùng nội dung demo để suy ra rằng một tích hợp,
job lưu trữ hoặc phê duyệt pháp lý đã hoàn tất.

`<mô tả phạm vi>`

## 3. Hiện vật bàn giao

| Hiện vật | Phiên bản/đường dẫn kiểm soát | SHA-256 hoặc CI run | Người kiểm tra | Trạng thái |
|---|---|---|---|---|
| Báo cáo 33–36 trang + phụ lục | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | Chờ |
| Slide 10 phút | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | Chờ |
| Video ≤5 phút + phụ đề | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | Chờ |
| OpenAPI/data dictionary/RBAC/traceability/threat model | `docs/` | `<chưa điền>` | `<chưa điền>` | Chờ |
| SBOM Node/Python + license inventory | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | Chờ |
| Runbook/backup-restore/incident/user guide | `docs/` | `<chưa điền>` | `<chưa điền>` | Chờ |
| Release ZIP | `BaNaSmartLink_release.zip` | `<chưa điền>` | `<chưa điền>` | Chờ |
| Checksum ngoài ZIP | `BaNaSmartLink_release.zip.sha256` | `<chưa điền>` | `<chưa điền>` | Chờ |
| Manifest trong ZIP | `RELEASE_MANIFEST.json` | `<chưa điền>` | `<chưa điền>` | Chờ |

Credential không được ghi trong biên bản; chuyển qua kênh bí mật do đơn vị tiếp
nhận phê duyệt.

## 4. Cổng nghiệm thu

| Cổng | Tiêu chí | Bằng chứng gắn đúng commit | Owner/thời gian | Kết quả |
|---|---|---|---|---|
| Nguồn phát hành | `main` sạch, HEAD trùng `origin/main`, tag đã chốt | `<link/log>` | `<chưa điền>` | Chờ |
| Backend/frontend/build | Toàn bộ test, typecheck và build đạt | `<CI run/artifact>` | `<chưa điền>` | Chờ |
| OpenAPI/release/security | Không drift; release/secret/SCA/SAST gate đạt | `<CI run/artifact>` | `<chưa điền>` | Chờ |
| RLS staging | Ma trận anonymous và bốn role nội bộ đạt trên DB staging biệt lập | `<log đã che secret>` | `<chưa điền>` | Chờ |
| Backup/restore | Backup đọc được và restore drill trên target biệt lập đạt RPO/RTO đã duyệt | `<log/hash>` | `<chưa điền>` | Chờ |
| Bảo mật và quyền riêng tư | Credential/session đã rotate; access log và pháp lý/privacy đã review | `<biên bản>` | `<chưa điền>` | Chờ |
| Accessibility/responsive | Keyboard, screen reader/axe có contrast; 360/768/1280 và phóng chữ 200% không mất tác vụ | `<ảnh/report>` | `<chưa điền>` | Chờ |
| Hiệu năng | LCP p75 và API p95 đạt ngưỡng tại tải đã mô tả | `<measurement>` | `<chưa điền>` | Chờ |
| UAT năm nhóm | Người dân, cán bộ thôn, CNSCĐ, quản trị, lãnh đạo xác nhận độc lập | `<ma trận/chữ ký>` | `<chưa điền>` | Chờ |
| Benchmark AI | Chỉ bắt buộc để công bố chất lượng; ≥100 tài liệu, holdout khóa trước | `<report/hash>` | `<chưa điền>` | Chờ |
| Đo giảm thời gian | 10 thôn × 3 lượt; chỉ công bố ≥80% khi trung vị thực đo đạt | `<report/chữ ký>` | `<chưa điền>` | Chờ |
| Production đúng SHA | Render hoàn tất; `/health/live` trả đúng full SHA và smoke desktop/mobile đạt | `<log/ảnh>` | `<chưa điền>` | Chờ |

Tham chiếu cách chạy: [README](../README.md), [runbook](RUNBOOK.md),
[UAT](UAT_OPERATIONS.md), [AI benchmark](AI_BENCHMARK_PROTOCOL.md) và
[release evidence](RELEASE_EVIDENCE_20260726.md).

## 5. Sai lệch, rủi ro và điều kiện

| ID | Mô tả | Mức ảnh hưởng | Quyết định/biện pháp | Owner | Hạn | Trạng thái |
|---|---|---|---|---|---|---|
| `<ID>` | `<chưa điền>` | `<cao/vừa/thấp>` | `<chưa điền>` | `<chưa điền>` | `<ngày>` | Mở |

Không được chấp nhận có điều kiện đối với rò rỉ CT14/thông tin cá nhân, truy cập
chéo xã/thôn, secret trong artifact, sai commit production hoặc mất khả năng
phục hồi đã cam kết.

## 6. Quyết định

Chọn đúng một:

- [ ] Nghiệm thu và cho phép phát hành đúng phiên bản/commit ở Mục 1.
- [ ] Nghiệm thu có điều kiện theo toàn bộ mục mở ở Mục 5.
- [ ] Chưa nghiệm thu; tiếp tục ở trạng thái release candidate.

Quyết định và phạm vi sử dụng dữ liệu thật:

`<chưa điền>`

## 7. Xác nhận

| Vai trò ký | Họ tên/chức vụ | Ý kiến | Ngày giờ | Chữ ký |
|---|---|---|---|---|
| Đại diện đơn vị bàn giao | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | |
| Đại diện kỹ thuật/vận hành | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | |
| Đại diện an toàn/quyền riêng tư | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | |
| Đại diện người dùng/UAT | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | |
| Đại diện đơn vị tiếp nhận | `<chưa điền>` | `<chưa điền>` | `<chưa điền>` | |

Mọi sửa đổi sau chữ ký tạo phiên bản biên bản mới và phải trỏ tới commit/tag
mới; không sửa âm thầm kết quả đã ký.
