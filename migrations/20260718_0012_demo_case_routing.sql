-- Demo routing catalogue for the competition release.
-- These rows are explicitly marked as demo data and must be reviewed by the
-- commune before any real operational SLA is announced.
begin;

alter table public.routing_rules
  add column if not exists verification_minutes integer not null default 480,
  add column if not exists resolution_minutes integer not null default 4320,
  add column if not exists escalation_department text,
  add column if not exists is_demo boolean not null default false,
  add column if not exists sla_version text not null default 'unversioned';

alter table public.routing_rules
  drop constraint if exists routing_rules_verification_minutes_check,
  add constraint routing_rules_verification_minutes_check
    check (verification_minutes between 15 and 43200),
  drop constraint if exists routing_rules_resolution_minutes_check,
  add constraint routing_rules_resolution_minutes_check
    check (resolution_minutes between 15 and 43200),
  drop constraint if exists routing_rules_escalation_not_blank,
  add constraint routing_rules_escalation_not_blank
    check (escalation_department is null or btrim(escalation_department) <> ''),
  drop constraint if exists routing_rules_sla_version_not_blank,
  add constraint routing_rules_sla_version_not_blank
    check (btrim(sla_version) <> '');

insert into public.routing_rules (
  commune_id, category, department, priority, verification_minutes,
  resolution_minutes, escalation_department, is_active, is_demo, sla_version
)
values
  ('ba_na', 'road', 'Bộ phận Địa chính - Xây dựng - Môi trường', 'normal', 480, 7200, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18'),
  ('ba_na', 'waste', 'Bộ phận Địa chính - Xây dựng - Môi trường', 'normal', 240, 2880, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18'),
  ('ba_na', 'water', 'Bộ phận phụ trách hạ tầng và đơn vị cấp nước', 'normal', 240, 1440, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18'),
  ('ba_na', 'power', 'Bộ phận phụ trách hạ tầng và đơn vị điện lực', 'normal', 240, 2880, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18'),
  ('ba_na', 'public_building', 'Bộ phận Văn hóa - Xã hội và quản lý công trình', 'normal', 480, 7200, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18'),
  ('ba_na', 'drainage', 'Ban Chỉ huy PCTT và Bộ phận hạ tầng', 'normal', 120, 1440, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18'),
  ('ba_na', 'safety', 'Công an xã và Ban Chỉ huy PCTT', 'normal', 30, 240, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18'),
  ('ba_na', 'other', 'Văn phòng HĐND và UBND xã', 'normal', 480, 7200, 'Lãnh đạo UBND xã Bà Nà', true, true, 'demo-2026-07-18')
on conflict (commune_id, category, priority) do update
set department = excluded.department,
    verification_minutes = excluded.verification_minutes,
    resolution_minutes = excluded.resolution_minutes,
    escalation_department = excluded.escalation_department,
    is_active = excluded.is_active,
    is_demo = excluded.is_demo,
    sla_version = excluded.sla_version
where public.routing_rules.is_demo;

alter table public.citizen_cases
  add column if not exists routing_rule_id uuid references public.routing_rules(id) on delete set null;

create or replace function public.create_citizen_case(
  p_commune_id text, p_village_id uuid, p_category text, p_description text,
  p_priority text, p_submitter_name text, p_submitter_phone text,
  p_submitter_address text, p_consent_version text, p_consent_at timestamptz,
  p_tracking_code_hash text, p_latitude numeric default null,
  p_longitude numeric default null, p_accuracy_m numeric default null,
  p_location_source text default null, p_location_confirmed boolean default false
) returns table (id uuid, status text, created_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  new_id uuid;
  selected_rule public.routing_rules%rowtype;
begin
  if p_consent_version is null or p_consent_at is null then
    raise exception 'consent_required' using errcode = '23514';
  end if;

  select rr.* into selected_rule
  from public.routing_rules rr
  where rr.commune_id = p_commune_id
    and rr.category = p_category
    and rr.priority in (p_priority, 'normal')
    and rr.is_active
  order by case when rr.priority = p_priority then 0 else 1 end
  limit 1;

  insert into public.citizen_cases(
    commune_id, village_id, category, description, priority,
    assigned_department, sla_due_at, routing_rule_id,
    submitter_name, submitter_phone, submitter_address,
    consent_version, consent_at, tracking_code_hash
  )
  values (
    p_commune_id, p_village_id, p_category, p_description, p_priority,
    selected_rule.department,
    case
      when selected_rule.id is null then null
      else now() + make_interval(mins => selected_rule.resolution_minutes)
    end,
    selected_rule.id,
    nullif(btrim(p_submitter_name), ''), nullif(btrim(p_submitter_phone), ''),
    nullif(btrim(p_submitter_address), ''), p_consent_version, p_consent_at,
    p_tracking_code_hash
  )
  returning citizen_cases.id into new_id;

  if p_latitude is not null and p_longitude is not null then
    insert into public.case_locations(
      case_id, latitude, longitude, accuracy_m, source, confirmed_by_submitter
    )
    values (
      new_id, p_latitude, p_longitude, p_accuracy_m,
      coalesce(p_location_source, 'manual_pin'), p_location_confirmed
    );
  end if;

  return query
    select c.id, c.status, c.created_at
    from public.citizen_cases c
    where c.id = new_id;
end
$$;

create or replace function public.assign_citizen_case(
  p_case_id uuid, p_department text, p_assignee_id uuid default null
) returns table (
  id uuid, status text, assigned_department text, sla_due_at timestamptz
)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  target_case public.citizen_cases%rowtype;
  selected_rule public.routing_rules%rowtype;
begin
  if coalesce(public.profile_role()::text, '') <> 'admin_xa'
     or not coalesce(public.profile_can_mutate(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_department is null or btrim(p_department) = '' then
    raise exception 'department_required' using errcode = '23514';
  end if;

  select c.* into target_case
  from public.citizen_cases c
  where c.id = p_case_id
    and c.commune_id = public.profile_commune_id()
  for update;
  if target_case.id is null then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;

  select rr.* into selected_rule
  from public.routing_rules rr
  where rr.commune_id = target_case.commune_id
    and rr.category = target_case.category
    and rr.department = btrim(p_department)
    and rr.priority in (target_case.priority, 'normal')
    and rr.is_active
  order by case when rr.priority = target_case.priority then 0 else 1 end
  limit 1;

  insert into public.case_assignments(
    case_id, department, assignee_id, assigned_by
  )
  values (target_case.id, btrim(p_department), p_assignee_id, auth.uid());

  update public.citizen_cases c
  set assigned_department = btrim(p_department),
      routing_rule_id = selected_rule.id,
      sla_due_at = case
        when selected_rule.id is null then c.sla_due_at
        else now() + make_interval(mins => selected_rule.resolution_minutes)
      end,
      status = 'assigned'
  where c.id = target_case.id;

  return query
    select c.id, c.status, c.assigned_department, c.sla_due_at
    from public.citizen_cases c
    where c.id = target_case.id;
end
$$;

revoke all on function public.assign_citizen_case(uuid, text, uuid) from public, anon;
grant execute on function public.assign_citizen_case(uuid, text, uuid) to authenticated;

commit;
