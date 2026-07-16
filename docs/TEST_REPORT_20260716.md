# Báo cáo kiểm thử release candidate - 16/07/2026

## Phiên bản

- Nhánh: `agent/data-reconciliation-import`
- Commit đã kiểm tra: `dffa484`
- Pull request: `https://github.com/nguyenquoctoan190101-create/bana-smartlink-rc/pull/1`
- GitHub Actions: `https://github.com/nguyenquoctoan190101-create/bana-smartlink-rc/actions/runs/29481161327`

## Kết quả tự động

| Nhóm | Kết quả |
|---|---|
| Backend unit/integration | 362 test đạt sau bổ sung 7 ca coercion; CI tổng bộ ứng dụng 355 test đạt trước lượt coverage riêng |
| Coverage routers + services | 80.77%, gate tối thiểu 80% |
| Security-critical branch coverage | 100% cho validator, security, settings và upload validator |
| PostgreSQL schema + RLS | Đạt trên PostgreSQL 17 với Supabase-compatible roles |
| Migration overlay 0004-0006 | Đạt, gồm trigger validator, immutable evidence và privilege assertions |
| Frontend | TypeScript strict, 14 test và Vite production build đạt |
| OpenAPI contract | Sinh lại và không có drift |
| Bundle budget | Đạt |
| Python lint | Ruff đạt |
| Dependency audit | `pip-audit` và `npm audit --audit-level=high` đạt |
| SAST | Bandit mức high đạt |
| Secret/archive scan | Đạt, không phát hiện secret khả nghi trong release tree/archive |
| SBOM | Đã tạo CycloneDX cho Node và Python |

Lưu ý: số 355 là toàn bộ test ứng dụng trong job chính; 91 test security-critical chạy lại ở job coverage riêng và có thể trùng với tập 355. Không cộng hai con số để tuyên bố số test duy nhất.

## Kết quả dữ liệu nguồn

- 22 đơn vị thôn trong tracker.
- 19 workbook báo cáo tồn tại; thiếu Ninh An, Sơn Phước, Thạch Nham Tây.
- 12 workbook sạch; 7 workbook có cảnh báo/lỗi dự kiến.
- Sáu ô khác biệt giữa workbook nguồn và bảng tổng hợp đã được ghi nhận, không ghi đè âm thầm.
- Đông Sơn có số điện thoại sai định dạng và phạm vi sáp nhập chưa được xác nhận.
- Audit deliverable không chứa tên/chức danh/số điện thoại người lập.

## Lỗi CI đã phát hiện và được sửa

1. Trigger chuyển trạng thái report không đủ quyền gọi validator sau khi quyền helper bị thu hồi. Sửa bằng trigger `SECURITY DEFINER` với `search_path` cố định; validator vẫn không công khai.
2. Hàm coercion lưu trữ mới thiếu test branch trong gate 100%. Bổ sung đủ các lớp dữ liệu hợp lệ và mơ hồ.

Hai lỗi trên đều có regression test và toàn bộ check sau sửa đã xanh.

## Kiểm thử còn phải thực hiện ngoài mã nguồn

- Backup/restore thật của Supabase staging.
- Áp dụng migration và seed trên staging đang dùng.
- RLS/authorization smoke bằng JWT thật của năm principal.
- Browser UAT, axe/keyboard và responsive trên bản sau deploy.
- Privacy/legal và phê duyệt phát hành.

Do các mục này chưa có bằng chứng, bản hiện tại vẫn là release candidate dùng dữ liệu tổng hợp.

