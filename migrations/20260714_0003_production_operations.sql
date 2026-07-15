-- Production operations foundations: action ownership, data-governance evidence,
-- innovation portfolio and human-reviewed AI drafts.  Apply after 0002.
begin;

alter table public.pending_updates add column if not exists tracking_code text;
update public.pending_updates
set tracking_code = upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16))
where tracking_code is null;
alter table public.pending_updates alter column tracking_code set not null;
alter table public.pending_updates drop constraint if exists pending_updates_tracking_code_format;
alter table public.pending_updates add constraint pending_updates_tracking_code_format check (tracking_code ~ '^[A-Z0-9]{16}$');
create unique index if not exists pending_updates_tracking_code_unique_idx on public.pending_updates (tracking_code);

create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(), commune_id text not null,
  period_id uuid references public.report_periods(id) on delete set null,
  village_id uuid references public.villages(id) on delete set null,
  source_type text not null default 'manual' check (source_type in ('manual','trend_alert','ai_draft','maturity','initiative','proposal')),
  source_id uuid, title text not null check (btrim(title) <> ''), description text,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  owner_id uuid references public.user_profiles(id) on delete set null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  due_date date, completed_at timestamptz, outcome text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint action_items_commune_not_blank check (btrim(commune_id) <> ''),
  constraint action_items_completion_check check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);
create table if not exists public.digital_maturity_assessments (
  id uuid primary key default gen_random_uuid(), commune_id text not null, quarter_start date not null,
  scores jsonb not null, evidence jsonb not null default '{}'::jsonb, action_plan text,
  status text not null default 'draft' check (status in ('draft','submitted','approved')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  approved_by uuid references public.user_profiles(id) on delete restrict, approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint maturity_commune_not_blank check (btrim(commune_id) <> ''),
  constraint maturity_scores_object check (jsonb_typeof(scores) = 'object'),
  constraint maturity_evidence_object check (jsonb_typeof(evidence) = 'object'),
  constraint maturity_quarter_unique unique (commune_id, quarter_start),
  constraint maturity_approval_metadata check ((status = 'approved' and approved_by is not null and approved_at is not null) or status <> 'approved')
);
create table if not exists public.innovation_initiatives (
  id uuid primary key default gen_random_uuid(), commune_id text not null,
  title text not null check (btrim(title) <> ''), problem_statement text not null check (btrim(problem_statement) <> ''),
  value_hypothesis text not null check (btrim(value_hypothesis) <> ''),
  owner_id uuid references public.user_profiles(id) on delete set null,
  effort text not null default 'M' check (effort in ('S','M','L')),
  data_risk text not null default 'low' check (data_risk in ('low','medium','high')),
  status text not null default 'idea' check (status in ('idea','pilot','active','paused','stopped','scaled')),
  kpi_baseline jsonb not null default '{}'::jsonb, kpi_target jsonb not null default '{}'::jsonb, kpi_outcome jsonb not null default '{}'::jsonb,
  decision text not null default 'pending' check (decision in ('pending','continue','stop','scale')), decision_notes text,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint innovation_commune_not_blank check (btrim(commune_id) <> ''),
  constraint innovation_kpi_objects check (jsonb_typeof(kpi_baseline) = 'object' and jsonb_typeof(kpi_target) = 'object' and jsonb_typeof(kpi_outcome) = 'object')
);
create table if not exists public.ai_action_drafts (
  id uuid primary key default gen_random_uuid(), commune_id text not null,
  period_id uuid references public.report_periods(id) on delete set null, village_id uuid references public.villages(id) on delete set null,
  kind text not null check (kind in ('period_brief','trend_alert','proposal_triage')),
  content text not null check (btrim(content) <> ''), citations jsonb not null default '[]'::jsonb,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1), model_provider text not null,
  status text not null default 'pending_review' check (status in ('pending_review','accepted','rejected')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  reviewed_by uuid references public.user_profiles(id) on delete restrict, reviewed_at timestamptz, review_notes text,
  created_at timestamptz not null default now(),
  constraint ai_drafts_commune_not_blank check (btrim(commune_id) <> ''),
  constraint ai_drafts_citations_array check (jsonb_typeof(citations) = 'array'),
  constraint ai_drafts_review_metadata check ((status in ('accepted','rejected') and reviewed_by is not null and reviewed_at is not null) or status = 'pending_review')
);
create index if not exists action_items_scope_idx on public.action_items (commune_id, period_id, village_id, status);
create index if not exists innovation_initiatives_scope_idx on public.innovation_initiatives (commune_id, status);
create index if not exists ai_action_drafts_scope_idx on public.ai_action_drafts (commune_id, period_id, status);
drop trigger if exists action_items_set_updated_at on public.action_items;
create trigger action_items_set_updated_at before update on public.action_items for each row execute function public.set_updated_at();
drop trigger if exists maturity_set_updated_at on public.digital_maturity_assessments;
create trigger maturity_set_updated_at before update on public.digital_maturity_assessments for each row execute function public.set_updated_at();
drop trigger if exists innovation_set_updated_at on public.innovation_initiatives;
create trigger innovation_set_updated_at before update on public.innovation_initiatives for each row execute function public.set_updated_at();
create or replace function public.audit_operations_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.audit_log (action, table_name, record_id, user_id, details)
  values (tg_op, tg_table_name, target_id, auth.uid(), jsonb_build_object('source', 'operations'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
drop trigger if exists action_items_audit on public.action_items;
create trigger action_items_audit after insert or update or delete on public.action_items for each row execute function public.audit_operations_change();
drop trigger if exists maturity_audit on public.digital_maturity_assessments;
create trigger maturity_audit after insert or update or delete on public.digital_maturity_assessments for each row execute function public.audit_operations_change();
drop trigger if exists innovation_audit on public.innovation_initiatives;
create trigger innovation_audit after insert or update or delete on public.innovation_initiatives for each row execute function public.audit_operations_change();
drop trigger if exists ai_drafts_audit on public.ai_action_drafts;
create trigger ai_drafts_audit after insert or update or delete on public.ai_action_drafts for each row execute function public.audit_operations_change();

alter table public.action_items enable row level security;
alter table public.digital_maturity_assessments enable row level security;
alter table public.innovation_initiatives enable row level security;
alter table public.ai_action_drafts enable row level security;
grant select, insert, update on public.action_items, public.digital_maturity_assessments, public.innovation_initiatives, public.ai_action_drafts to authenticated;

drop policy if exists action_items_select_scoped on public.action_items;
create policy action_items_select_scoped on public.action_items for select to authenticated using (public.profile_role() in ('admin_xa','lanh_dao') or owner_id = auth.uid() or (village_id is not null and public.can_select_village(village_id)));
drop policy if exists action_items_insert_admin on public.action_items;
create policy action_items_insert_admin on public.action_items for insert to authenticated with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());
drop policy if exists action_items_update_scoped on public.action_items;
create policy action_items_update_scoped on public.action_items for update to authenticated using ((public.profile_role() = 'admin_xa' and public.profile_can_mutate()) or (owner_id = auth.uid() and public.profile_can_mutate())) with check ((public.profile_role() = 'admin_xa' and public.profile_can_mutate()) or (owner_id = auth.uid() and public.profile_can_mutate()));
drop policy if exists maturity_select_internal on public.digital_maturity_assessments;
create policy maturity_select_internal on public.digital_maturity_assessments for select to authenticated using (public.profile_role() in ('admin_xa','lanh_dao'));
drop policy if exists maturity_mutate_admin on public.digital_maturity_assessments;
create policy maturity_mutate_admin on public.digital_maturity_assessments for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());
drop policy if exists initiatives_select_internal on public.innovation_initiatives;
create policy initiatives_select_internal on public.innovation_initiatives for select to authenticated using (public.profile_role() in ('admin_xa','lanh_dao'));
drop policy if exists initiatives_mutate_admin on public.innovation_initiatives;
create policy initiatives_mutate_admin on public.innovation_initiatives for all to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());
drop policy if exists ai_drafts_select_internal on public.ai_action_drafts;
create policy ai_drafts_select_internal on public.ai_action_drafts for select to authenticated using (public.profile_role() in ('admin_xa','lanh_dao'));
drop policy if exists ai_drafts_insert_internal on public.ai_action_drafts;
create policy ai_drafts_insert_internal on public.ai_action_drafts for insert to authenticated with check (public.profile_role() in ('admin_xa','lanh_dao') and public.profile_can_mutate());
drop policy if exists ai_drafts_update_admin on public.ai_action_drafts;
create policy ai_drafts_update_admin on public.ai_action_drafts for update to authenticated using (public.profile_role() = 'admin_xa' and public.profile_can_mutate()) with check (public.profile_role() = 'admin_xa' and public.profile_can_mutate());

commit;
