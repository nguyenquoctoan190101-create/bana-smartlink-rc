\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000a001'),
  ('00000000-0000-4000-8000-00000000a002'),
  ('00000000-0000-4000-8000-00000000a003'),
  ('00000000-0000-4000-8000-00000000a004'),
  ('00000000-0000-4000-8000-00000000a005');

insert into public.villages (id, commune_id, name) values
  ('00000000-0000-4000-8000-00000000c001', 'ba_na', 'Thôn kiểm thử 1'),
  ('00000000-0000-4000-8000-00000000c002', 'ba_na', 'Thôn kiểm thử 2');

insert into public.user_profiles
  (id, commune_id, display_name, role, village_id, is_active, force_password_reset)
values
  ('00000000-0000-4000-8000-00000000a001', 'ba_na', 'Admin', 'admin_xa', null, true, false),
  ('00000000-0000-4000-8000-00000000a002', 'ba_na', 'Cán bộ', 'can_bo_thon', '00000000-0000-4000-8000-00000000c001', true, false),
  ('00000000-0000-4000-8000-00000000a003', 'ba_na', 'CNSCĐ', 'to_cnscd', null, true, false),
  ('00000000-0000-4000-8000-00000000a004', 'ba_na', 'Lãnh đạo', 'lanh_dao', null, true, false),
  ('00000000-0000-4000-8000-00000000a005', 'ba_na', 'Buộc đổi mật khẩu', 'can_bo_thon', '00000000-0000-4000-8000-00000000c002', true, true);

insert into public.user_village_assignments (user_id, village_id, assigned_by)
values (
  '00000000-0000-4000-8000-00000000a003',
  '00000000-0000-4000-8000-00000000c002',
  '00000000-0000-4000-8000-00000000a001'
);

insert into public.report_periods (id, commune_id, name, due_date, created_by)
values (
  '00000000-0000-4000-8000-00000000d001',
  'ba_na',
  'Kỳ kiểm thử RLS',
  '2026-07-17T17:00:00+07:00',
  '00000000-0000-4000-8000-00000000a001'
);

insert into public.report_period_villages (period_id, village_id) values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001'),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c002');

insert into public.reports (
  id, village_id, period_id, workflow_status, timeliness_status,
  publication_status, report_source, created_by, submitted_by,
  approved_by, published_by, submitted_at, approved_at, published_at
) values
  (
    '00000000-0000-4000-8000-00000000b001',
    '00000000-0000-4000-8000-00000000c001',
    '00000000-0000-4000-8000-00000000d001',
    'draft', 'not_submitted', 'private', 'manual',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a002',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a001',
    null, null, null
  ),
  (
    '00000000-0000-4000-8000-00000000b002',
    '00000000-0000-4000-8000-00000000c002',
    '00000000-0000-4000-8000-00000000d001',
    'draft', 'not_submitted', 'private', 'manual',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a003',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a001',
    null, null, null
  );

insert into public.report_values (report_id, ct_code, value)
select report_id, ct_code, value
from (
  values
    ('00000000-0000-4000-8000-00000000b001'::uuid, 10),
    ('00000000-0000-4000-8000-00000000b002'::uuid, 20)
) as report(report_id, households)
cross join lateral (
  values
    ('CT01', households), ('CT02', households * 4),
    ('CT03', 1), ('CT04', 1), ('CT05', 1), ('CT06', 1),
    ('CT07', households), ('CT08', 1), ('CT09', households - 1),
    ('CT10', households * 2), ('CT11', households * 3),
    ('CT12', 6), ('CT13', 2), ('CT14', 1)
) as indicator(ct_code, value);

update public.reports
set workflow_status = 'approved', timeliness_status = 'on_time',
    publication_status = 'published', submitted_at = now(),
    approved_at = now(), published_at = now();

do $$
begin
  if has_table_privilege('anon', 'public.reports', 'select') then
    raise exception 'anon unexpectedly has direct report table access';
  end if;
  if has_table_privilege('anon', 'public.published_report_summary', 'select') then
    raise exception 'anon unexpectedly has direct public-view access';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', false);
do $$
begin
  if (select count(*) from public.reports) <> 1 then
    raise exception 'can_bo_thon can read outside own village';
  end if;
  if (select count(*) from public.report_values where ct_code = 'CT14') <> 1 then
    raise exception 'can_bo_thon cannot read own-village CT14';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a003', false);
do $$
begin
  if (select count(*) from public.reports) <> 1 then
    raise exception 'to_cnscd assignment scope is incorrect';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a004', false);
do $$
declare
  affected_rows integer;
begin
  if (select count(*) from public.reports) <> 2 then
    raise exception 'lanh_dao should read commune reports';
  end if;
  update public.reports set report_source = 'direct_api'
  where id = '00000000-0000-4000-8000-00000000b001';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'lanh_dao unexpectedly mutated a report';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a005', false);
do $$
declare
  affected_rows integer;
begin
  if (select count(*) from public.reports) <> 1 then
    raise exception 'force-reset user should retain scoped read access';
  end if;
  update public.reports set report_source = 'direct_api'
  where id = '00000000-0000-4000-8000-00000000b002';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'force-reset user unexpectedly mutated a report';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a001', false);
do $$
begin
  if (select count(*) from public.reports) <> 2 then
    raise exception 'admin_xa should read all commune reports';
  end if;
end
$$;
update public.reports set report_source = 'direct_api'
where id = '00000000-0000-4000-8000-00000000b001';
reset role;

rollback;
