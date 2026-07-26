-- Enforce commune isolation for legacy core reads and the operations overlay.
-- Business requests must use the caller JWT; service-role access is reserved
-- for narrow administration and anonymous capability endpoints.
begin;

alter table public.audit_log
  add column if not exists commune_id text;

update public.audit_log as audit
set commune_id = profile.commune_id
from public.user_profiles as profile
where audit.commune_id is null
  and audit.user_id = profile.id;

alter table public.audit_log
  drop constraint if exists audit_log_commune_not_blank;
alter table public.audit_log
  add constraint audit_log_commune_not_blank
  check (commune_id is null or btrim(commune_id) <> '');

create or replace function public.assign_audit_log_commune()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.commune_id is null then
    select profile.commune_id
    into new.commune_id
    from public.user_profiles as profile
    where profile.id = coalesce(new.user_id, auth.uid());
  end if;
  return new;
end
$$;

drop trigger if exists audit_log_assign_commune on public.audit_log;
create trigger audit_log_assign_commune
before insert on public.audit_log
for each row execute function public.assign_audit_log_commune();

create index if not exists audit_log_commune_created_idx
  on public.audit_log (commune_id, created_at desc);

drop policy if exists audit_log_select_admin_only on public.audit_log;
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin
on public.audit_log for select to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
);

drop policy if exists reports_select_all_roles on public.reports;
drop policy if exists reports_select_scoped on public.reports;
create policy reports_select_scoped
on public.reports for select to authenticated
using (public.can_select_village(village_id));

drop policy if exists pending_updates_select_all_roles on public.pending_updates;
drop policy if exists pending_updates_select_scoped on public.pending_updates;
create policy pending_updates_select_scoped
on public.pending_updates for select to authenticated
using (public.can_select_report(report_id));

drop policy if exists villages_legacy_select_internal on public.villages_legacy;
create policy villages_legacy_select_internal
on public.villages_legacy for select to authenticated
using (
  public.profile_role() is not null
  and commune_id = public.profile_commune_id()
);

drop policy if exists assignments_select_scoped on public.user_village_assignments;
create policy assignments_select_scoped
on public.user_village_assignments for select to authenticated
using (
  user_id = auth.uid()
  or (
    public.profile_role() in ('admin_xa', 'lanh_dao')
    and exists (
      select 1
      from public.villages as village
      where village.id = user_village_assignments.village_id
        and village.commune_id = public.profile_commune_id()
    )
  )
);

drop policy if exists assignments_write_admin on public.user_village_assignments;
create policy assignments_write_admin
on public.user_village_assignments for all to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and exists (
    select 1
    from public.villages as village
    where village.id = user_village_assignments.village_id
      and village.commune_id = public.profile_commune_id()
  )
)
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and exists (
    select 1
    from public.villages as village
    join public.user_profiles as assignee
      on assignee.id = user_village_assignments.user_id
    where village.id = user_village_assignments.village_id
      and village.commune_id = public.profile_commune_id()
      and assignee.commune_id = village.commune_id
  )
);

drop policy if exists case_assignments_mutate_admin on public.case_assignments;
create policy case_assignments_mutate_admin
on public.case_assignments for all to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and exists (
    select 1
    from public.citizen_cases as citizen_case
    where citizen_case.id = case_assignments.case_id
      and citizen_case.commune_id = public.profile_commune_id()
  )
)
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and exists (
    select 1
    from public.citizen_cases as citizen_case
    where citizen_case.id = case_assignments.case_id
      and citizen_case.commune_id = public.profile_commune_id()
  )
  and (
    case_assignments.assignee_id is null
    or exists (
      select 1
      from public.user_profiles as assignee
      where assignee.id = case_assignments.assignee_id
        and assignee.commune_id = public.profile_commune_id()
    )
  )
);

drop policy if exists action_items_select_scoped on public.action_items;
create policy action_items_select_scoped
on public.action_items for select to authenticated
using (
  commune_id = public.profile_commune_id()
  and (
    public.profile_role() in ('admin_xa', 'lanh_dao')
    or owner_id = auth.uid()
    or (village_id is not null and public.can_select_village(village_id))
  )
);

drop policy if exists action_items_insert_admin on public.action_items;
create policy action_items_insert_admin
on public.action_items for insert to authenticated
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
);

drop policy if exists action_items_update_scoped on public.action_items;
create policy action_items_update_scoped
on public.action_items for update to authenticated
using (
  commune_id = public.profile_commune_id()
  and (
    (public.profile_role() = 'admin_xa' and public.profile_can_mutate())
    or (owner_id = auth.uid() and public.profile_can_mutate())
  )
)
with check (
  commune_id = public.profile_commune_id()
  and (
    (public.profile_role() = 'admin_xa' and public.profile_can_mutate())
    or (owner_id = auth.uid() and public.profile_can_mutate())
  )
);

drop policy if exists maturity_select_internal on public.digital_maturity_assessments;
create policy maturity_select_internal
on public.digital_maturity_assessments for select to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  and commune_id = public.profile_commune_id()
);

drop policy if exists maturity_mutate_admin on public.digital_maturity_assessments;
create policy maturity_mutate_admin
on public.digital_maturity_assessments for all to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
)
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
);

drop policy if exists initiatives_select_internal on public.innovation_initiatives;
create policy initiatives_select_internal
on public.innovation_initiatives for select to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  and commune_id = public.profile_commune_id()
);

drop policy if exists initiatives_mutate_admin on public.innovation_initiatives;
create policy initiatives_mutate_admin
on public.innovation_initiatives for all to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
)
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
);

drop policy if exists ai_drafts_select_internal on public.ai_action_drafts;
create policy ai_drafts_select_internal
on public.ai_action_drafts for select to authenticated
using (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  and commune_id = public.profile_commune_id()
);

drop policy if exists ai_drafts_insert_internal on public.ai_action_drafts;
create policy ai_drafts_insert_internal
on public.ai_action_drafts for insert to authenticated
with check (
  public.profile_role() in ('admin_xa', 'lanh_dao')
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
);

drop policy if exists ai_drafts_update_admin on public.ai_action_drafts;
create policy ai_drafts_update_admin
on public.ai_action_drafts for update to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
)
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
);

revoke all on function public.assign_audit_log_commune() from public, anon, authenticated;

commit;
