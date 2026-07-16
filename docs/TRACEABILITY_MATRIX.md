# Ma trận truy vết sửa dữ liệu BaNa SmartLink

| Yêu cầu | Hiện thực chính | Bằng chứng kiểm thử | Trạng thái |
|---|---|---|---|
| Bảo toàn XLSX gốc | `scripts/audit_source_workbooks.py` chỉ đọc, ghi SHA-256/kích thước; không ghi PII người lập | `test_source_workbook_audit.py`, audit JSON ngoài repo | Đạt bằng mã và fixture; nguồn gốc đã audit |
| Không biến thiếu/sai thành 0 | `excel_report_parser.py`, `validator.py`, preview API và UI giữ `null`/raw value | `test_excel_preview_contract.py`, security-critical coverage | Đạt |
| Bắt 7 ca lỗi mẫu | Validator deterministic cho BLANK/TEXT/SEP/OUTLIER/LOGIC/BADPHONE | `test_official_golden_files.py`, `test_source_workbook_audit.py` | Đạt |
| 22 thôn cũ sang 10 thôn mới | Mapping có version, 22 village + 2 resettlement area, target đề xuất riêng | `test_village_mapping_golden.py`, `test_fixture_integrity.py` | Đạt; Đông Sơn vẫn chờ quyết định |
| Nhập 19/22 tệp an toàn | Cho tạo batch thiếu nguồn; review từng tệp; chỉ chốt target đủ toàn bộ nguồn | `test_report_import.py`, `test_report_import_endpoints.py` | Đạt |
| Không tự suy đoán Đông Sơn | `new_village_id=null`, chỉ có `proposed_new_village_id`; RPC chặn target liên quan | golden mapping + migration overlay verify | Đạt |
| Lineage và bằng chứng bất biến | Bảng batch/file/resolution/lineage; trigger chặn sửa raw evidence và review | PostgreSQL contract test, schema security tests | Đạt |
| Transaction khi tổng hợp | RPC tạo report, CT01-CT14, lineage và audit trong một transaction | database-contract trên PostgreSQL 17 | Đạt |
| Quyền/RLS | Admin-only batch/review/commit; không cấp anon; chặn insert lineage trực tiếp | `rls_matrix.sql`, `migration_overlay_verify.sql` | Đạt trong CI; cần xác nhận staging thật |
| Template đúng CT01-CT14 | Tạo XLSX có metadata, validation version, hash và kích thước | `test_report_period_template.py` | Đạt |
| Export đúng và chống formula injection | XLSX/DOCX/PDF nội bộ, public scope riêng, sanitize ô nguy hiểm | `test_export_artifacts.py` | Đạt tự động; cần visual UAT trên staging |
| OpenAPI là contract | Router mới và type TypeScript sinh tự động | CI regenerate + reject drift | Đạt |
| Frontend import/review | `LegacyBatchImport.tsx`, cảnh báo thiếu/trùng/lỗi, reason bắt buộc, eligible/excluded | Typecheck, frontend test, build | Đạt tự động; cần browser UAT |
| CI đa nền tảng | Ubuntu + Windows, PostgreSQL, coverage, SAST/SCA, secret scan, SBOM | GitHub Actions run `29481161327` | Đạt |
| Coverage | Tổng routers/services >=80%; nhánh security-critical 100% | CI artifacts `coverage.xml`, `test-results.xml` | 80.77% tổng; 100% nhánh trọng yếu |
| Bản Render sau sửa | Chỉ deploy sau migration staging và merge PR | `STAGING_UPGRADE_20260716.md` | Chưa thực hiện, gate bên ngoài |
| Dữ liệu thật/production | UAT, privacy/legal, rotate secret, backup/restore, approval | `production_gate.py`, runbook | Chưa xác nhận; không được tuyên bố production-ready |

