-- Atomic period creation and report submission for upgraded databases.

begin;

alter table public.report_validation_flags add column if not exists resolved_at timestamptz;
alter table public.report_validation_flags add column if not exists resolved_by uuid
  references public.user_profiles(id) on delete restrict;

create or replace function public.create_report_period(
  p_name text,
  p_due_date timestamptz,
  p_village_ids uuid[],
  p_template_name text default null
)
returns public.report_periods
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  actor_commune text;
  target_period public.report_periods%rowtype;
  requested_count integer;
  valid_count integer;
begin
  select profile.commune_id into actor_commune
  from public.user_profiles as profile
  where profile.id = actor
    and profile.role::text = 'admin_xa'
    and profile.is_active
    and not profile.force_password_reset;
  if actor_commune is null then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' or p_due_date is null
     or p_village_ids is null or cardinality(p_village_ids) = 0 then
    raise exception 'invalid period metadata' using errcode = '22023';
  end if;
  select count(distinct item) into requested_count from unnest(p_village_ids) as item;
  select count(*) into valid_count from public.villages as village
  where village.id = any(p_village_ids)
    and village.commune_id = actor_commune and village.is_active;
  if requested_count <> cardinality(p_village_ids) or valid_count <> requested_count then
    raise exception 'invalid village scope' using errcode = '22023';
  end if;

  insert into public.report_periods (
    commune_id, name, due_date, template_name, created_by
  ) values (
    actor_commune, btrim(p_name), p_due_date, nullif(btrim(p_template_name), ''), actor
  ) returning * into target_period;
  insert into public.report_period_villages (period_id, village_id)
  select target_period.id, item from unnest(p_village_ids) as item;
  insert into public.notifications (user_id, title, body, url)
  select distinct profile.id, 'Kỳ báo cáo mới',
    format('Kỳ %s có hạn nộp %s', target_period.name,
      to_char(target_period.due_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')),
    format('/?tab=report-form&period_id=%s', target_period.id)
  from public.user_profiles as profile
  where profile.is_active and not profile.force_password_reset
    and profile.role::text in ('can_bo_thon', 'to_cnscd')
    and (
      profile.village_id = any(p_village_ids)
      or exists (
        select 1 from public.user_village_assignments as assignment
        where assignment.user_id = profile.id
          and assignment.village_id = any(p_village_ids)
      )
    );
  insert into public.audit_log (action, table_name, record_id, user_id, details)
  values ('CREATE_REPORT_PERIOD', 'report_periods', target_period.id, actor,
    jsonb_build_object('village_count', requested_count));
  return target_period;
end
$$;

create or replace function public.save_report_submission(
  p_report_id uuid,
  p_village_id uuid,
  p_period_id uuid,
  p_report_source public.report_source,
  p_values jsonb,
  p_flags jsonb,
  p_expected_version integer default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_submit boolean default true,
  p_assisted_by_cnscd boolean default false,
  p_assisted_member_name text default null
)
returns table (
  report_id uuid,
  version integer,
  workflow_status public.report_workflow_status,
  timeliness_status public.report_timeliness_status,
  submitted_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  target_id uuid := coalesce(p_report_id, gen_random_uuid());
  target public.reports%rowtype;
  due_at timestamptz;
  can_write boolean;
begin
  select exists (
    select 1 from public.user_profiles as profile
    where profile.id = actor
      and profile.is_active and not profile.force_password_reset
      and profile.role::text in ('can_bo_thon', 'to_cnscd')
      and (
        profile.village_id = p_village_id
        or exists (
          select 1 from public.user_village_assignments as assignment
          where assignment.user_id = profile.id and assignment.village_id = p_village_id
        )
      )
  ) into can_write;
  if not coalesce(can_write, false) then
    raise exception 'report write is not allowed' using errcode = '42501';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_values) <> 'object'
     or jsonb_typeof(p_flags) <> 'array' then
    raise exception 'invalid submission payload' using errcode = '22023';
  end if;
  return query
  select receipt.report_id, receipt.version, receipt.workflow_status,
    receipt.timeliness_status, receipt.submitted_at, true
  from public.report_submission_receipts as receipt
  where receipt.idempotency_key = p_idempotency_key and receipt.user_id = actor;
  if found then return; end if;

  if exists (
    select 1 from jsonb_each(p_values) as item(code, raw_value)
    where code !~ '^CT(0[1-9]|1[0-4])$'
      or jsonb_typeof(raw_value) not in ('number', 'null')
      or (jsonb_typeof(raw_value) = 'number' and (
        (raw_value #>> '{}')::numeric < 0
        or (raw_value #>> '{}')::numeric <> trunc((raw_value #>> '{}')::numeric)
        or (raw_value #>> '{}')::numeric > 2147483647
      ))
  ) then
    raise exception 'invalid indicator value' using errcode = '22023';
  end if;
  if p_submit and (
    (select count(*) from jsonb_object_keys(p_values)) <> 14
    or exists (
      select 1 from generate_series(1, 14) as indicator(number)
      where not (p_values ? ('CT' || lpad(indicator.number::text, 2, '0')))
        or p_values -> ('CT' || lpad(indicator.number::text, 2, '0')) = 'null'::jsonb
    )
  ) then
    raise exception 'CT01 through CT14 are required' using errcode = '22023';
  end if;
  if p_submit and exists (
    select 1 from jsonb_array_elements(p_flags) as flag
    where coalesce((flag ->> 'resolved')::boolean, false) = false
      and flag ->> 'error_type' in ('BLANK', 'TEXT', 'SEP', 'LOGIC', 'BADPHONE')
  ) then
    raise exception 'blocking validation flags remain' using errcode = '22023';
  end if;

  select * into target from public.reports as report
  where report.id = target_id for update;
  if found then
    if target.village_id <> p_village_id or target.period_id <> p_period_id
       or target.workflow_status not in ('draft', 'needs_revision') then
      raise exception 'report is immutable or outside scope' using errcode = '42501';
    end if;
    if p_expected_version is null or p_expected_version <> target.version then
      raise exception 'report version conflict' using errcode = '40001';
    end if;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'new report version conflict' using errcode = '40001';
    end if;
    insert into public.reports (
      id, village_id, period_id, workflow_status, timeliness_status,
      publication_status, report_source, version, created_by
    ) values (
      target_id, p_village_id, p_period_id, 'draft', 'not_submitted',
      'private', p_report_source, 0, actor
    ) returning * into target;
  end if;

  select period.due_date into due_at from public.report_periods as period
  join public.report_period_villages as scope on scope.period_id = period.id
  where period.id = p_period_id and scope.village_id = p_village_id;
  if due_at is null then
    raise exception 'period does not include village' using errcode = '22023';
  end if;

  delete from public.report_values where report_values.report_id = target_id;
  insert into public.report_values (report_id, ct_code, value)
  select target_id, item.code,
    case when item.raw_value = 'null'::jsonb then null
         else (item.raw_value #>> '{}')::integer end
  from jsonb_each(p_values) as item(code, raw_value);
  delete from public.report_validation_flags
  where report_validation_flags.report_id = target_id;
  insert into public.report_validation_flags (
    report_id, ct_code, error_type, message, resolved, resolved_at, resolved_by
  )
  select target_id, flag ->> 'ct_code',
    (flag ->> 'error_type')::public.validation_error_type,
    flag ->> 'message', coalesce((flag ->> 'resolved')::boolean, false),
    case when coalesce((flag ->> 'resolved')::boolean, false) then now() end,
    case when coalesce((flag ->> 'resolved')::boolean, false) then actor end
  from jsonb_array_elements(p_flags) as flag;

  update public.reports as report set
    workflow_status = case when p_submit then 'submitted'::public.report_workflow_status
                           else 'draft'::public.report_workflow_status end,
    timeliness_status = case
      when not p_submit then 'not_submitted'::public.report_timeliness_status
      when now() <= due_at then 'on_time'::public.report_timeliness_status
      else 'late'::public.report_timeliness_status end,
    report_source = p_report_source,
    idempotency_key = p_idempotency_key,
    version = report.version + 1,
    assisted_by_cnscd = p_assisted_by_cnscd,
    assisted_member_name = case when p_assisted_by_cnscd then p_assisted_member_name end,
    submitted_by = case when p_submit then actor else null end,
    submitted_at = case when p_submit then now() else null end,
    updated_at = now()
  where report.id = target_id returning report.* into target;

  insert into public.report_submission_receipts (
    idempotency_key, report_id, user_id, version, workflow_status,
    timeliness_status, submitted_at
  ) values (
    p_idempotency_key, target.id, actor, target.version, target.workflow_status,
    target.timeliness_status, target.submitted_at
  );
  insert into public.audit_log (action, table_name, record_id, user_id, details)
  values (case when p_submit then 'SUBMIT_REPORT' else 'SAVE_REPORT_DRAFT' end,
    'reports', target.id, actor,
    jsonb_build_object('version', target.version, 'source', target.report_source));
  return query select target.id, target.version, target.workflow_status,
    target.timeliness_status, target.submitted_at, false;
end
$$;

revoke all on function public.create_report_period(text, timestamptz, uuid[], text) from public;
grant execute on function public.create_report_period(text, timestamptz, uuid[], text) to authenticated;
revoke all on function public.save_report_submission(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb,
  integer, uuid, boolean, boolean, text
) from public;
grant execute on function public.save_report_submission(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb,
  integer, uuid, boolean, boolean, text
) to authenticated;

commit;
