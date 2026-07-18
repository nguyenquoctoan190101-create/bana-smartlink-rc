-- P1 knowledge / Digital Champions and P2 deterministic scenario lab.
begin;

create table if not exists public.digital_champions (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  village_id uuid references public.villages(id) on delete set null,
  skills jsonb not null default '[]'::jsonb,
  support_schedule text,
  supported_groups text,
  is_active boolean not null default true,
  outcome_notes text,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commune_id, user_id),
  check (jsonb_typeof(skills) = 'array')
);

create table if not exists public.community_support_points (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  village_id uuid references public.villages(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  address text not null,
  opening_hours text,
  equipment jsonb not null default '[]'::jsonb,
  champion_id uuid references public.digital_champions(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(equipment) = 'array')
);

create table if not exists public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  summary text,
  body text not null check (char_length(btrim(body)) between 3 and 30000),
  category text not null check (category in ('procedure', 'guidance', 'lesson_learned', 'faq', 'policy')),
  audience text not null default 'internal' check (audience in ('internal', 'champions', 'public')),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'archived')),
  effective_from date,
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved' and approved_by is not null and approved_at is not null) or status <> 'approved')
);

create table if not exists public.knowledge_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  version integer not null check (version > 0),
  title text not null,
  body text not null,
  changed_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (article_id, version)
);

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  name text not null check (char_length(btrim(name)) between 3 and 180),
  description text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved' and approved_by is not null and approved_at is not null) or status <> 'approved')
);

create table if not exists public.scenario_assumptions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scenarios(id) on delete cascade,
  key text not null check (key in ('population_change_pct', 'budget_change_pct', 'service_demand_change_pct')),
  value numeric not null check (value between -100 and 1000),
  unit text not null default 'percent',
  source_note text,
  unique (scenario_id, key)
);

create table if not exists public.scenario_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scenarios(id) on delete restrict,
  commune_id text not null,
  baseline jsonb not null check (jsonb_typeof(baseline) = 'object'),
  assumptions jsonb not null check (jsonb_typeof(assumptions) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  formula_version text not null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_scope_idx on public.knowledge_articles (commune_id, status, audience, updated_at desc);
create index if not exists scenario_scope_idx on public.scenarios (commune_id, status, updated_at desc);
create index if not exists scenario_runs_scope_idx on public.scenario_runs (commune_id, created_at desc);
drop trigger if exists digital_champions_updated_at on public.digital_champions;
create trigger digital_champions_updated_at before update on public.digital_champions for each row execute function public.set_updated_at();
drop trigger if exists support_points_updated_at on public.community_support_points;
create trigger support_points_updated_at before update on public.community_support_points for each row execute function public.set_updated_at();
drop trigger if exists knowledge_articles_updated_at on public.knowledge_articles;
create trigger knowledge_articles_updated_at before update on public.knowledge_articles for each row execute function public.set_updated_at();
drop trigger if exists scenarios_updated_at on public.scenarios;
create trigger scenarios_updated_at before update on public.scenarios for each row execute function public.set_updated_at();

alter table public.digital_champions enable row level security;
alter table public.community_support_points enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.knowledge_revisions enable row level security;
alter table public.scenarios enable row level security;
alter table public.scenario_assumptions enable row level security;
alter table public.scenario_runs enable row level security;
grant select on public.digital_champions, public.community_support_points, public.knowledge_articles, public.knowledge_revisions, public.scenarios, public.scenario_assumptions, public.scenario_runs to authenticated;
grant insert, update on public.digital_champions, public.community_support_points, public.knowledge_articles, public.knowledge_revisions, public.scenarios, public.scenario_assumptions, public.scenario_runs to authenticated;

create policy champions_select_internal on public.digital_champions for select to authenticated using (commune_id = public.profile_commune_id());
create policy champions_mutate_admin on public.digital_champions for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());
create policy support_points_select_internal on public.community_support_points for select to authenticated using (commune_id = public.profile_commune_id());
create policy support_points_mutate_admin on public.community_support_points for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());
create policy knowledge_select_internal on public.knowledge_articles for select to authenticated using (commune_id = public.profile_commune_id() and (audience <> 'public' or status = 'approved'));
create policy knowledge_mutate_admin on public.knowledge_articles for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());
create policy knowledge_revisions_select_internal on public.knowledge_revisions for select to authenticated using (exists (select 1 from public.knowledge_articles a where a.id = article_id and a.commune_id = public.profile_commune_id()));
create policy knowledge_revisions_insert_admin on public.knowledge_revisions for insert to authenticated with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and exists (select 1 from public.knowledge_articles a where a.id = article_id and a.commune_id = public.profile_commune_id()));
create policy scenarios_select_internal on public.scenarios for select to authenticated using (commune_id = public.profile_commune_id());
create policy scenarios_mutate_admin on public.scenarios for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());
create policy scenario_assumptions_select_internal on public.scenario_assumptions for select to authenticated using (exists (select 1 from public.scenarios s where s.id = scenario_id and s.commune_id = public.profile_commune_id()));
create policy scenario_assumptions_mutate_admin on public.scenario_assumptions for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and exists (select 1 from public.scenarios s where s.id = scenario_id and s.commune_id = public.profile_commune_id())) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and exists (select 1 from public.scenarios s where s.id = scenario_id and s.commune_id = public.profile_commune_id()));
create policy scenario_runs_select_internal on public.scenario_runs for select to authenticated using (commune_id = public.profile_commune_id());
create policy scenario_runs_insert_admin on public.scenario_runs for insert to authenticated with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate() and commune_id = public.profile_commune_id());

commit;
