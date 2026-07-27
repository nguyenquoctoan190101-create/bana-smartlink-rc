-- Backfill only incomplete synthetic demo publications.
--
-- This overlay is deliberately inert on real environments: it requires an
-- existing period explicitly marked with template_name = 'demo-synthetic'.
-- It does not infer values from the unresolved Dong Son merger or alter any
-- non-demo reporting period.

begin;

create temporary table demo_public_backfill_targets
on commit drop
as
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
demo_periods as (
  select id
  from public.report_periods
  where commune_id = 'ba_na'
    and template_name = 'demo-synthetic'
)
select
  village.id as village_id,
  period.id as period_id,
  demo.households,
  demo.population,
  demo.ct13
from demo_villages as demo
join public.villages as village
  on village.commune_id = 'ba_na'
 and village.name = demo.name
 and village.is_active
cross join demo_periods as period
where not exists (
  select 1
  from public.reports as published
  where published.village_id = village.id
    and published.period_id = period.id
    and published.publication_status = 'published'
);

insert into public.report_period_villages (period_id, village_id)
select period_id, village_id
from demo_public_backfill_targets
on conflict do nothing;

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
  village_id,
  period_id,
  'draft',
  'not_submitted',
  'private',
  'direct_api',
  null,
  null,
  null
from demo_public_backfill_targets
on conflict (village_id, period_id) do update set
  workflow_status = 'draft',
  timeliness_status = 'not_submitted',
  publication_status = 'private',
  report_source = 'direct_api',
  submitted_at = null,
  approved_at = null,
  published_at = null;

insert into public.report_values (report_id, ct_code, value, note)
select
  report.id,
  indicator.ct_code,
  indicator.value,
  'Dữ liệu tổng hợp phục vụ demo cuộc thi; không phải dữ liệu thực tế.'
from demo_public_backfill_targets as demo
join public.reports as report
  on report.village_id = demo.village_id
 and report.period_id = demo.period_id
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

update public.reports as report
set
  workflow_status = 'approved',
  timeliness_status = 'on_time',
  publication_status = 'published',
  submitted_at = now(),
  approved_at = now(),
  published_at = now()
from demo_public_backfill_targets as target
where report.village_id = target.village_id
  and report.period_id = target.period_id;

commit;
