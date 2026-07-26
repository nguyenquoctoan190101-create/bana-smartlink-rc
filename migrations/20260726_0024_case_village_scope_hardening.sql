begin;

-- The public endpoint pins p_commune_id to the configured commune, but the
-- anonymous caller supplies p_village_id.  The SECURITY DEFINER boundary must
-- therefore prove that the optional village belongs to that same commune
-- before it writes any citizen PII or operational data.
drop function if exists public.create_citizen_case(
  text, uuid, text, text, text, text, text, text, text, timestamptz, text,
  numeric, numeric, numeric, text, boolean
);

create or replace function public.create_citizen_case(
  p_commune_id text, p_village_id uuid, p_category text, p_description text,
  p_priority text, p_submitter_name text, p_submitter_phone text,
  p_submitter_address text, p_consent_version text, p_consent_at timestamptz,
  p_tracking_code_hash text, p_latitude numeric default null,
  p_longitude numeric default null, p_accuracy_m numeric default null,
  p_location_source text default null, p_location_confirmed boolean default false,
  p_privacy_consent boolean default false
) returns table (id uuid, status text, created_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  new_id uuid;
  selected_rule public.routing_rules%rowtype;
begin
  if p_privacy_consent is distinct from true
     or p_consent_version is null
     or p_consent_at is null then
    raise exception 'consent_required' using errcode = '23514';
  end if;

  if p_village_id is not null and not exists (
    select 1
    from public.villages village
    where village.id = p_village_id
      and village.commune_id = p_commune_id
  ) then
    raise exception 'village_not_in_commune' using errcode = '23514';
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

revoke all on function public.create_citizen_case(
  text, uuid, text, text, text, text, text, text, text, timestamptz, text,
  numeric, numeric, numeric, text, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.create_citizen_case(
  text, uuid, text, text, text, text, text, text, text, timestamptz, text,
  numeric, numeric, numeric, text, boolean, boolean
) to service_role;

-- SECURITY DEFINER bypasses the table RLS policy, so the assignee tenant must
-- be checked explicitly inside the assignment RPC.
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

  if p_assignee_id is not null and not exists (
    select 1
    from public.user_profiles assignee
    where assignee.id = p_assignee_id
      and assignee.commune_id = target_case.commune_id
  ) then
    raise exception 'assignee_not_in_commune' using errcode = '23514';
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

revoke all on function public.assign_citizen_case(uuid, text, uuid)
from public, anon;
grant execute on function public.assign_citizen_case(uuid, text, uuid)
to authenticated;

-- Public evacuation data is served through the FastAPI whitelist and explicit
-- commune filter.  The base table contains coordinator PII and must never be
-- directly selectable by an anonymous PostgREST role.
revoke select on table public.evacuation_points, public.villages,
  public.village_merge_map from anon;
grant select on table public.evacuation_points, public.villages,
  public.village_merge_map to service_role;

drop policy if exists evacuation_points_select on public.evacuation_points;
create policy evacuation_points_select
on public.evacuation_points for select
to authenticated
using (public.can_select_village(village_id));

drop policy if exists villages_select_active on public.villages;
create policy villages_select_active
on public.villages for select
to authenticated
using (public.can_select_village(id));

drop policy if exists village_merge_map_select on public.village_merge_map;
create policy village_merge_map_select
on public.village_merge_map for select
to authenticated
using (
  public.can_select_village(
    coalesce(new_village_id, proposed_new_village_id)
  )
);

commit;
