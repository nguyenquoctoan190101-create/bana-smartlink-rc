-- Load the reviewed, PII-free aggregate from the organizer sample workbook.
--
-- The source package is incomplete (19/22 legacy villages) and the northern
-- Dong Son boundary is unresolved. Therefore this overlay creates only six
-- complete current-village drafts in a separate private sample period. It
-- never changes the published synthetic demo period and never publishes data.

begin;

create temporary table reconciled_sample_targets (
  village_name text primary key,
  ct01 integer not null,
  ct02 integer not null,
  ct03 integer not null,
  ct04 integer not null,
  ct05 integer not null,
  ct06 integer not null,
  ct07 integer not null,
  ct08 integer not null,
  ct09 integer not null,
  ct10 integer not null,
  ct11 integer not null,
  ct12 integer not null,
  ct13 integer not null,
  ct14 integer not null
) on commit drop;

insert into reconciled_sample_targets (
  village_name,
  ct01, ct02, ct03, ct04, ct05, ct06, ct07,
  ct08, ct09, ct10, ct11, ct12, ct13, ct14
)
select *
from (
  values
    ('Thôn Thạch Nham Đông', 434, 1607, 8, 17, 39, 44, 341, 5, 351, 965, 1463, 8, 95, 2),
    ('Thôn Phước Hưng', 272, 873, 14, 13, 35, 70, 218, 8, 249, 547, 767, 7, 90, 0),
    ('Thôn Phú Hòa', 1033, 4034, 45, 27, 32, 95, 914, 3, 909, 2380, 3623, 15, 199, 1),
    ('Thôn Thái Lai', 1345, 4927, 48, 54, 92, 134, 1045, 7, 1162, 2956, 4421, 22, 281, 4),
    ('Thôn Phước Khương', 1421, 4968, 49, 37, 60, 137, 1147, 7, 1264, 3138, 4536, 24, 199, 3),
    ('Thôn An Sơn', 247, 882, 8, 6, 30, 49, 206, 1, 224, 561, 775, 8, 34, 2)
) as reviewed(
  village_name,
  ct01, ct02, ct03, ct04, ct05, ct06, ct07,
  ct08, ct09, ct10, ct11, ct12, ct13, ct14
)
where exists (
  select 1
  from public.report_periods
  where commune_id = 'ba_na'
    and template_name = 'demo-synthetic'
)
and not exists (
  select 1
  from public.audit_log
  where commune_id = 'ba_na'
    and action = 'SAMPLE_SOURCE_RECONCILIATION'
    and details ->> 'summary_sha256' =
      'caa9178f3c6975a553578e1c69558813dcb72f4e4ba20c65c4910b3b1fb033cb'
);

insert into public.report_periods (
  commune_id,
  name,
  due_date,
  template_name
)
select
  'ba_na',
  'Đối soát dữ liệu mẫu — Quý II/2026',
  '2026-06-15T10:00:00Z'::timestamptz,
  'sample-reconciled'
where exists (select 1 from reconciled_sample_targets)
on conflict (commune_id, name) do nothing;

insert into public.report_period_villages (period_id, village_id)
select period.id, village.id
from public.report_periods as period
join public.villages as village
  on village.commune_id = period.commune_id
 and village.is_active
where period.commune_id = 'ba_na'
  and period.name = 'Đối soát dữ liệu mẫu — Quý II/2026'
  and period.template_name = 'sample-reconciled'
  and exists (select 1 from reconciled_sample_targets)
on conflict do nothing;

insert into public.reports (
  village_id,
  period_id,
  workflow_status,
  timeliness_status,
  publication_status,
  report_source
)
select
  village.id,
  period.id,
  'draft',
  'not_submitted',
  'private',
  'excel'
from reconciled_sample_targets as source
join public.villages as village
  on village.commune_id = 'ba_na'
 and village.name = source.village_name
 and village.is_active
join public.report_periods as period
  on period.commune_id = 'ba_na'
 and period.name = 'Đối soát dữ liệu mẫu — Quý II/2026'
 and period.template_name = 'sample-reconciled'
on conflict (village_id, period_id) do nothing;

insert into public.report_values (report_id, ct_code, value, note)
select
  report.id,
  indicator.ct_code,
  indicator.value,
  'Tổng hợp từ bảng rà soát Quý II/2026; dữ liệu mẫu, riêng tư, chờ quản trị xã kiểm tra và gửi.'
from reconciled_sample_targets as source
join public.villages as village
  on village.commune_id = 'ba_na'
 and village.name = source.village_name
join public.report_periods as period
  on period.commune_id = 'ba_na'
 and period.name = 'Đối soát dữ liệu mẫu — Quý II/2026'
 and period.template_name = 'sample-reconciled'
join public.reports as report
  on report.village_id = village.id
 and report.period_id = period.id
 and report.workflow_status = 'draft'
 and report.publication_status = 'private'
cross join lateral (
  values
    ('CT01', source.ct01),
    ('CT02', source.ct02),
    ('CT03', source.ct03),
    ('CT04', source.ct04),
    ('CT05', source.ct05),
    ('CT06', source.ct06),
    ('CT07', source.ct07),
    ('CT08', source.ct08),
    ('CT09', source.ct09),
    ('CT10', source.ct10),
    ('CT11', source.ct11),
    ('CT12', source.ct12),
    ('CT13', source.ct13),
    ('CT14', source.ct14)
) as indicator(ct_code, value)
on conflict (report_id, ct_code) do nothing;

insert into public.audit_log (
  commune_id,
  action,
  table_name,
  details
)
select
  'ba_na',
  'SAMPLE_SOURCE_RECONCILIATION',
  'reports',
  jsonb_build_object(
    'classification', 'sample-data',
    'summary_filename', 'TONG_HOP_va_THEO_DOI_TIEN_DO.xlsx',
    'summary_sha256', 'caa9178f3c6975a553578e1c69558813dcb72f4e4ba20c65c4910b3b1fb033cb',
    'mapping_version', '2026-07-15-infographic-v2',
    'source_workbook_count', 19,
    'missing_legacy_villages', jsonb_build_array(
      'Thôn Ninh An',
      'Thôn Sơn Phước',
      'Thôn Thạch Nham Tây'
    ),
    'unresolved_mapping_villages', jsonb_build_array('Thôn Đông Sơn'),
    'corrected_cells', 6,
    'draft_current_villages', 6,
    'excluded_current_villages', jsonb_build_array(
      'Thôn Hòa Nhơn',
      'Thôn Hòa Ninh',
      'Thôn Sơn Phước',
      'Thôn Thạch Nham Tây'
    ),
    'publication_status', 'private'
  )
where exists (select 1 from reconciled_sample_targets)
  and (
    select count(*)
    from public.report_period_villages as assignment
    join public.report_periods as period
      on period.id = assignment.period_id
    where period.commune_id = 'ba_na'
      and period.name = 'Đối soát dữ liệu mẫu — Quý II/2026'
      and period.template_name = 'sample-reconciled'
  ) = 10
  and (
    select count(*)
    from public.reports as report
    join public.report_periods as period
      on period.id = report.period_id
    where period.commune_id = 'ba_na'
      and period.name = 'Đối soát dữ liệu mẫu — Quý II/2026'
      and period.template_name = 'sample-reconciled'
      and report.workflow_status = 'draft'
      and report.publication_status = 'private'
  ) = 6
  and (
    select count(*)
    from public.report_values as value
    join public.reports as report
      on report.id = value.report_id
    join public.report_periods as period
      on period.id = report.period_id
    where period.commune_id = 'ba_na'
      and period.name = 'Đối soát dữ liệu mẫu — Quý II/2026'
      and period.template_name = 'sample-reconciled'
  ) = 84;

commit;
