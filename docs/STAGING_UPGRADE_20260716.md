# Nâng cấp staging dữ liệu - 16/07/2026

## Trạng thái trước khi nâng cấp

- Nhánh phát hành: `agent/data-reconciliation-import`.
- Pull request: `#1`, đang ở trạng thái draft và chưa được merge vào `main`.
- Render đang phục vụ bản cũ trên `main`; không bị tác động bởi nhánh này.
- Supabase hiện chỉ dùng dữ liệu tổng hợp cho cuộc thi.
- Bốn migration mới phải được áp dụng theo đúng thứ tự:
  1. `20260715_0004_legacy_batch_import.sql`
  2. `20260715_0005_report_templates_and_import_privacy.sql`
  3. `20260715_0006_database_validation_enforcement.sql`
  4. `20260715_0007_supabase_function_acl_hardening.sql`

Không merge PR trước khi hoàn tất các bước dưới đây.

## 1. Sao lưu và ghi nhận điểm khôi phục

1. Trong Supabase, ghi lại project ID, thời điểm và commit đang chạy.
2. Dùng `pg_dump` tạo custom archive; không chụp hoặc gửi connection string vào chat.
3. Dùng `pg_restore --list` xác nhận archive đọc được.
4. Tốt nhất khôi phục thử vào một database có tên chứa `restore` hoặc `staging`.

Script an toàn có sẵn:

```powershell
$env:BACKUP_DATABASE_URL = '<connection string chỉ lưu trong terminal>'
python scripts/backup_restore_smoke.py
```

Chạy restore chỉ khi có database đích biệt lập và đã đọc kỹ cờ phá hủy trong `--help`.

## 2. Kiểm tra trước migration

Chạy trong Supabase SQL Editor:

```sql
select
  to_regclass('public.reports') is not null as reports_exists,
  to_regclass('public.pending_updates') is not null as proposals_exists,
  to_regclass('public.action_items') is not null as operations_exists,
  (select count(*) from public.villages where commune_id = 'ba_na') as current_villages,
  (select count(*) from public.report_periods where commune_id = 'ba_na') as periods,
  (select count(*) from public.reports r
     join public.report_periods p on p.id = r.period_id
    where p.commune_id = 'ba_na') as reports;
```

Lưu kết quả vào ticket bàn giao. Nếu ba cột `*_exists` không đồng thời là `true`, dừng lại.

## 3. Áp dụng migration

Mở từng file migration ở GitHub hoặc trong gói nguồn sạch, sao chép toàn bộ nội dung và chạy riêng từng file trong SQL Editor. Không ghép đoạn, không bỏ `begin`/`commit`, không tiếp tục nếu file trước báo lỗi.

Sau mỗi file, chạy:

```sql
select current_timestamp as checked_at;
```

và lưu ảnh kết quả `Success` không chứa secret.

## 4. Seed danh mục tham chiếu 22 sang 10

Trên máy quản trị, tại thư mục mã nguồn:

```powershell
$env:DATABASE_URL = '<connection string chỉ lưu trong terminal>'
$env:BANA_COMMUNE_ID = 'ba_na'
python scripts/migrate_and_seed.py
Remove-Item Env:DATABASE_URL
```

Kết quả mong đợi: `Seeded 10 current villages and 24 historical mappings.` Hai mục tái định cư là `resettlement_area`, không phải báo cáo thứ 23 và 24.

## 5. Kiểm tra sau migration

```sql
select
  (select count(*) from public.villages where commune_id = 'ba_na') as current_villages,
  (select count(*) from public.villages_legacy where commune_id = 'ba_na'
    and legacy_unit_type = 'village') as legacy_villages,
  (select count(*) from public.villages_legacy where commune_id = 'ba_na'
    and legacy_unit_type = 'resettlement_area') as resettlement_areas,
  (select count(*) from public.villages_legacy where commune_id = 'ba_na'
    and mapping_status = 'pending_official_decision') as pending_mapping,
  to_regclass('public.report_import_batches') is not null as import_batches_exists;
```

Kết quả mong đợi lần lượt: `10`, `22`, `2`, `1`, `true`.

Xác nhận Đông Sơn không bị ánh xạ chính thức:

```sql
select old_name, dissolved_into_village_id, proposed_dissolved_into_village_id,
       mapping_status
from public.villages_legacy
where old_name = 'Thôn Đông Sơn';
```

Kết quả bắt buộc: `dissolved_into_village_id` là `null`, target đề xuất có giá trị và trạng thái là `pending_official_decision`.

## 6. RLS và smoke test

- Ma trận `tests/sql/rls_matrix.sql` có tạo dữ liệu kiểm thử cố định; chỉ chạy trên database biệt lập, không chạy trực tiếp trên database demo đang phục vụ Render.
- CI đã chạy ma trận này trên PostgreSQL 17 và đạt.
- Trên staging demo, thực hiện browser smoke test bằng các tài khoản tổng hợp: anonymous, `can_bo_thon`, `to_cnscd`, `admin_xa`, `lanh_dao`.
- Public chỉ được thấy CT01, CT02, CT09, CT12, CT13 đã publish; CT14 và PII không được xuất hiện.

## 7. Điều kiện merge

Chỉ chuyển PR khỏi draft và merge khi có đủ bằng chứng:

- backup đọc được và có phương án phục hồi;
- cả bốn migration thành công;
- seed và năm số kiểm tra sau migration đúng;
- smoke test không có 401/403/500 ngoài trường hợp mong đợi;
- import batch hiển thị đúng 19/22 tệp, ba nguồn thiếu và khóa Đông Sơn;
- người chịu trách nhiệm staging xác nhận kết quả.
