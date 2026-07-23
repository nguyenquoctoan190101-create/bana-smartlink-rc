-- Harden citizen-case scoping and force all workflow mutations through
-- audited, transactional RPCs.
begin;

revoke update on table public.citizen_cases from authenticated;
drop policy if exists citizen_cases_update_internal on public.citizen_cases;

drop policy if exists citizen_cases_select_internal on public.citizen_cases;
create policy citizen_cases_select_internal on public.citizen_cases
for select to authenticated using (
  commune_id = public.profile_commune_id()
  and (
    public.profile_role() in ('admin_xa', 'lanh_dao')
    or (
      public.profile_role() in ('to_cnscd', 'can_bo_thon')
      and village_id is not null
      and public.can_select_village(village_id)
    )
  )
);

drop policy if exists case_locations_select_internal on public.case_locations;
create policy case_locations_select_internal on public.case_locations
for select to authenticated using (
  exists (
    select 1
    from public.citizen_cases c
    where c.id = case_id
      and c.commune_id = public.profile_commune_id()
      and (
        public.profile_role() in ('admin_xa', 'lanh_dao')
        or (
          public.profile_role() in ('to_cnscd', 'can_bo_thon')
          and c.village_id is not null
          and public.can_select_village(c.village_id)
        )
      )
  )
);

drop policy if exists case_media_select_internal on public.case_media;
create policy case_media_select_internal on public.case_media
for select to authenticated using (
  exists (
    select 1
    from public.citizen_cases c
    where c.id = case_id
      and c.commune_id = public.profile_commune_id()
      and (
        public.profile_role() in ('admin_xa', 'lanh_dao')
        or (
          public.profile_role() in ('to_cnscd', 'can_bo_thon')
          and c.village_id is not null
          and public.can_select_village(c.village_id)
        )
      )
  )
);

drop policy if exists case_history_select_internal on public.case_status_history;
create policy case_history_select_internal on public.case_status_history
for select to authenticated using (
  exists (
    select 1
    from public.citizen_cases c
    where c.id = case_id
      and c.commune_id = public.profile_commune_id()
      and (
        public.profile_role() in ('admin_xa', 'lanh_dao')
        or (
          public.profile_role() in ('to_cnscd', 'can_bo_thon')
          and c.village_id is not null
          and public.can_select_village(c.village_id)
        )
      )
  )
);

drop policy if exists case_assignments_select_internal on public.case_assignments;
create policy case_assignments_select_internal on public.case_assignments
for select to authenticated using (
  exists (
    select 1
    from public.citizen_cases c
    where c.id = case_id
      and c.commune_id = public.profile_commune_id()
      and (
        public.profile_role() in ('admin_xa', 'lanh_dao')
        or (
          public.profile_role() in ('to_cnscd', 'can_bo_thon')
          and c.village_id is not null
          and public.can_select_village(c.village_id)
        )
      )
  )
);

create or replace function public.citizen_case_audit_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  transition_note text;
begin
  transition_note := nullif(current_setting('app.case_transition_note', true), '');
  if tg_op = 'INSERT' then
    insert into public.case_status_history(case_id, new_status, changed_by, note)
    values (new.id, new.status, auth.uid(), coalesce(transition_note, 'received'));
  elsif old.status is distinct from new.status then
    insert into public.case_status_history(
      case_id, old_status, new_status, changed_by, note
    )
    values (
      new.id, old.status, new.status, auth.uid(),
      coalesce(transition_note, 'Trạng thái được cập nhật theo quy trình.')
    );
  end if;
  return new;
end
$$;

create or replace function public.transition_citizen_case(
  p_case_id uuid, p_new_status text, p_note text default null
) returns setof public.citizen_cases
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_case public.citizen_cases%rowtype;
  actor_role text := coalesce(public.profile_role()::text, '');
  allowed boolean := false;
begin
  if actor_role not in ('admin_xa', 'to_cnscd')
     or not coalesce(public.profile_can_mutate(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_new_status not in (
    'received', 'verifying', 'assigned', 'in_progress',
    'completed', 'out_of_scope', 'rejected'
  ) then
    raise exception 'invalid_status' using errcode = '23514';
  end if;

  select c.* into target_case
  from public.citizen_cases c
  where c.id = p_case_id
    and c.commune_id = public.profile_commune_id()
  for update;
  if target_case.id is null then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  if actor_role = 'to_cnscd'
     and target_case.village_id is not null
     and not public.can_select_village(target_case.village_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_case.status = p_new_status then
    allowed := true;
  elsif actor_role = 'to_cnscd' then
    allowed := (target_case.status = 'assigned' and p_new_status = 'in_progress')
      or (target_case.status = 'in_progress' and p_new_status = 'completed');
  else
    allowed :=
      (target_case.status = 'received' and p_new_status in ('verifying', 'assigned', 'out_of_scope', 'rejected'))
      or (target_case.status = 'verifying' and p_new_status in ('assigned', 'out_of_scope', 'rejected'))
      or (target_case.status = 'assigned' and p_new_status in ('verifying', 'in_progress'))
      or (target_case.status = 'in_progress' and p_new_status in ('assigned', 'completed'));
  end if;
  if not allowed then
    raise exception 'invalid_status_transition:%->%',
      target_case.status, p_new_status using errcode = 'P0001';
  end if;

  perform set_config(
    'app.case_transition_note',
    coalesce(nullif(btrim(p_note), ''), 'Trạng thái được cập nhật theo quy trình.'),
    true
  );
  update public.citizen_cases
  set status = p_new_status
  where id = target_case.id;
  perform set_config('app.case_transition_note', '', true);

  return query
    select c.*
    from public.citizen_cases c
    where c.id = target_case.id;
end
$$;

revoke all on function public.transition_citizen_case(uuid, text, text) from public, anon;
grant execute on function public.transition_citizen_case(uuid, text, text) to authenticated;

-- Public reporters cannot self-declare an operational priority.  All new
-- reports start at normal priority; authorised staff may triage them later.
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
    and rr.priority = 'normal'
    and rr.is_active
  limit 1;

  insert into public.citizen_cases(
    commune_id, village_id, category, description, priority,
    assigned_department, sla_due_at, routing_rule_id,
    submitter_name, submitter_phone, submitter_address,
    consent_version, consent_at, tracking_code_hash
  )
  values (
    p_commune_id, p_village_id, p_category, p_description, 'normal',
    selected_rule.department,
    case when selected_rule.id is null then null
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
    ) values (
      new_id, p_latitude, p_longitude, p_accuracy_m,
      coalesce(p_location_source, 'manual_pin'), p_location_confirmed
    );
  end if;

  return query select c.id, c.status, c.created_at
  from public.citizen_cases c where c.id = new_id;
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
  if target_case.status in ('completed', 'out_of_scope', 'rejected') then
    raise exception 'terminal_case' using errcode = 'P0001';
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
  ) values (target_case.id, btrim(p_department), p_assignee_id, auth.uid());

  perform set_config(
    'app.case_transition_note',
    'Phân công cho ' || btrim(p_department) || '.',
    true
  );
  update public.citizen_cases c
  set assigned_department = btrim(p_department),
      routing_rule_id = selected_rule.id,
      sla_due_at = case when selected_rule.id is null then c.sla_due_at
                        else now() + make_interval(mins => selected_rule.resolution_minutes)
                   end,
      status = 'assigned'
  where c.id = target_case.id;
  perform set_config('app.case_transition_note', '', true);

  return query
    select c.id, c.status, c.assigned_department, c.sla_due_at
    from public.citizen_cases c where c.id = target_case.id;
end
$$;

revoke all on function public.assign_citizen_case(uuid, text, uuid) from public, anon;
grant execute on function public.assign_citizen_case(uuid, text, uuid) to authenticated;

commit;
