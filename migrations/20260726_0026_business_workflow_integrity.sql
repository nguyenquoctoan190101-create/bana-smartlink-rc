-- Keep operational work, field-report closure and tenant references coherent.
begin;

-- A reopened item must not retain a completion timestamp.  Historical rows are
-- normalized before the stricter invariant is installed.
update public.action_items
set completed_at = null
where status <> 'completed' and completed_at is not null;

alter table public.action_items
  drop constraint if exists action_items_completion_check;
alter table public.action_items
  add constraint action_items_completion_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  );

alter table public.action_items
  drop constraint if exists action_items_terminal_outcome_check;
alter table public.action_items
  add constraint action_items_terminal_outcome_check check (
    status not in ('completed', 'cancelled')
    or nullif(btrim(outcome), '') is not null
  ) not valid;

create or replace function public.validate_action_item_scope()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.user_profiles creator
    where creator.id = new.created_by
      and creator.commune_id = new.commune_id
      and creator.is_active
  ) then
    raise exception 'action creator is outside commune or inactive'
      using errcode = '23514';
  end if;

  if new.owner_id is not null and not exists (
    select 1 from public.user_profiles owner_profile
    where owner_profile.id = new.owner_id
      and owner_profile.commune_id = new.commune_id
      and owner_profile.is_active
  ) then
    raise exception 'action owner is outside commune or inactive'
      using errcode = '23514';
  end if;

  if new.period_id is not null and not exists (
    select 1 from public.report_periods period
    where period.id = new.period_id and period.commune_id = new.commune_id
  ) then
    raise exception 'action period is outside commune'
      using errcode = '23514';
  end if;

  if new.village_id is not null and not exists (
    select 1 from public.villages village
    where village.id = new.village_id and village.commune_id = new.commune_id
  ) then
    raise exception 'action village is outside commune'
      using errcode = '23514';
  end if;

  if new.period_id is not null and new.village_id is not null and not exists (
    select 1 from public.report_period_villages assignment
    where assignment.period_id = new.period_id
      and assignment.village_id = new.village_id
  ) then
    raise exception 'action village is not assigned to period'
      using errcode = '23514';
  end if;

  return new;
end
$$;

drop trigger if exists action_items_scope_integrity on public.action_items;
create trigger action_items_scope_integrity
before insert or update of commune_id, period_id, village_id, owner_id, created_by
on public.action_items
for each row execute function public.validate_action_item_scope();

-- Closing a field report is an administrative decision.  Preserve the
-- operator's concrete result/reason in the status history instead of a generic
-- generated note.
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
  if p_new_status in ('completed', 'out_of_scope', 'rejected')
     and nullif(btrim(p_note), '') is null then
    raise exception 'terminal_note_required' using errcode = '23514';
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
  update public.citizen_cases set status = p_new_status
  where id = target_case.id;
  perform set_config('app.case_transition_note', '', true);

  return query select c.* from public.citizen_cases c
  where c.id = target_case.id;
end
$$;

revoke all on function public.transition_citizen_case(uuid, text, text)
from public, anon;
grant execute on function public.transition_citizen_case(uuid, text, text)
to authenticated;

commit;
