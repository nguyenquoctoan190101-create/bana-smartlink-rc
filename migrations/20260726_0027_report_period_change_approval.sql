-- Require leadership approval for every report-period correction or removal.
-- The request and decision ledgers are append-only; deletion is a soft archive.
begin;

alter table public.report_periods
  add column if not exists archived_at timestamptz;

create table if not exists public.report_period_change_requests (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  period_id uuid not null references public.report_periods(id) on delete restrict,
  request_kind text not null,
  reason text not null,
  before_snapshot jsonb not null,
  proposed_snapshot jsonb,
  requested_by uuid not null references public.user_profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  constraint report_period_change_requests_commune_not_blank
    check (btrim(commune_id) <> ''),
  constraint report_period_change_requests_kind_check
    check (request_kind in ('update', 'delete')),
  constraint report_period_change_requests_reason_check
    check (char_length(btrim(reason)) between 10 and 1000),
  constraint report_period_change_requests_before_object
    check (jsonb_typeof(before_snapshot) = 'object'),
  constraint report_period_change_requests_proposal_check check (
    (request_kind = 'update' and jsonb_typeof(proposed_snapshot) = 'object')
    or (request_kind = 'delete' and proposed_snapshot is null)
  )
);

create table if not exists public.report_period_change_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references public.report_period_change_requests(id) on delete restrict,
  decision text not null,
  reason text not null,
  decided_by uuid not null references public.user_profiles(id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint report_period_change_decisions_value_check
    check (decision in ('approved', 'rejected')),
  constraint report_period_change_decisions_reason_check
    check (char_length(btrim(reason)) between 5 and 1000)
);

alter table public.report_periods
  add column if not exists archived_by_request_id uuid;
alter table public.report_periods
  drop constraint if exists report_periods_archive_pair_check;
alter table public.report_periods
  add constraint report_periods_archive_pair_check check (
    (archived_at is null and archived_by_request_id is null)
    or (archived_at is not null and archived_by_request_id is not null)
  );
alter table public.report_periods
  drop constraint if exists report_periods_archived_request_fk;
alter table public.report_periods
  add constraint report_periods_archived_request_fk
  foreign key (archived_by_request_id)
  references public.report_period_change_requests(id) on delete restrict;

create index if not exists report_period_change_requests_commune_created_idx
  on public.report_period_change_requests (commune_id, requested_at desc);
create index if not exists report_period_change_requests_period_idx
  on public.report_period_change_requests (period_id, requested_at desc);
create index if not exists report_period_change_decisions_decided_idx
  on public.report_period_change_decisions (decided_at desc);
create index if not exists report_periods_active_due_idx
  on public.report_periods (commune_id, due_date desc)
  where archived_at is null;

comment on table public.report_period_change_requests is
  'Append-only administrator requests to correct or archive a report period.';
comment on table public.report_period_change_decisions is
  'Append-only leadership decisions. Rows may never be changed or deleted.';
comment on column public.report_periods.archived_at is
  'Soft deletion marker. Existing reports and immutable approval history remain retained.';

create or replace function public.reject_immutable_report_period_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'report period approval history is immutable'
    using errcode = '42501';
end
$$;

drop trigger if exists report_period_change_requests_immutable
  on public.report_period_change_requests;
create trigger report_period_change_requests_immutable
before update or delete on public.report_period_change_requests
for each row execute function public.reject_immutable_report_period_history();

drop trigger if exists report_period_change_decisions_immutable
  on public.report_period_change_decisions;
create trigger report_period_change_decisions_immutable
before update or delete on public.report_period_change_decisions
for each row execute function public.reject_immutable_report_period_history();

create or replace function public.attach_report_period_template(
  p_period_id uuid,
  p_template_name text,
  p_template_path text,
  p_template_sha256 text,
  p_template_size_bytes integer
)
returns public.report_periods
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  target public.report_periods%rowtype;
begin
  if actor is null
     or public.profile_role() <> 'admin_xa'
     or not coalesce(public.profile_can_mutate(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(p_template_name), '') is null
     or nullif(btrim(p_template_path), '') is null
     or p_template_sha256 !~ '^[0-9a-f]{64}$'
     or p_template_size_bytes not between 1 and 5242880 then
    raise exception 'invalid_template_metadata' using errcode = '22023';
  end if;

  update public.report_periods period
  set template_name = btrim(p_template_name),
      template_path = btrim(p_template_path),
      template_sha256 = p_template_sha256,
      template_size_bytes = p_template_size_bytes
  where period.id = p_period_id
    and period.commune_id = public.profile_commune_id()
    and period.archived_at is null
  returning period.* into target;
  if target.id is null then
    raise exception 'period_not_found_or_archived' using errcode = 'P0002';
  end if;

  insert into public.audit_log (
    commune_id, action, table_name, record_id, user_id, details
  ) values (
    target.commune_id, 'ATTACH_REPORT_PERIOD_TEMPLATE', 'report_periods',
    target.id, actor,
    jsonb_build_object(
      'template_name', target.template_name,
      'template_sha256', target.template_sha256,
      'template_size_bytes', target.template_size_bytes
    )
  );
  return target;
end
$$;

create or replace function public.create_report_period_change_request(
  p_period_id uuid,
  p_request_kind text,
  p_reason text,
  p_proposed_name text default null,
  p_proposed_due_date timestamptz default null,
  p_proposed_village_ids uuid[] default null
)
returns public.report_period_change_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  actor_commune text := public.profile_commune_id();
  target public.report_periods%rowtype;
  created_request public.report_period_change_requests%rowtype;
  current_villages jsonb;
  proposed_villages jsonb;
  requested_count integer;
  valid_count integer;
  final_name text;
  final_due_date timestamptz;
  final_villages jsonb;
  before_state jsonb;
  proposed_state jsonb;
begin
  if actor is null
     or public.profile_role() <> 'admin_xa'
     or not coalesce(public.profile_can_mutate(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_request_kind not in ('update', 'delete') then
    raise exception 'invalid_request_kind' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then
    raise exception 'request_reason_required' using errcode = '22023';
  end if;

  select period.* into target
  from public.report_periods period
  where period.id = p_period_id
    and period.commune_id = actor_commune
  for update;
  if target.id is null then
    raise exception 'period_not_found' using errcode = 'P0002';
  end if;
  if target.archived_at is not null then
    raise exception 'period_already_archived' using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.report_period_change_requests request
    left join public.report_period_change_decisions decision
      on decision.request_id = request.id
    where request.period_id = target.id
      and decision.id is null
  ) then
    raise exception 'period_change_request_pending' using errcode = '23505';
  end if;

  select coalesce(
    jsonb_agg(assignment.village_id::text order by assignment.village_id::text),
    '[]'::jsonb
  ) into current_villages
  from public.report_period_villages assignment
  where assignment.period_id = target.id;
  before_state := jsonb_build_object(
    'name', target.name,
    'due_date', target.due_date,
    'village_ids', current_villages
  );

  if p_request_kind = 'delete' then
    if p_proposed_name is not null
       or p_proposed_due_date is not null
       or p_proposed_village_ids is not null then
      raise exception 'delete_request_cannot_propose_changes' using errcode = '22023';
    end if;
    proposed_state := null;
  else
    final_name := coalesce(nullif(btrim(p_proposed_name), ''), target.name);
    final_due_date := coalesce(p_proposed_due_date, target.due_date);
    final_villages := current_villages;

    if p_proposed_name is not null and nullif(btrim(p_proposed_name), '') is null then
      raise exception 'period_name_required' using errcode = '22023';
    end if;
    if p_proposed_due_date is not null and p_proposed_due_date <= now() then
      raise exception 'proposed_due_date_must_be_future' using errcode = '22023';
    end if;
    if p_proposed_village_ids is not null then
      if cardinality(p_proposed_village_ids) = 0 then
        raise exception 'at_least_one_village_required' using errcode = '22023';
      end if;
      select count(distinct village_id), count(*)
      into requested_count, valid_count
      from unnest(p_proposed_village_ids) village_id;
      if requested_count <> cardinality(p_proposed_village_ids) then
        raise exception 'villages_must_be_unique' using errcode = '22023';
      end if;
      select count(*) into valid_count
      from public.villages village
      where village.id = any(p_proposed_village_ids)
        and village.commune_id = actor_commune
        and village.is_active;
      if valid_count <> requested_count then
        raise exception 'villages_must_be_active_and_in_commune' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.reports report
        where report.period_id = target.id
          and not (report.village_id = any(p_proposed_village_ids))
      ) then
        raise exception 'cannot_remove_village_with_reports' using errcode = '22023';
      end if;
      select jsonb_agg(village_id::text order by village_id::text)
      into proposed_villages
      from unnest(p_proposed_village_ids) village_id;
      final_villages := proposed_villages;
    end if;

    proposed_state := jsonb_build_object(
      'name', final_name,
      'due_date', final_due_date,
      'village_ids', final_villages
    );
    if proposed_state = before_state then
      raise exception 'report_period_change_is_noop' using errcode = '22023';
    end if;
  end if;

  insert into public.report_period_change_requests (
    commune_id, period_id, request_kind, reason, before_snapshot,
    proposed_snapshot, requested_by
  ) values (
    actor_commune, target.id, p_request_kind, btrim(p_reason), before_state,
    proposed_state, actor
  ) returning * into created_request;

  insert into public.audit_log (
    commune_id, action, table_name, record_id, user_id, details
  ) values (
    actor_commune,
    case when p_request_kind = 'delete'
      then 'REQUEST_REPORT_PERIOD_DELETE'
      else 'REQUEST_REPORT_PERIOD_UPDATE' end,
    'report_period_change_requests', created_request.id, actor,
    jsonb_build_object(
      'period_id', target.id,
      'reason', created_request.reason,
      'before', before_state,
      'proposed', proposed_state
    )
  );

  insert into public.notifications (user_id, title, body, url)
  select leader.id,
    'Yêu cầu thay đổi kỳ báo cáo cần phê duyệt',
    format('%s đề nghị %s kỳ %s',
      coalesce((select display_name from public.user_profiles where id = actor), 'Quản trị viên'),
      case when p_request_kind = 'delete' then 'lưu trữ' else 'điều chỉnh' end,
      target.name),
    '/app/period-change-requests'
  from public.user_profiles leader
  where leader.commune_id = actor_commune
    and leader.role = 'lanh_dao'
    and leader.is_active
    and not leader.force_password_reset;

  return created_request;
end
$$;

create or replace function public.decide_report_period_change_request(
  p_request_id uuid,
  p_decision text,
  p_reason text
)
returns public.report_period_change_decisions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  actor_commune text := public.profile_commune_id();
  target_request public.report_period_change_requests%rowtype;
  target_period public.report_periods%rowtype;
  created_decision public.report_period_change_decisions%rowtype;
  proposed_name text;
  proposed_due_date timestamptz;
  proposed_village_ids uuid[];
begin
  if actor is null
     or public.profile_role() <> 'lanh_dao'
     or not coalesce(public.profile_can_mutate(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'decision_reason_required' using errcode = '22023';
  end if;

  select request.* into target_request
  from public.report_period_change_requests request
  where request.id = p_request_id
    and request.commune_id = actor_commune
  for update;
  if target_request.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.report_period_change_decisions decision
    where decision.request_id = target_request.id
  ) then
    raise exception 'request_already_decided' using errcode = '23505';
  end if;

  select period.* into target_period
  from public.report_periods period
  where period.id = target_request.period_id
    and period.commune_id = actor_commune
  for update;
  if target_period.id is null then
    raise exception 'period_not_found' using errcode = 'P0002';
  end if;

  insert into public.report_period_change_decisions (
    request_id, decision, reason, decided_by
  ) values (
    target_request.id, p_decision, btrim(p_reason), actor
  ) returning * into created_decision;

  if p_decision = 'approved' and target_request.request_kind = 'update' then
    proposed_name := target_request.proposed_snapshot ->> 'name';
    proposed_due_date := (target_request.proposed_snapshot ->> 'due_date')::timestamptz;
    select array_agg(value::uuid order by value::uuid)
    into proposed_village_ids
    from jsonb_array_elements_text(
      target_request.proposed_snapshot -> 'village_ids'
    ) value;

    update public.report_periods
    set name = proposed_name, due_date = proposed_due_date
    where id = target_period.id and archived_at is null;
    if not found then
      raise exception 'period_already_archived' using errcode = '23505';
    end if;
    delete from public.report_period_villages
    where period_id = target_period.id
      and not (village_id = any(proposed_village_ids));
    insert into public.report_period_villages (period_id, village_id)
    select target_period.id, village_id
    from unnest(proposed_village_ids) village_id
    on conflict do nothing;
  elsif p_decision = 'approved' and target_request.request_kind = 'delete' then
    update public.report_periods
    set archived_at = created_decision.decided_at,
        archived_by_request_id = target_request.id
    where id = target_period.id and archived_at is null;
    if not found then
      raise exception 'period_already_archived' using errcode = '23505';
    end if;
  end if;

  insert into public.audit_log (
    commune_id, action, table_name, record_id, user_id, details
  ) values (
    actor_commune,
    upper(p_decision) || '_REPORT_PERIOD_' || upper(target_request.request_kind),
    'report_period_change_decisions', created_decision.id, actor,
    jsonb_build_object(
      'request_id', target_request.id,
      'period_id', target_request.period_id,
      'reason', created_decision.reason,
      'before', target_request.before_snapshot,
      'proposed', target_request.proposed_snapshot
    )
  );

  insert into public.notifications (user_id, title, body, url)
  values (
    target_request.requested_by,
    case when p_decision = 'approved'
      then 'Yêu cầu thay đổi kỳ báo cáo đã được phê duyệt'
      else 'Yêu cầu thay đổi kỳ báo cáo không được phê duyệt' end,
    format('Lãnh đạo đã %s yêu cầu %s. Lý do: %s',
      case when p_decision = 'approved' then 'phê duyệt' else 'từ chối' end,
      case when target_request.request_kind = 'delete' then 'lưu trữ kỳ báo cáo' else 'điều chỉnh kỳ báo cáo' end,
      created_decision.reason),
    '/app/create-period'
  );

  return created_decision;
end
$$;

create or replace function public.reject_archived_period_report_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.report_periods period
    where period.id = new.period_id and period.archived_at is not null
  ) then
    raise exception 'report_period_archived' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists reports_reject_archived_period on public.reports;
create trigger reports_reject_archived_period
before insert or update on public.reports
for each row execute function public.reject_archived_period_report_mutation();

alter table public.report_period_change_requests enable row level security;
alter table public.report_period_change_decisions enable row level security;

revoke insert, update, delete on public.report_periods from authenticated;
revoke insert, update, delete on public.report_period_villages from authenticated;
drop policy if exists periods_insert_admin on public.report_periods;
drop policy if exists periods_update_admin on public.report_periods;
drop policy if exists period_villages_write_admin on public.report_period_villages;

revoke all on public.report_period_change_requests
  from public, anon, authenticated;
revoke all on public.report_period_change_decisions
  from public, anon, authenticated;
grant select on public.report_period_change_requests,
  public.report_period_change_decisions to authenticated;

drop policy if exists report_period_change_requests_select_admin_leader
  on public.report_period_change_requests;
create policy report_period_change_requests_select_admin_leader
on public.report_period_change_requests for select
to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  and commune_id = public.profile_commune_id()
);

drop policy if exists report_period_change_decisions_select_admin_leader
  on public.report_period_change_decisions;
create policy report_period_change_decisions_select_admin_leader
on public.report_period_change_decisions for select
to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  and exists (
    select 1 from public.report_period_change_requests request
    where request.id = request_id
      and request.commune_id = public.profile_commune_id()
  )
);

revoke all on function public.reject_immutable_report_period_history()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_archived_period_report_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.attach_report_period_template(uuid, text, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.attach_report_period_template(uuid, text, text, text, integer)
  to authenticated;
revoke all on function public.create_report_period_change_request(uuid, text, text, text, timestamptz, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_report_period_change_request(uuid, text, text, text, timestamptz, uuid[])
  to authenticated;
revoke all on function public.decide_report_period_change_request(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_report_period_change_request(uuid, text, text)
  to authenticated;

commit;
