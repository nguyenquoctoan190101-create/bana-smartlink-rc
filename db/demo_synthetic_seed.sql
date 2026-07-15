-- BaNa SmartLink: synthetic demo data only.
--
-- Run this once after db/schema.sql on a fresh competition/demo project.
-- It is idempotent and contains no citizen PII, credentials, or CT14 in the
-- public API response (the application filters CT14 itself).

begin;

with demo_villages (name, households, population, ct13) as (
  values
    ('Thôn An Sơn', 318, 1176, 124),
    ('Thôn Hòa Ninh', 496, 1835, 186),
    ('Thôn Hòa Nhơn', 421, 1558, 163),
    ('Thôn Phú Hòa', 602, 2227, 240),
    ('Thôn Phước Hưng', 571, 2113, 218),
    ('Thôn Phước Khương', 534, 1976, 205),
    ('Thôn Sơn Phước', 388, 1436, 151),
    ('Thôn Thạch Nham Đông', 553, 2046, 213),
    ('Thôn Thạch Nham Tây', 533, 1972, 198),
    ('Thôn Thái Lai', 546, 2020, 221)
),
upsert_villages as (
  insert into public.villages (commune_id, name, household_count, mapping_status)
  select
    'ba_na_demo',
    name,
    jsonb_build_object('2026-07', households),
    'confirmed'
  from demo_villages
  on conflict (commune_id, name) do update set
    household_count = excluded.household_count,
    mapping_status = excluded.mapping_status,
    is_active = true
  returning id, name
),
upsert_period as (
  insert into public.report_periods (commune_id, name, due_date, template_name)
  values (
    'ba_na_demo',
    'Bản công bố minh họa — Tháng 7/2026',
    '2026-07-31T16:59:59+07:00',
    'demo-synthetic'
  )
  on conflict (commune_id, name) do update set
    due_date = excluded.due_date,
    template_name = excluded.template_name
  returning id
),
period_scope as (
  insert into public.report_period_villages (period_id, village_id)
  select period.id, village.id
  from upsert_period as period
  cross join upsert_villages as village
  on conflict do nothing
  returning period_id
),
upsert_reports as (
  insert into public.reports (
    village_id,
    period_id,
    workflow_status,
    timeliness_status,
    publication_status,
    report_source,
    submitted_at,
    approved_at,
    published_at
  )
  select
    village.id,
    period.id,
    'approved',
    'on_time',
    'published',
    'direct_api',
    now(),
    now(),
    now()
  from upsert_villages as village
  cross join upsert_period as period
  on conflict (village_id, period_id) do update set
    workflow_status = excluded.workflow_status,
    timeliness_status = excluded.timeliness_status,
    publication_status = excluded.publication_status,
    report_source = excluded.report_source,
    submitted_at = excluded.submitted_at,
    approved_at = excluded.approved_at,
    published_at = excluded.published_at
  returning id, village_id
)
insert into public.report_values (report_id, ct_code, value, note)
select
  report.id,
  indicator.ct_code,
  indicator.value,
  'Dữ liệu tổng hợp phục vụ demo cuộc thi; không phải dữ liệu thực tế.'
from upsert_reports as report
join upsert_villages as village on village.id = report.village_id
join demo_villages as demo on demo.name = village.name
cross join lateral (
  values
    ('CT01', demo.households),
    ('CT02', demo.population),
    ('CT03', greatest(1, demo.households / 25)),
    ('CT04', greatest(1, demo.households / 18)),
    ('CT05', greatest(1, demo.population / 120)),
    ('CT06', greatest(1, demo.population / 80)),
    ('CT07', greatest(1, demo.population / 5)),
    ('CT08', greatest(1, demo.population / 250)),
    ('CT09', (demo.households * 9) / 10),
    ('CT10', (demo.population * 3) / 5),
    ('CT11', (demo.population * 19) / 20),
    ('CT12', 6),
    ('CT13', demo.ct13),
    ('CT14', 0)
) as indicator(ct_code, value)
on conflict (report_id, ct_code) do update set
  value = excluded.value,
  note = excluded.note;

commit;
