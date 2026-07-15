-- BaNa SmartLink canonical PostgreSQL/Supabase baseline.
--
-- New environments apply this file once. Existing installations apply the
-- ordered files under migrations/ instead. Business validation remains in
-- config/validation_rules.json; the database enforces structural invariants.

begin;

create extension if not exists pgcrypto;

create type public.user_role as enum (
  'admin_xa',
  'can_bo_thon',
  'to_cnscd',
  'lanh_dao'
);

create type public.report_workflow_status as enum (
  'draft',
  'submitted',
  'needs_revision',
  'approved',
  'locked'
);

create type public.report_timeliness_status as enum (
  'not_submitted',
  'on_time',
  'late'
);

create type public.report_publication_status as enum (
  'private',
  'published'
);

create type public.report_source as enum (
  'manual',
  'excel',
  'photo_ocr',
  'direct_api'
);

create type public.validation_error_type as enum (
  'BLANK',
  'TEXT',
  'SEP',
  'OUTLIER',
  'LOGIC',
  'BADPHONE'
);

create type public.pending_update_status as enum (
  'pending',
  'approved',
  'rejected'
);

create table public.villages (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  name text not null,
  household_count jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  mapping_status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint villages_commune_name_unique unique (commune_id, name),
  constraint villages_commune_id_not_blank check (btrim(commune_id) <> ''),
  constraint villages_name_not_blank check (btrim(name) <> ''),
  constraint villages_household_count_object check (
    jsonb_typeof(household_count) = 'object'
  ),
  constraint villages_mapping_status_check check (
    mapping_status in ('confirmed', 'pending_official_decision')
  )
);

comment on column public.villages.mapping_status is
  'Use pending_official_decision for unresolved official merger mappings; never infer them.';

create table public.user_profiles (
  id uuid primary key references auth.users(id) on update cascade on delete cascade,
  commune_id text not null,
  display_name text not null,
  phone text,
  role public.user_role not null,
  village_id uuid references public.villages(id) on update cascade on delete restrict,
  is_active boolean not null default true,
  force_password_reset boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_commune_id_not_blank check (btrim(commune_id) <> ''),
  constraint user_profiles_display_name_not_blank check (btrim(display_name) <> ''),
  constraint user_profiles_phone_format check (
    phone is null or phone ~ '^\+?[0-9]{9,15}$'
  ),
  constraint user_profiles_village_scope_check check (
    (role in ('admin_xa', 'lanh_dao') and village_id is null)
    or (role = 'can_bo_thon' and village_id is not null)
    or role = 'to_cnscd'
  )
);

comment on table public.user_profiles is
  'Supabase Auth profile. Citizens do not have accounts in BaNa SmartLink.';

create table public.user_village_assignments (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete cascade,
  assigned_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, village_id)
);

create table public.village_merge_map (
  old_village_name text primary key,
  new_village_id uuid not null references public.villages(id) on update cascade on delete restrict,
  mapping_status text not null default 'confirmed',
  source_note text,
  constraint village_merge_map_old_name_not_blank check (btrim(old_village_name) <> ''),
  constraint village_merge_map_status_check check (
    mapping_status in ('confirmed', 'pending_official_decision')
  )
);

create table public.villages_legacy (
  id uuid primary key default gen_random_uuid(),
  old_name text not null unique,
  dissolved_into_village_id uuid references public.villages(id) on update cascade on delete set null,
  dissolved_date date,
  commune_id text not null,
  mapping_status text not null default 'confirmed',
  note text,
  constraint villages_legacy_name_not_blank check (btrim(old_name) <> ''),
  constraint villages_legacy_status_check check (
    mapping_status in ('confirmed', 'pending_official_decision')
  )
);

create table public.report_periods (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  name text not null,
  due_date timestamptz not null,
  template_name text,
  template_path text,
  created_by uuid references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_periods_commune_name_unique unique (commune_id, name),
  constraint report_periods_commune_id_not_blank check (btrim(commune_id) <> ''),
  constraint report_periods_name_not_blank check (btrim(name) <> ''),
  constraint report_periods_template_name_check check (
    template_name is null
    or (
      btrim(template_name) <> ''
      and template_name !~ '[\\/]'
      and template_name !~ '\.\.'
    )
  ),
  constraint report_periods_template_path_check check (
    template_path is null
    or (
      template_path !~ '(^|[\\/])\.\.([\\/]|$)'
      and template_path !~ '^[A-Za-z]:'
      and template_path !~ '^/'
    )
  )
);

create table public.report_period_villages (
  period_id uuid not null references public.report_periods(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (period_id, village_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id) on update cascade on delete restrict,
  period_id uuid not null references public.report_periods(id) on update cascade on delete restrict,
  workflow_status public.report_workflow_status not null default 'draft',
  timeliness_status public.report_timeliness_status not null default 'not_submitted',
  publication_status public.report_publication_status not null default 'private',
  report_source public.report_source not null default 'manual',
  version integer not null default 1,
  idempotency_key uuid,
  assisted_by_cnscd boolean not null default false,
  assisted_member_name text,
  created_by uuid references public.user_profiles(id) on delete restrict,
  submitted_by uuid references public.user_profiles(id) on delete restrict,
  approved_by uuid references public.user_profiles(id) on delete restrict,
  locked_by uuid references public.user_profiles(id) on delete restrict,
  published_by uuid references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  locked_at timestamptz,
  published_at timestamptz,
  constraint reports_village_period_unique unique (village_id, period_id),
  constraint reports_idempotency_key_unique unique (idempotency_key),
  constraint reports_version_positive check (version > 0),
  constraint reports_assistance_name_check check (
    assisted_by_cnscd or assisted_member_name is null
  ),
  constraint reports_submission_metadata_check check (
    (workflow_status = 'draft' and submitted_at is null)
    or (workflow_status <> 'draft' and submitted_at is not null)
  ),
  constraint reports_approval_metadata_check check (
    (workflow_status in ('approved', 'locked') and approved_at is not null)
    or (workflow_status not in ('approved', 'locked'))
  ),
  constraint reports_lock_metadata_check check (
    (workflow_status = 'locked' and locked_at is not null)
    or (workflow_status <> 'locked' and locked_at is null)
  ),
  constraint reports_publication_metadata_check check (
    (publication_status = 'published' and published_at is not null)
    or (publication_status = 'private' and published_at is null)
  ),
  constraint reports_published_workflow_check check (
    publication_status = 'private'
    or workflow_status in ('approved', 'locked')
  )
);

create table public.report_values (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on update cascade on delete cascade,
  ct_code text not null,
  value integer,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_values_report_ct_unique unique (report_id, ct_code),
  constraint report_values_ct_code_check check (
    ct_code ~ '^CT(0[1-9]|1[0-4])$'
  ),
  constraint report_values_nonnegative check (value is null or value >= 0)
);

create table public.report_validation_flags (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on update cascade on delete cascade,
  ct_code text not null,
  error_type public.validation_error_type not null,
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.user_profiles(id) on delete restrict,
  constraint report_validation_flags_ct_code_check check (
    ct_code ~ '^CT(0[1-9]|1[0-4])$'
  ),
  constraint report_validation_flags_message_not_blank check (btrim(message) <> ''),
  constraint report_validation_flags_resolution_check check (
    (resolved and resolved_at is not null)
    or (not resolved and resolved_at is null and resolved_by is null)
  )
);

create table public.pending_updates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on update cascade on delete cascade,
  ct_code text not null,
  proposed_value integer not null,
  proposed_by uuid references public.user_profiles(id) on delete set null,
  submitter_name text,
  submitter_phone text,
  submitter_household text,
  submitter_address text,
  submitter_relation text,
  explanation text,
  consent_given boolean not null default false,
  consent_version text,
  consent_at timestamptz,
  tracking_code text not null default upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16)),
  status public.pending_update_status not null default 'pending',
  reviewed_by uuid references public.user_profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_updates_ct_code_check check (
    ct_code ~ '^CT(0[1-9]|1[0-4])$'
  ),
  constraint pending_updates_value_nonnegative check (proposed_value >= 0),
  constraint pending_updates_phone_format check (
    submitter_phone is null or submitter_phone ~ '^\+?[0-9]{9,15}$'
  ),
  constraint pending_updates_consent_required check (
    consent_given
    and consent_version is not null
    and btrim(consent_version) <> ''
    and consent_at is not null
  ),
  constraint pending_updates_tracking_code_unique unique (tracking_code),
  constraint pending_updates_tracking_code_format check (
    tracking_code ~ '^[A-Z0-9]{16}$'
  ),
  constraint pending_updates_review_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  table_name text not null,
  record_id uuid,
  user_id uuid references public.user_profiles(id) on delete set null,
  request_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_action_not_blank check (btrim(action) <> ''),
  constraint audit_log_table_name_not_blank check (btrim(table_name) <> ''),
  constraint audit_log_details_object check (jsonb_typeof(details) = 'object')
);

comment on table public.audit_log is
  'Append-only security and workflow audit log. Retention is configured operationally.';

create table public.evacuation_points (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id) on update cascade on delete restrict,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  capacity_households integer not null,
  contact_name text not null,
  contact_phone text not null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evacuation_points_capacity_positive check (capacity_households > 0),
  constraint evacuation_points_latitude_check check (latitude between -90 and 90),
  constraint evacuation_points_longitude_check check (longitude between -180 and 180)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  endpoint text not null,
  keys_p256dh text not null,
  keys_auth text not null,
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint),
  constraint push_subscriptions_endpoint_not_blank check (btrim(endpoint) <> '')
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  title text not null,
  body text not null,
  url text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_title_not_blank check (btrim(title) <> ''),
  constraint notifications_body_not_blank check (btrim(body) <> ''),
  constraint notifications_read_state_check check (
    (is_read and read_at is not null) or (not is_read and read_at is null)
  ),
  constraint notifications_url_relative check (
    url is null or (url ~ '^/' and url !~ '^//')
  )
);

create table public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.report_periods(id) on delete cascade,
  village_id uuid references public.villages(id) on delete cascade,
  recipient_user_id uuid references public.user_profiles(id) on delete cascade,
  milestone text not null,
  delivery_status text not null default 'queued',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reminder_log_milestone_check check (
    milestone in ('three_days', 'one_day', 'overdue', 'period_due_admin')
  ),
  constraint reminder_log_delivery_status_check check (
    delivery_status in ('queued', 'delivered', 'failed')
  )
);

create table public.report_submission_receipts (
  idempotency_key uuid primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  version integer not null,
  workflow_status public.report_workflow_status not null,
  timeliness_status public.report_timeliness_status not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint report_submission_receipts_version_positive check (version > 0)
);

create index user_profiles_role_idx on public.user_profiles (role);
create index user_profiles_village_id_idx on public.user_profiles (village_id);
create index user_profiles_commune_id_idx on public.user_profiles (commune_id);
create index user_village_assignments_village_idx on public.user_village_assignments (village_id);
create index village_merge_map_new_village_idx on public.village_merge_map (new_village_id);
create index report_periods_commune_due_idx on public.report_periods (commune_id, due_date desc);
create index report_period_villages_village_idx on public.report_period_villages (village_id);
create index reports_period_status_idx on public.reports (period_id, workflow_status);
create index reports_village_status_idx on public.reports (village_id, workflow_status);
create index reports_publication_idx on public.reports (publication_status, period_id)
  where publication_status = 'published';
create index report_values_report_idx on public.report_values (report_id);
create index report_values_ct_report_idx on public.report_values (ct_code, report_id);
create index report_flags_unresolved_idx on public.report_validation_flags (report_id, resolved)
  where resolved = false;
create index pending_updates_report_status_idx on public.pending_updates (report_id, status);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index reminder_log_delivery_idx on public.reminder_log (delivery_status, created_at);
create unique index reminder_log_idempotent_idx on public.reminder_log (
  period_id,
  coalesce(village_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  milestone
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger villages_set_updated_at
before update on public.villages
for each row execute function public.set_updated_at();

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create trigger report_periods_set_updated_at
before update on public.report_periods
for each row execute function public.set_updated_at();

create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create trigger report_values_set_updated_at
before update on public.report_values
for each row execute function public.set_updated_at();

create trigger pending_updates_set_updated_at
before update on public.pending_updates
for each row execute function public.set_updated_at();

create trigger evacuation_points_set_updated_at
before update on public.evacuation_points
for each row execute function public.set_updated_at();

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

create function public.profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select profile.role
  from public.user_profiles as profile
  where profile.id = auth.uid()
    and profile.is_active
$$;

create function public.profile_village_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select profile.village_id
  from public.user_profiles as profile
  where profile.id = auth.uid()
    and profile.is_active
$$;

create function public.profile_commune_id()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select profile.commune_id
  from public.user_profiles as profile
  where profile.id = auth.uid()
    and profile.is_active
$$;

create function public.profile_can_mutate()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select profile.is_active and not profile.force_password_reset
    from public.user_profiles as profile
    where profile.id = auth.uid()
  ), false)
$$;

create function public.can_select_village(target_village_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    join public.villages as village on village.id = target_village_id
    where profile.id = auth.uid()
      and profile.is_active
      and profile.commune_id = village.commune_id
      and (
        profile.role in ('admin_xa', 'lanh_dao')
        or (profile.role = 'can_bo_thon' and profile.village_id = village.id)
        or (
          profile.role = 'to_cnscd'
          and (
            profile.village_id = village.id
            or exists (
              select 1
              from public.user_village_assignments as assignment
              where assignment.user_id = profile.id
                and assignment.village_id = village.id
            )
          )
        )
      )
  )
$$;

create function public.can_modify_village(target_village_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.profile_can_mutate()
    and public.profile_role() in ('can_bo_thon', 'to_cnscd')
    and public.can_select_village(target_village_id)
$$;

create function public.can_administer_village(target_village_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.profile_can_mutate()
    and public.profile_role() = 'admin_xa'
    and exists (
      select 1
      from public.villages as village
      where village.id = target_village_id
        and village.commune_id = public.profile_commune_id()
    )
$$;

create function public.can_select_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.reports as report
    where report.id = target_report_id
      and public.can_select_village(report.village_id)
  )
$$;

create function public.can_modify_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.reports as report
    where report.id = target_report_id
      and report.workflow_status in ('draft', 'needs_revision')
      and report.publication_status = 'private'
      and public.can_modify_village(report.village_id)
  )
$$;

create function public.enforce_report_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  actor_role public.user_role;
begin
  -- Direct trusted database sessions and service-role maintenance are governed
  -- by database ownership and grants. Anonymous clients still have no grants.
  if actor is null then
    return new;
  end if;

  actor_role := public.profile_role();
  if actor_role is null or not public.profile_can_mutate() then
    raise exception 'inactive account or password reset required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if actor_role not in ('can_bo_thon', 'to_cnscd')
       or not public.can_modify_village(new.village_id) then
      raise exception 'report creation is not allowed' using errcode = '42501';
    end if;
    if new.workflow_status not in ('draft', 'submitted')
       or new.publication_status <> 'private' then
      raise exception 'invalid initial report state' using errcode = '22023';
    end if;
    new.created_by := actor;
  else
    if new.village_id <> old.village_id or new.period_id <> old.period_id then
      raise exception 'village_id and period_id are immutable' using errcode = '22023';
    end if;

    if actor_role in ('can_bo_thon', 'to_cnscd') then
      if not public.can_modify_village(new.village_id)
         or old.workflow_status not in ('draft', 'needs_revision')
         or new.workflow_status not in ('draft', 'submitted')
         or new.publication_status <> 'private' then
        raise exception 'report transition is not allowed' using errcode = '42501';
      end if;
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
      new.locked_by := old.locked_by;
      new.locked_at := old.locked_at;
      new.published_by := old.published_by;
      new.published_at := old.published_at;
    elsif actor_role = 'admin_xa' then
      if not public.can_administer_village(new.village_id) then
        raise exception 'report administration is not allowed' using errcode = '42501';
      end if;
    else
      raise exception 'leadership is read-only' using errcode = '42501';
    end if;
  end if;

  if new.workflow_status = 'submitted' and new.submitted_at is null then
    new.submitted_by := actor;
    new.submitted_at := now();
  end if;
  if actor_role = 'admin_xa' and new.workflow_status = 'approved'
     and old.workflow_status is distinct from 'approved' then
    new.approved_by := actor;
    new.approved_at := now();
  end if;
  if actor_role = 'admin_xa' and new.workflow_status = 'locked'
     and old.workflow_status is distinct from 'locked' then
    new.locked_by := actor;
    new.locked_at := now();
  end if;
  if actor_role = 'admin_xa' and new.publication_status = 'published'
     and old.publication_status is distinct from 'published' then
    new.published_by := actor;
    new.published_at := now();
  elsif new.publication_status = 'private' then
    new.published_by := null;
    new.published_at := null;
  end if;

  return new;
end
$$;

create trigger reports_enforce_transition
before insert or update on public.reports
for each row execute function public.enforce_report_transition();

revoke all on function public.set_updated_at() from public;
revoke all on function public.profile_role() from public;
revoke all on function public.profile_village_id() from public;
revoke all on function public.profile_commune_id() from public;
revoke all on function public.profile_can_mutate() from public;
revoke all on function public.can_select_village(uuid) from public;
revoke all on function public.can_modify_village(uuid) from public;
revoke all on function public.can_administer_village(uuid) from public;
revoke all on function public.can_select_report(uuid) from public;
revoke all on function public.can_modify_report(uuid) from public;
revoke all on function public.enforce_report_transition() from public;

grant execute on function public.profile_role() to authenticated;
grant execute on function public.profile_village_id() to authenticated;
grant execute on function public.profile_commune_id() to authenticated;
grant execute on function public.profile_can_mutate() to authenticated;
grant execute on function public.can_select_village(uuid) to authenticated;
grant execute on function public.can_modify_village(uuid) to authenticated;
grant execute on function public.can_administer_village(uuid) to authenticated;
grant execute on function public.can_select_report(uuid) to authenticated;
grant execute on function public.can_modify_report(uuid) to authenticated;

alter table public.villages enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_village_assignments enable row level security;
alter table public.village_merge_map enable row level security;
alter table public.villages_legacy enable row level security;
alter table public.report_periods enable row level security;
alter table public.report_period_villages enable row level security;
alter table public.reports enable row level security;
alter table public.report_values enable row level security;
alter table public.report_validation_flags enable row level security;
alter table public.pending_updates enable row level security;
alter table public.audit_log enable row level security;
alter table public.evacuation_points enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.reminder_log enable row level security;
alter table public.report_submission_receipts enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

grant select on public.villages, public.village_merge_map to anon, authenticated;
grant select on public.user_profiles, public.user_village_assignments,
  public.villages_legacy, public.report_periods, public.report_period_villages to authenticated;
grant select, insert, update, delete on public.reports, public.report_values,
  public.report_validation_flags to authenticated;
grant select on public.pending_updates, public.audit_log, public.reminder_log to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, update, delete on public.notifications to authenticated;
grant select, insert on public.report_submission_receipts to authenticated;
grant select on public.evacuation_points to anon, authenticated;
grant insert, update, delete on public.evacuation_points to authenticated;
grant insert, update on public.report_periods to authenticated;
grant insert, update, delete on public.report_period_villages to authenticated;
grant update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.user_village_assignments to authenticated;

create policy villages_select_active
on public.villages for select
to anon, authenticated
using (is_active or public.profile_role() = 'admin_xa');

create policy village_merge_map_select
on public.village_merge_map for select
to anon, authenticated
using (true);

create policy villages_legacy_select_internal
on public.villages_legacy for select
to authenticated
using (public.profile_role() is not null);

create policy profiles_select_self_admin_leader
on public.user_profiles for select
to authenticated
using (
  id = auth.uid()
  or (
    public.profile_role() in ('admin_xa', 'lanh_dao')
    and commune_id = public.profile_commune_id()
  )
);

create policy profiles_update_admin
on public.user_profiles for update
to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
)
with check (
  public.profile_role() = 'admin_xa'
  and commune_id = public.profile_commune_id()
);

create policy assignments_select_scoped
on public.user_village_assignments for select
to authenticated
using (
  user_id = auth.uid()
  or public.profile_role() in ('admin_xa', 'lanh_dao')
);

create policy assignments_write_admin
on public.user_village_assignments for all
to authenticated
using (public.profile_role() = 'admin_xa' and public.profile_can_mutate())
with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());

create policy periods_select_internal
on public.report_periods for select
to authenticated
using (commune_id = public.profile_commune_id());

create policy periods_insert_admin
on public.report_periods for insert
to authenticated
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
  and created_by = auth.uid()
);

create policy periods_update_admin
on public.report_periods for update
to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
)
with check (
  public.profile_role() = 'admin_xa'
  and commune_id = public.profile_commune_id()
);

create policy period_villages_select_internal
on public.report_period_villages for select
to authenticated
using (
  exists (
    select 1
    from public.report_periods as period
    where period.id = period_id
      and period.commune_id = public.profile_commune_id()
  )
);

create policy period_villages_write_admin
on public.report_period_villages for all
to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
)
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and exists (
    select 1
    from public.report_periods as period
    join public.villages as village on village.id = village_id
    where period.id = period_id
      and period.commune_id = public.profile_commune_id()
      and village.commune_id = period.commune_id
      and village.is_active
  )
);

create policy reports_select_scoped
on public.reports for select
to authenticated
using (public.can_select_village(village_id));

create policy reports_insert_scoped
on public.reports for insert
to authenticated
with check (public.can_modify_village(village_id));

create policy reports_update_scoped
on public.reports for update
to authenticated
using (
  public.can_modify_village(village_id)
  or public.can_administer_village(village_id)
)
with check (
  public.can_modify_village(village_id)
  or public.can_administer_village(village_id)
);

create policy reports_delete_admin
on public.reports for delete
to authenticated
using (public.can_administer_village(village_id));

create policy report_values_select_scoped
on public.report_values for select
to authenticated
using (public.can_select_report(report_id));

create policy report_values_insert_scoped
on public.report_values for insert
to authenticated
with check (
  public.can_modify_report(report_id)
  or exists (
    select 1 from public.reports as report
    where report.id = report_id
      and public.can_administer_village(report.village_id)
  )
);

create policy report_values_update_scoped
on public.report_values for update
to authenticated
using (
  public.can_modify_report(report_id)
  or exists (
    select 1 from public.reports as report
    where report.id = report_id
      and public.can_administer_village(report.village_id)
  )
)
with check (
  public.can_modify_report(report_id)
  or exists (
    select 1 from public.reports as report
    where report.id = report_id
      and public.can_administer_village(report.village_id)
  )
);

create policy report_values_delete_scoped
on public.report_values for delete
to authenticated
using (
  public.can_modify_report(report_id)
  or exists (
    select 1 from public.reports as report
    where report.id = report_id
      and public.can_administer_village(report.village_id)
  )
);

create policy report_flags_select_scoped
on public.report_validation_flags for select
to authenticated
using (public.can_select_report(report_id));

create policy report_flags_insert_scoped
on public.report_validation_flags for insert
to authenticated
with check (public.can_modify_report(report_id));

create policy report_flags_update_scoped
on public.report_validation_flags for update
to authenticated
using (public.can_modify_report(report_id))
with check (public.can_modify_report(report_id));

create policy report_flags_delete_scoped
on public.report_validation_flags for delete
to authenticated
using (public.can_modify_report(report_id));

create policy pending_updates_select_scoped
on public.pending_updates for select
to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  or public.can_select_report(report_id)
);

create policy audit_log_select_admin
on public.audit_log for select
to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
);

create policy evacuation_points_select
on public.evacuation_points for select
to anon, authenticated
using (is_verified or public.can_select_village(village_id));

create policy evacuation_points_insert_scoped
on public.evacuation_points for insert
to authenticated
with check (
  public.can_administer_village(village_id)
  or (public.can_modify_village(village_id) and not is_verified)
);

create policy evacuation_points_update_scoped
on public.evacuation_points for update
to authenticated
using (
  public.can_administer_village(village_id)
  or public.can_modify_village(village_id)
)
with check (
  public.can_administer_village(village_id)
  or (public.can_modify_village(village_id) and not is_verified)
);

create policy evacuation_points_delete_admin
on public.evacuation_points for delete
to authenticated
using (public.can_administer_village(village_id));

create policy push_subscriptions_own
on public.push_subscriptions for all
to authenticated
using (user_id = auth.uid() and public.profile_can_mutate())
with check (user_id = auth.uid() and public.profile_can_mutate());

create policy notifications_select_own
on public.notifications for select
to authenticated
using (user_id = auth.uid());

create policy notifications_update_own
on public.notifications for update
to authenticated
using (user_id = auth.uid() and public.profile_can_mutate())
with check (user_id = auth.uid());

create policy notifications_delete_own
on public.notifications for delete
to authenticated
using (user_id = auth.uid() and public.profile_can_mutate());

create policy reminder_log_select_admin
on public.reminder_log for select
to authenticated
using (public.profile_role() = 'admin_xa');

create policy submission_receipts_select_own
on public.report_submission_receipts for select
to authenticated
using (user_id = auth.uid());

create policy submission_receipts_insert_own
on public.report_submission_receipts for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.can_select_report(report_id)
);

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

comment on view public.published_report_summary is
  'Backend-only public projection. It contains only CT01, CT02, CT09, CT12 and CT13.';

create view public.village_report_summary
with (security_invoker = true, security_barrier = true)
as select * from public.published_report_summary;

revoke all on public.published_report_summary from anon, authenticated;
revoke all on public.village_report_summary from anon, authenticated;

create function public.create_report_period(
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
  if actor is null
     or public.profile_role() <> 'admin_xa'
     or not public.profile_can_mutate() then
    raise exception 'only an active commune administrator can create a period'
      using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'period name is required' using errcode = '22023';
  end if;
  if p_due_date is null then
    raise exception 'due date is required' using errcode = '22023';
  end if;
  if p_village_ids is null or cardinality(p_village_ids) = 0 then
    raise exception 'at least one village is required' using errcode = '22023';
  end if;

  actor_commune := public.profile_commune_id();
  select count(distinct village_id) into requested_count
  from unnest(p_village_ids) as village_id;
  select count(*) into valid_count
  from public.villages as village
  where village.id = any(p_village_ids)
    and village.commune_id = actor_commune
    and village.is_active;
  if requested_count <> cardinality(p_village_ids) or valid_count <> requested_count then
    raise exception 'villages must be unique, active and in the administrator commune'
      using errcode = '22023';
  end if;

  insert into public.report_periods (
    commune_id, name, due_date, template_name, created_by
  ) values (
    actor_commune, btrim(p_name), p_due_date,
    nullif(btrim(p_template_name), ''), actor
  )
  returning * into target_period;

  insert into public.report_period_villages (period_id, village_id)
  select target_period.id, village_id
  from unnest(p_village_ids) as village_id;

  insert into public.notifications (user_id, title, body, url)
  select distinct
    profile.id,
    'Kỳ báo cáo mới',
    format('Kỳ %s có hạn nộp %s', target_period.name,
      to_char(target_period.due_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')),
    format('/?tab=report-form&period_id=%s', target_period.id)
  from public.user_profiles as profile
  where profile.is_active
    and not profile.force_password_reset
    and profile.commune_id = actor_commune
    and profile.role in ('can_bo_thon', 'to_cnscd')
    and (
      profile.village_id = any(p_village_ids)
      or exists (
        select 1
        from public.user_village_assignments as assignment
        where assignment.user_id = profile.id
          and assignment.village_id = any(p_village_ids)
      )
    );

  insert into public.audit_log (
    action, table_name, record_id, user_id, details
  ) values (
    'CREATE_REPORT_PERIOD', 'report_periods', target_period.id, actor,
    jsonb_build_object(
      'name', target_period.name,
      'due_date', target_period.due_date,
      'village_count', requested_count,
      'template_name', target_period.template_name
    )
  );

  return target_period;
end
$$;

revoke all on function public.create_report_period(text, timestamptz, uuid[], text)
  from public;
grant execute on function public.create_report_period(text, timestamptz, uuid[], text)
  to authenticated;

create function public.save_report_submission(
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
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_report public.reports%rowtype;
  target_report_id uuid := coalesce(p_report_id, gen_random_uuid());
  actor uuid := auth.uid();
  next_workflow public.report_workflow_status;
  next_timeliness public.report_timeliness_status;
  period_due timestamptz;
  blocking_count integer;
begin
  if actor is null or not public.profile_can_mutate() then
    raise exception 'authentication and an active profile are required' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  return query
  select
    receipt.report_id,
    receipt.version,
    receipt.workflow_status,
    receipt.timeliness_status,
    receipt.submitted_at,
    true
  from public.report_submission_receipts as receipt
  where receipt.idempotency_key = p_idempotency_key
    and receipt.user_id = actor;
  if found then
    return;
  end if;

  if jsonb_typeof(p_values) <> 'object' or jsonb_typeof(p_flags) <> 'array' then
    raise exception 'values must be an object and flags must be an array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(p_values) as item(code, raw_value)
    where code !~ '^CT(0[1-9]|1[0-4])$'
      or jsonb_typeof(raw_value) not in ('number', 'null')
      or (
        jsonb_typeof(raw_value) = 'number'
        and (
          (raw_value #>> '{}')::numeric < 0
          or (raw_value #>> '{}')::numeric <> trunc((raw_value #>> '{}')::numeric)
          or (raw_value #>> '{}')::numeric > 2147483647
        )
      )
  ) then
    raise exception 'values contain an invalid indicator or value' using errcode = '22023';
  end if;

  if p_submit and (
    jsonb_object_length(p_values) <> 14
    or exists (
      select 1
      from generate_series(1, 14) as indicator(number)
      where not (p_values ? ('CT' || lpad(indicator.number::text, 2, '0')))
        or p_values -> ('CT' || lpad(indicator.number::text, 2, '0')) = 'null'::jsonb
    )
  ) then
    raise exception 'a submission requires CT01 through CT14' using errcode = '22023';
  end if;

  select count(*)
  into blocking_count
  from jsonb_array_elements(p_flags) as flag
  where coalesce((flag ->> 'resolved')::boolean, false) = false
    and flag ->> 'error_type' in ('BLANK', 'TEXT', 'SEP', 'LOGIC', 'BADPHONE');
  if p_submit and blocking_count > 0 then
    raise exception 'unresolved blocking validation flags' using errcode = '22023';
  end if;

  select *
  into target_report
  from public.reports as report
  where report.id = target_report_id
  for update;

  if found then
    if target_report.village_id <> p_village_id or target_report.period_id <> p_period_id then
      raise exception 'report scope is immutable' using errcode = '22023';
    end if;
    if p_expected_version is null or p_expected_version <> target_report.version then
      raise exception 'report version conflict' using errcode = '40001';
    end if;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'new reports require expected_version 0 or null' using errcode = '40001';
    end if;
    insert into public.reports (
      id, village_id, period_id, workflow_status, timeliness_status,
      publication_status, report_source, version, idempotency_key,
      assisted_by_cnscd, assisted_member_name, created_by
    ) values (
      target_report_id, p_village_id, p_period_id, 'draft', 'not_submitted',
      'private', p_report_source, 1, p_idempotency_key,
      p_assisted_by_cnscd,
      case when p_assisted_by_cnscd then p_assisted_member_name else null end,
      actor
    )
    returning * into target_report;
  end if;

  delete from public.report_values where report_values.report_id = target_report_id;
  insert into public.report_values (report_id, ct_code, value)
  select
    target_report_id,
    item.code,
    case when item.raw_value = 'null'::jsonb then null
         else (item.raw_value #>> '{}')::integer end
  from jsonb_each(p_values) as item(code, raw_value);

  delete from public.report_validation_flags
  where report_validation_flags.report_id = target_report_id;
  insert into public.report_validation_flags (
    report_id, ct_code, error_type, message, resolved, resolved_at, resolved_by
  )
  select
    target_report_id,
    flag ->> 'ct_code',
    (flag ->> 'error_type')::public.validation_error_type,
    flag ->> 'message',
    coalesce((flag ->> 'resolved')::boolean, false),
    case when coalesce((flag ->> 'resolved')::boolean, false) then now() else null end,
    case when coalesce((flag ->> 'resolved')::boolean, false) then actor else null end
  from jsonb_array_elements(p_flags) as flag;

  select period.due_date into period_due
  from public.report_periods as period
  where period.id = p_period_id;
  if period_due is null then
    raise exception 'report period does not exist' using errcode = '22023';
  end if;

  next_workflow := case when p_submit then 'submitted' else 'draft' end;
  next_timeliness := case
    when not p_submit then 'not_submitted'
    when now() <= period_due then 'on_time'
    else 'late'
  end;

  update public.reports as report
  set workflow_status = next_workflow,
      timeliness_status = next_timeliness,
      report_source = p_report_source,
      idempotency_key = p_idempotency_key,
      assisted_by_cnscd = p_assisted_by_cnscd,
      assisted_member_name = case when p_assisted_by_cnscd then p_assisted_member_name else null end,
      submitted_by = case when p_submit then actor else report.submitted_by end,
      submitted_at = case when p_submit then coalesce(report.submitted_at, now()) else null end,
      version = case when report.id = target_report.id and target_report.created_at = report.created_at
                     then report.version + case when target_report.idempotency_key is distinct from p_idempotency_key then 1 else 0 end
                     else report.version end
  where report.id = target_report_id
  returning report.* into target_report;

  insert into public.report_submission_receipts (
    idempotency_key, report_id, user_id, version, workflow_status,
    timeliness_status, submitted_at
  ) values (
    p_idempotency_key, target_report.id, actor, target_report.version,
    target_report.workflow_status, target_report.timeliness_status,
    target_report.submitted_at
  );

  return query select
    target_report.id,
    target_report.version,
    target_report.workflow_status,
    target_report.timeliness_status,
    target_report.submitted_at,
    false;
end
$$;

revoke all on function public.save_report_submission(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb,
  integer, uuid, boolean, boolean, text
) from public;
grant execute on function public.save_report_submission(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb,
  integer, uuid, boolean, boolean, text
) to authenticated;

-- Production operations: every record is scoped to one commune and is auditable.
-- These tables deliberately contain no citizen PII and are never exposed to anon.
create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  period_id uuid references public.report_periods(id) on delete set null,
  village_id uuid references public.villages(id) on delete set null,
  source_type text not null default 'manual' check (source_type in ('manual', 'trend_alert', 'ai_draft', 'maturity', 'initiative', 'proposal')),
  source_id uuid,
  title text not null check (btrim(title) <> ''),
  description text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  owner_id uuid references public.user_profiles(id) on delete set null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  due_date date,
  completed_at timestamptz,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_items_commune_not_blank check (btrim(commune_id) <> ''),
  constraint action_items_completion_check check ((status = 'completed' and completed_at is not null) or (status <> 'completed'))
);

create table public.digital_maturity_assessments (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  quarter_start date not null,
  scores jsonb not null,
  evidence jsonb not null default '{}'::jsonb,
  action_plan text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  approved_by uuid references public.user_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maturity_commune_not_blank check (btrim(commune_id) <> ''),
  constraint maturity_scores_object check (jsonb_typeof(scores) = 'object'),
  constraint maturity_evidence_object check (jsonb_typeof(evidence) = 'object'),
  constraint maturity_quarter_unique unique (commune_id, quarter_start),
  constraint maturity_approval_metadata check ((status = 'approved' and approved_by is not null and approved_at is not null) or status <> 'approved')
);

create table public.innovation_initiatives (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  title text not null check (btrim(title) <> ''),
  problem_statement text not null check (btrim(problem_statement) <> ''),
  value_hypothesis text not null check (btrim(value_hypothesis) <> ''),
  owner_id uuid references public.user_profiles(id) on delete set null,
  effort text not null default 'M' check (effort in ('S', 'M', 'L')),
  data_risk text not null default 'low' check (data_risk in ('low', 'medium', 'high')),
  status text not null default 'idea' check (status in ('idea', 'pilot', 'active', 'paused', 'stopped', 'scaled')),
  kpi_baseline jsonb not null default '{}'::jsonb,
  kpi_target jsonb not null default '{}'::jsonb,
  kpi_outcome jsonb not null default '{}'::jsonb,
  decision text not null default 'pending' check (decision in ('pending', 'continue', 'stop', 'scale')),
  decision_notes text,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innovation_commune_not_blank check (btrim(commune_id) <> ''),
  constraint innovation_kpi_objects check (jsonb_typeof(kpi_baseline) = 'object' and jsonb_typeof(kpi_target) = 'object' and jsonb_typeof(kpi_outcome) = 'object')
);

create table public.ai_action_drafts (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  period_id uuid references public.report_periods(id) on delete set null,
  village_id uuid references public.villages(id) on delete set null,
  kind text not null check (kind in ('period_brief', 'trend_alert', 'proposal_triage')),
  content text not null check (btrim(content) <> ''),
  citations jsonb not null default '[]'::jsonb,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  model_provider text not null,
  status text not null default 'pending_review' check (status in ('pending_review', 'accepted', 'rejected')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  reviewed_by uuid references public.user_profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  constraint ai_drafts_commune_not_blank check (btrim(commune_id) <> ''),
  constraint ai_drafts_citations_array check (jsonb_typeof(citations) = 'array'),
  constraint ai_drafts_review_metadata check ((status in ('accepted', 'rejected') and reviewed_by is not null and reviewed_at is not null) or status = 'pending_review')
);

create index action_items_scope_idx on public.action_items (commune_id, period_id, village_id, status);
create index innovation_initiatives_scope_idx on public.innovation_initiatives (commune_id, status);
create index ai_action_drafts_scope_idx on public.ai_action_drafts (commune_id, period_id, status);
create trigger action_items_set_updated_at before update on public.action_items for each row execute function public.set_updated_at();
create trigger maturity_set_updated_at before update on public.digital_maturity_assessments for each row execute function public.set_updated_at();
create trigger innovation_set_updated_at before update on public.innovation_initiatives for each row execute function public.set_updated_at();

create function public.audit_operations_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.audit_log (action, table_name, record_id, user_id, details)
  values (tg_op, tg_table_name, target_id, auth.uid(), jsonb_build_object('source', 'operations'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
create trigger action_items_audit after insert or update or delete on public.action_items for each row execute function public.audit_operations_change();
create trigger maturity_audit after insert or update or delete on public.digital_maturity_assessments for each row execute function public.audit_operations_change();
create trigger innovation_audit after insert or update or delete on public.innovation_initiatives for each row execute function public.audit_operations_change();
create trigger ai_drafts_audit after insert or update or delete on public.ai_action_drafts for each row execute function public.audit_operations_change();

alter table public.action_items enable row level security;
alter table public.digital_maturity_assessments enable row level security;
alter table public.innovation_initiatives enable row level security;
alter table public.ai_action_drafts enable row level security;
grant select, insert, update on public.action_items, public.digital_maturity_assessments, public.innovation_initiatives, public.ai_action_drafts to authenticated;

create policy action_items_select_scoped on public.action_items for select to authenticated using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  or owner_id = auth.uid()
  or (village_id is not null and public.can_select_village(village_id))
);
create policy action_items_insert_admin on public.action_items for insert to authenticated with check (
  public.profile_role() = 'admin_xa' and public.profile_can_mutate()
);
create policy action_items_update_scoped on public.action_items for update to authenticated using (
  (public.profile_role() = 'admin_xa' and public.profile_can_mutate())
  or (owner_id = auth.uid() and public.profile_can_mutate())
) with check (
  (public.profile_role() = 'admin_xa' and public.profile_can_mutate())
  or (owner_id = auth.uid() and public.profile_can_mutate())
);
create policy maturity_select_internal on public.digital_maturity_assessments for select to authenticated using (public.profile_role() in ('admin_xa', 'lanh_dao'));
create policy maturity_mutate_admin on public.digital_maturity_assessments for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());
create policy initiatives_select_internal on public.innovation_initiatives for select to authenticated using (public.profile_role() in ('admin_xa', 'lanh_dao'));
create policy initiatives_mutate_admin on public.innovation_initiatives for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());
create policy ai_drafts_select_internal on public.ai_action_drafts for select to authenticated using (public.profile_role() in ('admin_xa', 'lanh_dao'));
create policy ai_drafts_insert_internal on public.ai_action_drafts for insert to authenticated with check (public.profile_role() in ('admin_xa', 'lanh_dao') and public.profile_can_mutate());
create policy ai_drafts_update_admin on public.ai_action_drafts for update to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());

commit;
