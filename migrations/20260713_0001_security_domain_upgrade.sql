-- Upgrade legacy competition/demo databases to the secured report domain.
-- Back up and restore-test before applying. Legacy proposals without recorded
-- consent are quarantined rather than treated as valid consented submissions.

begin;

create extension if not exists pgcrypto;

create table if not exists public.migration_quarantine (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  source_id text,
  payload jsonb not null,
  reason text not null,
  quarantined_at timestamptz not null default now()
);
revoke all on public.migration_quarantine from anon, authenticated;

do $$ begin
  create type public.report_workflow_status as enum
    ('draft', 'submitted', 'needs_revision', 'approved', 'locked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.report_timeliness_status as enum
    ('not_submitted', 'on_time', 'late');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.report_publication_status as enum ('private', 'published');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.report_source as enum ('manual', 'excel', 'photo_ocr', 'direct_api');
exception when duplicate_object then null; end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'villages' and column_name = 'xa_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'villages' and column_name = 'commune_id'
  ) then
    alter table public.villages rename column xa_id to commune_id;
  end if;
end $$;
alter table public.villages add column if not exists commune_id text;
update public.villages set commune_id = 'ba_na' where commune_id is null or btrim(commune_id) = '';
alter table public.villages alter column commune_id set not null;
alter table public.villages add column if not exists is_active boolean not null default true;
alter table public.villages add column if not exists mapping_status text not null default 'confirmed';
alter table public.villages add column if not exists created_at timestamptz not null default now();
alter table public.villages add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'name'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'display_name'
  ) then
    alter table public.user_profiles rename column name to display_name;
  end if;
end $$;
alter table public.user_profiles add column if not exists display_name text;
alter table public.user_profiles add column if not exists phone text;
alter table public.user_profiles add column if not exists commune_id text;
alter table public.user_profiles add column if not exists is_active boolean not null default true;
alter table public.user_profiles add column if not exists force_password_reset boolean not null default true;
alter table public.user_profiles add column if not exists created_at timestamptz not null default now();
alter table public.user_profiles add column if not exists updated_at timestamptz not null default now();
update public.user_profiles as profile
set commune_id = coalesce(village.commune_id, 'ba_na')
from public.villages as village
where profile.village_id = village.id and profile.commune_id is null;
update public.user_profiles set commune_id = 'ba_na' where commune_id is null;
update public.user_profiles set display_name = 'Tài khoản cần cập nhật' where display_name is null or btrim(display_name) = '';
-- Citizen identities are not supported. Disable any legacy citizen account.
update public.user_profiles set is_active = false where role::text = 'dan';
alter table public.user_profiles alter column commune_id set not null;
alter table public.user_profiles alter column display_name set not null;

create table if not exists public.user_village_assignments (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete cascade,
  assigned_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, village_id)
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'report_periods' and column_name = 'xa_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'report_periods' and column_name = 'commune_id'
  ) then
    alter table public.report_periods rename column xa_id to commune_id;
  end if;
end $$;
alter table public.report_periods add column if not exists commune_id text;
update public.report_periods set commune_id = 'ba_na' where commune_id is null;
alter table public.report_periods alter column commune_id set not null;
alter table public.report_periods add column if not exists template_name text;
alter table public.report_periods add column if not exists template_path text;
alter table public.report_periods add column if not exists created_at timestamptz not null default now();
alter table public.report_periods add column if not exists updated_at timestamptz not null default now();
alter table public.report_periods alter column due_date type timestamptz
  using (due_date::date + time '23:59:59') at time zone 'Asia/Ho_Chi_Minh';

-- Preserve a legacy textual creator in quarantine before converting the field.
do $$
declare creator_type text;
begin
  select data_type into creator_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'report_periods' and column_name = 'created_by';
  if creator_type is not null and creator_type <> 'uuid' then
    insert into public.migration_quarantine (entity_type, source_id, payload, reason)
    select 'report_period_creator', id::text,
      jsonb_build_object('created_by', created_by),
      'Legacy creator was not an Auth UUID'
    from public.report_periods where created_by is not null;
    alter table public.report_periods drop column created_by;
    alter table public.report_periods add column created_by uuid references public.user_profiles(id) on delete restrict;
  elsif creator_type is null then
    alter table public.report_periods add column created_by uuid references public.user_profiles(id) on delete restrict;
  end if;
end $$;

create table if not exists public.report_period_villages (
  period_id uuid not null references public.report_periods(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (period_id, village_id)
);
insert into public.report_period_villages (period_id, village_id)
select period.id, village.id
from public.report_periods as period
join public.villages as village on village.commune_id = period.commune_id
on conflict do nothing;

alter table public.reports add column if not exists workflow_status public.report_workflow_status;
alter table public.reports add column if not exists timeliness_status public.report_timeliness_status;
alter table public.reports add column if not exists publication_status public.report_publication_status;
alter table public.reports add column if not exists report_source public.report_source;
alter table public.reports add column if not exists version integer not null default 1;
alter table public.reports add column if not exists idempotency_key uuid;
alter table public.reports add column if not exists created_by uuid references public.user_profiles(id) on delete restrict;
alter table public.reports add column if not exists submitted_by uuid references public.user_profiles(id) on delete restrict;
alter table public.reports add column if not exists approved_by uuid references public.user_profiles(id) on delete restrict;
alter table public.reports add column if not exists locked_by uuid references public.user_profiles(id) on delete restrict;
alter table public.reports add column if not exists published_by uuid references public.user_profiles(id) on delete restrict;
alter table public.reports add column if not exists created_at timestamptz not null default now();
alter table public.reports add column if not exists updated_at timestamptz not null default now();
alter table public.reports add column if not exists approved_at timestamptz;
alter table public.reports add column if not exists locked_at timestamptz;
alter table public.reports add column if not exists published_at timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reports' and column_name = 'status'
  ) then
    execute $sql$
      update public.reports set
        workflow_status = case status::text
          when 'chua_nop' then 'draft'::public.report_workflow_status
          else 'submitted'::public.report_workflow_status end,
        timeliness_status = case status::text
          when 'dung_han' then 'on_time'::public.report_timeliness_status
          when 'tre_han' then 'late'::public.report_timeliness_status
          else 'not_submitted'::public.report_timeliness_status end
    $sql$;
    alter table public.reports drop column status;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reports' and column_name = 'raw_source'
  ) then
    execute $sql$
      update public.reports set report_source = case raw_source::text
        when 'excel_upload' then 'excel'::public.report_source
        when 'photo_upload' then 'photo_ocr'::public.report_source
        else 'manual'::public.report_source end
    $sql$;
    alter table public.reports drop column raw_source;
  end if;
end $$;
update public.reports set workflow_status = 'draft' where workflow_status is null;
update public.reports set timeliness_status = 'not_submitted' where timeliness_status is null;
update public.reports set publication_status = 'private' where publication_status is null;
update public.reports set report_source = 'manual' where report_source is null;
update public.reports set submitted_at = coalesce(submitted_at, updated_at)
where workflow_status <> 'draft' and submitted_at is null;
alter table public.reports alter column workflow_status set not null;
alter table public.reports alter column timeliness_status set not null;
alter table public.reports alter column publication_status set not null;
alter table public.reports alter column report_source set not null;
alter table public.reports drop column if exists submitted_by_name;
alter table public.reports drop column if exists submitted_by_phone;
create unique index if not exists reports_idempotency_key_idx
  on public.reports (idempotency_key) where idempotency_key is not null;

alter table public.report_values drop constraint if exists report_values_ct_code_check;
alter table public.report_values add constraint report_values_ct_code_check
  check (ct_code ~ '^CT(0[1-9]|1[0-4])$') not valid;
alter table public.report_values validate constraint report_values_ct_code_check;
alter table public.report_values drop constraint if exists report_values_nonnegative;
alter table public.report_values add constraint report_values_nonnegative
  check (value is null or value >= 0) not valid;
alter table public.report_values validate constraint report_values_nonnegative;

-- Existing citizen proposals did not capture explicit consent evidence.
insert into public.migration_quarantine (entity_type, source_id, payload, reason)
select 'pending_update', id::text, to_jsonb(proposal),
  'Explicit consent version and timestamp were not recorded'
from public.pending_updates as proposal;
delete from public.pending_updates;
alter table public.pending_updates add column if not exists submitter_name text;
alter table public.pending_updates add column if not exists submitter_phone text;
alter table public.pending_updates add column if not exists submitter_household text;
alter table public.pending_updates add column if not exists submitter_address text;
alter table public.pending_updates add column if not exists submitter_relation text;
alter table public.pending_updates add column if not exists explanation text;
alter table public.pending_updates add column if not exists consent_given boolean not null default false;
alter table public.pending_updates add column if not exists consent_version text;
alter table public.pending_updates add column if not exists consent_at timestamptz;
alter table public.pending_updates add column if not exists reviewed_by uuid references public.user_profiles(id) on delete restrict;
alter table public.pending_updates add column if not exists reviewed_at timestamptz;
alter table public.pending_updates add column if not exists review_notes text;
alter table public.pending_updates add column if not exists created_at timestamptz not null default now();
alter table public.pending_updates add column if not exists updated_at timestamptz not null default now();

do $$
declare proposed_by_type text;
begin
  select data_type into proposed_by_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'pending_updates' and column_name = 'proposed_by';
  if proposed_by_type is not null and proposed_by_type <> 'uuid' then
    alter table public.pending_updates drop column proposed_by;
    alter table public.pending_updates add column proposed_by uuid references public.user_profiles(id) on delete set null;
  end if;
end $$;

-- Align audit columns with the API contract without inventing actor identities.
alter table public.audit_log add column if not exists record_id uuid;
alter table public.audit_log add column if not exists user_id uuid references public.user_profiles(id) on delete set null;
alter table public.audit_log add column if not exists request_id uuid;
alter table public.audit_log add column if not exists details jsonb not null default '{}'::jsonb;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_log' and column_name = 'payload'
  ) then
    execute 'update public.audit_log set details = coalesce(payload, ''{}''::jsonb)';
    alter table public.audit_log drop column payload;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_log' and column_name = 'row_id'
  ) then
    execute $sql$
      update public.audit_log set record_id = case
        when row_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then row_id::uuid else null end
    $sql$;
    alter table public.audit_log drop column row_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_log' and column_name = 'actor'
  ) then
    execute $sql$
      update public.audit_log
      set details = details || jsonb_build_object('legacy_actor', actor)
      where actor is not null
    $sql$;
    alter table public.audit_log drop column actor;
  end if;
end $$;

create table if not exists public.report_submission_receipts (
  idempotency_key uuid primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  version integer not null,
  workflow_status public.report_workflow_status not null,
  timeliness_status public.report_timeliness_status not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Replace the unsafe aggregate view. Anonymous users receive public data only
-- through the rate-limited FastAPI endpoint, never direct table/view grants.
drop view if exists public.village_report_summary;
drop view if exists public.published_report_summary;
create view public.published_report_summary
with (security_invoker = true, security_barrier = true)
as
select
  report.village_id,
  village.name as village_name,
  report.period_id,
  period.name as period_name,
  period.due_date,
  jsonb_object_agg(value.ct_code, value.value order by value.ct_code)
    filter (where value.ct_code is not null) as values_by_ct,
  max(report.published_at) as published_at
from public.reports as report
join public.villages as village on village.id = report.village_id
join public.report_periods as period on period.id = report.period_id
join public.report_values as value on value.report_id = report.id
where report.publication_status = 'published'
  and report.workflow_status in ('approved', 'locked')
  and value.ct_code in ('CT01', 'CT02', 'CT09', 'CT12', 'CT13')
group by report.village_id, village.name, report.period_id, period.name, period.due_date;
create view public.village_report_summary
with (security_invoker = true, security_barrier = true)
as select * from public.published_report_summary;
revoke all on public.reports, public.report_values, public.report_validation_flags,
  public.pending_updates, public.audit_log, public.published_report_summary,
  public.village_report_summary from anon;

-- Repair the most security-sensitive policies. Backend authorization remains
-- mandatory; service-role bypass is not treated as application authorization.
create or replace function public.profile_role()
returns public.user_role
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select profile.role from public.user_profiles as profile
  where profile.id = auth.uid() and profile.is_active
$$;
create or replace function public.profile_village_id()
returns uuid language sql stable security definer
set search_path = pg_catalog, public
as $$
  select profile.village_id from public.user_profiles as profile
  where profile.id = auth.uid() and profile.is_active
$$;
create or replace function public.profile_can_mutate()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((select profile.is_active and not profile.force_password_reset
    from public.user_profiles as profile where profile.id = auth.uid()), false)
$$;

drop policy if exists audit_log_select_admin_only on public.audit_log;
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log for select to authenticated
using (public.profile_role() = 'admin_xa' and public.profile_can_mutate());

drop policy if exists reports_select_all_roles on public.reports;
drop policy if exists reports_insert_own_village on public.reports;
drop policy if exists reports_update_own_village_or_admin on public.reports;
create policy reports_select_scoped on public.reports for select to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  or village_id = public.profile_village_id()
  or exists (
    select 1 from public.user_village_assignments as assignment
    where assignment.user_id = auth.uid() and assignment.village_id = reports.village_id
  )
);
create policy reports_insert_scoped on public.reports for insert to authenticated
with check (
  public.profile_can_mutate()
  and public.profile_role() in ('can_bo_thon', 'to_cnscd')
  and (
    village_id = public.profile_village_id()
    or exists (
      select 1 from public.user_village_assignments as assignment
      where assignment.user_id = auth.uid() and assignment.village_id = reports.village_id
    )
  )
  and workflow_status in ('draft', 'submitted')
  and publication_status = 'private'
);
create policy reports_update_scoped on public.reports for update to authenticated
using (
  (public.profile_role() = 'admin_xa' and public.profile_can_mutate())
  or (
    public.profile_can_mutate()
    and public.profile_role() in ('can_bo_thon', 'to_cnscd')
    and workflow_status in ('draft', 'needs_revision')
    and (
      village_id = public.profile_village_id()
      or exists (
        select 1 from public.user_village_assignments as assignment
        where assignment.user_id = auth.uid() and assignment.village_id = reports.village_id
      )
    )
  )
)
with check (
  public.profile_role() = 'admin_xa'
  or (
    workflow_status in ('draft', 'submitted')
    and publication_status = 'private'
  )
);

drop policy if exists pending_updates_select_all_roles on public.pending_updates;
create policy pending_updates_select_scoped on public.pending_updates for select to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  or exists (
    select 1 from public.reports as report
    where report.id = pending_updates.report_id
      and report.village_id = public.profile_village_id()
  )
);

-- Leadership is read-only because no write policy above includes lanh_dao.
-- Approval/publish mutations are further constrained by backend role checks and
-- are always audit logged in the same transaction.

commit;
