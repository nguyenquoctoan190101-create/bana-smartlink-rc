-- Citizen field reporting foundation.  This domain is intentionally separate
-- from pending_updates (the public data-correction workflow).
begin;

create table if not exists public.citizen_cases (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  village_id uuid references public.villages(id) on delete restrict,
  category text not null check (category in ('road', 'waste', 'water', 'power', 'public_building', 'drainage', 'safety', 'other')),
  description text not null check (char_length(btrim(description)) between 5 and 4000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status text not null default 'received' check (status in ('received', 'verifying', 'assigned', 'in_progress', 'completed', 'out_of_scope', 'rejected')),
  assigned_department text,
  sla_due_at timestamptz,
  submitter_name text,
  submitter_phone text,
  submitter_address text,
  consent_version text not null,
  consent_at timestamptz not null,
  tracking_code_hash text not null unique check (tracking_code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint citizen_cases_commune_not_blank check (btrim(commune_id) <> ''),
  constraint citizen_cases_phone_format check (submitter_phone is null or submitter_phone ~ '^\\+?[0-9]{9,15}$')
);

create table if not exists public.case_locations (
  case_id uuid primary key references public.citizen_cases(id) on delete cascade,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  accuracy_m numeric(10,2) check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  source text not null check (source in ('gps', 'manual_pin')),
  confirmed_by_submitter boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.case_media (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.citizen_cases(id) on delete cascade,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.case_status_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.citizen_cases(id) on delete cascade,
  old_status text,
  new_status text not null,
  note text,
  changed_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.citizen_cases(id) on delete cascade,
  department text not null check (btrim(department) <> ''),
  assignee_id uuid references public.user_profiles(id) on delete set null,
  assigned_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  category text not null,
  department text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  is_active boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (commune_id, category, priority)
);

create index if not exists citizen_cases_scope_idx on public.citizen_cases (commune_id, village_id, status, created_at desc);
create index if not exists case_media_case_idx on public.case_media (case_id, created_at);
create index if not exists case_history_case_idx on public.case_status_history (case_id, created_at desc);

create or replace function public.citizen_case_audit_status()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.case_status_history(case_id, new_status, changed_by, note)
    values (new.id, new.status, auth.uid(), 'received');
  elsif old.status is distinct from new.status then
    insert into public.case_status_history(case_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end
$$;

drop trigger if exists citizen_case_status_audit on public.citizen_cases;
create trigger citizen_case_status_audit after insert or update of status on public.citizen_cases
for each row execute function public.citizen_case_audit_status();
drop trigger if exists citizen_cases_set_updated_at on public.citizen_cases;
create trigger citizen_cases_set_updated_at before update on public.citizen_cases
for each row execute function public.set_updated_at();

create or replace function public.create_citizen_case(
  p_commune_id text, p_village_id uuid, p_category text, p_description text,
  p_priority text, p_submitter_name text, p_submitter_phone text,
  p_submitter_address text, p_consent_version text, p_consent_at timestamptz,
  p_tracking_code_hash text, p_latitude numeric default null,
  p_longitude numeric default null, p_accuracy_m numeric default null,
  p_location_source text default null, p_location_confirmed boolean default false
) returns table (id uuid, status text, created_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare new_id uuid;
begin
  if p_consent_version is null or p_consent_at is null then raise exception 'consent_required' using errcode = '23514'; end if;
  insert into public.citizen_cases(commune_id, village_id, category, description, priority,
    submitter_name, submitter_phone, submitter_address, consent_version, consent_at, tracking_code_hash)
  values (p_commune_id, p_village_id, p_category, p_description, p_priority,
    nullif(btrim(p_submitter_name), ''), nullif(btrim(p_submitter_phone), ''),
    nullif(btrim(p_submitter_address), ''), p_consent_version, p_consent_at, p_tracking_code_hash)
  returning citizen_cases.id into new_id;
  if p_latitude is not null and p_longitude is not null then
    insert into public.case_locations(case_id, latitude, longitude, accuracy_m, source, confirmed_by_submitter)
    values (new_id, p_latitude, p_longitude, p_accuracy_m, coalesce(p_location_source, 'manual_pin'), p_location_confirmed);
  end if;
  return query select c.id, c.status, c.created_at from public.citizen_cases c where c.id = new_id;
end
$$;

revoke all on function public.create_citizen_case(text, uuid, text, text, text, text, text, text, text, timestamptz, text, numeric, numeric, numeric, text, boolean) from public, authenticated, anon;
grant execute on function public.create_citizen_case(text, uuid, text, text, text, text, text, text, text, timestamptz, text, numeric, numeric, numeric, text, boolean) to anon, authenticated;

alter table public.citizen_cases enable row level security;
alter table public.case_locations enable row level security;
alter table public.case_media enable row level security;
alter table public.case_status_history enable row level security;
alter table public.case_assignments enable row level security;
alter table public.routing_rules enable row level security;

revoke all on public.citizen_cases, public.case_locations, public.case_media, public.case_status_history, public.case_assignments, public.routing_rules from anon, authenticated;
grant select, update on public.citizen_cases to authenticated;
grant select on public.case_locations, public.case_media, public.case_status_history, public.case_assignments, public.routing_rules to authenticated;
grant insert, update on public.case_assignments, public.routing_rules to authenticated;

create policy citizen_cases_select_internal on public.citizen_cases for select to authenticated using (
  public.profile_role() in ('admin_xa', 'lanh_dao') and commune_id = public.profile_commune_id()
  or (public.profile_role() in ('to_cnscd', 'can_bo_thon') and commune_id = public.profile_commune_id() and (village_id is null or public.can_select_village(village_id)))
);
create policy citizen_cases_update_internal on public.citizen_cases for update to authenticated using (
  public.profile_role() in ('admin_xa', 'to_cnscd') and commune_id = public.profile_commune_id()
) with check (public.profile_role() in ('admin_xa', 'to_cnscd') and commune_id = public.profile_commune_id());
create policy case_locations_select_internal on public.case_locations for select to authenticated using (exists (select 1 from public.citizen_cases c where c.id = case_id and c.commune_id = public.profile_commune_id()));
create policy case_media_select_internal on public.case_media for select to authenticated using (exists (select 1 from public.citizen_cases c where c.id = case_id and c.commune_id = public.profile_commune_id()));
create policy case_history_select_internal on public.case_status_history for select to authenticated using (exists (select 1 from public.citizen_cases c where c.id = case_id and c.commune_id = public.profile_commune_id()));
create policy case_assignments_select_internal on public.case_assignments for select to authenticated using (exists (select 1 from public.citizen_cases c where c.id = case_id and c.commune_id = public.profile_commune_id()));
create policy case_assignments_mutate_admin on public.case_assignments for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());
create policy routing_rules_select_internal on public.routing_rules for select to authenticated using (commune_id = public.profile_commune_id());
create policy routing_rules_mutate_admin on public.routing_rules for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());

commit;
