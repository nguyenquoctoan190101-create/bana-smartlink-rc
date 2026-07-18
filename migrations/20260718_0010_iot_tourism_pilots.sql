-- Feature-flagged pilot domains. Disabled by default; no public access to raw sensor data.
begin;

create table if not exists public.sensor_devices (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  name text not null check (btrim(name) <> ''),
  device_type text not null check (device_type in ('water_level', 'rain_gauge', 'vibration', 'noise', 'tilt', 'other')),
  unit text not null,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  calibration_status text not null default 'unknown' check (calibration_status in ('unknown', 'valid', 'expired', 'failed')),
  last_seen_at timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sensor_observations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.sensor_devices(id) on delete cascade,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  value numeric not null,
  unit text not null,
  quality_flag text not null default 'good' check (quality_flag in ('good', 'suspect', 'bad', 'uncalibrated')),
  source_message_id text,
  unique (device_id, observed_at, source_message_id)
);

create table if not exists public.sensor_health (
  device_id uuid primary key references public.sensor_devices(id) on delete cascade,
  battery_pct numeric(5,2) check (battery_pct between 0 and 100),
  signal_strength numeric,
  last_error text,
  checked_at timestamptz not null default now()
);

create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  name text not null,
  device_type text not null,
  threshold numeric not null,
  comparator text not null check (comparator in ('gt', 'gte', 'lt', 'lte')),
  hysteresis numeric not null default 0 check (hysteresis >= 0),
  severity text not null default 'advisory' check (severity in ('advisory', 'watch', 'warning', 'emergency')),
  is_active boolean not null default true,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  rule_id uuid references public.alert_rules(id) on delete set null,
  device_id uuid references public.sensor_devices(id) on delete set null,
  severity text not null check (severity in ('advisory', 'watch', 'warning', 'emergency')),
  headline text not null,
  description text not null,
  source text not null default 'sensor_rule',
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'cancelled')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'web_push', 'sms', 'zalo')),
  recipient_scope text not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed', 'cancelled')),
  delivered_at timestamptz,
  provider_receipt text,
  created_at timestamptz not null default now(),
  unique (alert_id, channel, recipient_scope)
);

create table if not exists public.tourism_places (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  name text not null,
  category text not null check (category in ('nature', 'heritage', 'homestay', 'food', 'craft', 'service')),
  summary text not null,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  accessibility_notes text,
  opening_hours text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved' and approved_by is not null and approved_at is not null) or status <> 'approved')
);

create table if not exists public.tourism_content (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.tourism_places(id) on delete cascade,
  locale text not null default 'vi',
  title text not null,
  body text not null,
  media_url text,
  content_license text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sensor_observations_device_time_idx on public.sensor_observations (device_id, observed_at desc);
create index if not exists alerts_commune_status_idx on public.alerts (commune_id, status, effective_from desc);
create index if not exists tourism_public_idx on public.tourism_places (commune_id, status, category, name);
drop trigger if exists sensor_devices_updated_at on public.sensor_devices;
create trigger sensor_devices_updated_at before update on public.sensor_devices for each row execute function public.set_updated_at();
drop trigger if exists tourism_places_updated_at on public.tourism_places;
create trigger tourism_places_updated_at before update on public.tourism_places for each row execute function public.set_updated_at();

alter table public.sensor_devices enable row level security;
alter table public.sensor_observations enable row level security;
alter table public.sensor_health enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_deliveries enable row level security;
alter table public.tourism_places enable row level security;
alter table public.tourism_content enable row level security;
grant select, insert, update on public.sensor_devices, public.sensor_observations, public.sensor_health, public.alert_rules, public.alerts, public.alert_deliveries, public.tourism_places, public.tourism_content to authenticated;

create policy sensor_devices_internal on public.sensor_devices for all to authenticated using (public.profile_role() in ('admin_xa', 'lanh_dao') and commune_id = public.profile_commune_id()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());
create policy observations_internal on public.sensor_observations for all to authenticated using (exists (select 1 from public.sensor_devices d where d.id = device_id and d.commune_id = public.profile_commune_id() and public.profile_role() in ('admin_xa', 'lanh_dao'))) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and exists (select 1 from public.sensor_devices d where d.id = device_id and d.commune_id = public.profile_commune_id()));
create policy sensor_health_internal on public.sensor_health for all to authenticated using (exists (select 1 from public.sensor_devices d where d.id = device_id and d.commune_id = public.profile_commune_id() and public.profile_role() in ('admin_xa', 'lanh_dao'))) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and exists (select 1 from public.sensor_devices d where d.id = device_id and d.commune_id = public.profile_commune_id()));
create policy alert_rules_internal on public.alert_rules for all to authenticated using (commune_id = public.profile_commune_id() and public.profile_role() in ('admin_xa', 'lanh_dao')) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());
create policy alerts_internal on public.alerts for select to authenticated using (commune_id = public.profile_commune_id() and public.profile_role() in ('admin_xa', 'lanh_dao'));
create policy alert_deliveries_internal on public.alert_deliveries for select to authenticated using (exists (select 1 from public.alerts a where a.id = alert_id and a.commune_id = public.profile_commune_id() and public.profile_role() in ('admin_xa', 'lanh_dao')));
create policy tourism_internal on public.tourism_places for all to authenticated using (commune_id = public.profile_commune_id() and public.profile_role() in ('admin_xa', 'lanh_dao')) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());
create policy tourism_content_internal on public.tourism_content for all to authenticated using (exists (select 1 from public.tourism_places p where p.id = place_id and p.commune_id = public.profile_commune_id() and public.profile_role() in ('admin_xa', 'lanh_dao'))) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and exists (select 1 from public.tourism_places p where p.id = place_id and p.commune_id = public.profile_commune_id()));

commit;
