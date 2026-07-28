-- Keep leadership access to decision-support drafts read-only and make every
-- review a one-way, database-authenticated transition. Duplicate pending rows
-- fail closed. Legacy terminal metadata remains immutable and audit-visible to
-- administrators; this overlay never chooses, edits, or deletes user data.

begin;

do $$
begin
  if exists (
    select 1
    from public.ai_action_drafts
    where status = 'pending_review'
    group by commune_id, period_id, kind
    having count(*) > 1
  ) then
    raise exception 'duplicate pending decision drafts require manual review before migration'
      using errcode = '23505';
  end if;

end
$$;

alter table public.ai_action_drafts
  drop constraint if exists ai_drafts_review_metadata;
alter table public.ai_action_drafts
  add constraint ai_drafts_review_metadata check (
    (
      status = 'pending_review'
      and reviewed_by is null
      and reviewed_at is null
      and review_notes is null
    )
    or (
      status in ('accepted', 'rejected')
      and reviewed_by is not null
      and reviewed_at is not null
      and review_notes is not null
      and char_length(btrim(review_notes)) between 10 and 2000
    )
  ) not valid;

-- A clean database validates the constraint immediately. An upgraded database
-- may contain terminal rows created under the legacy contract without review
-- notes. Preserve those rows for an administrator audit while PostgreSQL still
-- enforces this NOT VALID constraint for every new insert or update.
do $$
begin
  begin
    alter table public.ai_action_drafts
      validate constraint ai_drafts_review_metadata;
  exception
    when check_violation then null;
  end;
end
$$;

drop index if exists public.ai_action_drafts_one_pending_idx;
create unique index ai_action_drafts_one_pending_idx
  on public.ai_action_drafts (commune_id, period_id, kind) nulls not distinct
  where status = 'pending_review';

create or replace function public.enforce_ai_action_draft_integrity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_review'
       or new.reviewed_by is not null
       or new.reviewed_at is not null
       or new.review_notes is not null then
      raise exception 'decision draft must start pending and unreviewed'
        using errcode = '23514';
    end if;
    if actor is not null then
      if public.profile_role() is distinct from 'admin_xa'
         or not coalesce(public.profile_can_mutate(), false)
         or new.created_by is distinct from actor then
        raise exception 'decision draft creator must be the active commune administrator'
          using errcode = '42501';
      end if;
    elsif current_user::text in ('anon', 'authenticated', 'service_role') then
      raise exception 'decision draft creation requires an authenticated actor'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.commune_id is distinct from old.commune_id
     or new.period_id is distinct from old.period_id
     or new.village_id is distinct from old.village_id
     or new.kind is distinct from old.kind
     or new.content is distinct from old.content
     or new.citations is distinct from old.citations
     or new.confidence is distinct from old.confidence
     or new.model_provider is distinct from old.model_provider
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'decision draft evidence and provenance are immutable'
      using errcode = '23514';
  end if;
  if old.status <> 'pending_review'
     or new.status not in ('accepted', 'rejected') then
    raise exception 'decision draft may only transition once from pending review'
      using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(new.review_notes, ''))) not between 10 and 2000 then
    raise exception 'decision draft review notes must contain 10 to 2000 characters'
      using errcode = '23514';
  end if;
  if actor is not null then
    if public.profile_role() is distinct from 'admin_xa'
       or not coalesce(public.profile_can_mutate(), false) then
      raise exception 'decision draft review requires an active commune administrator'
        using errcode = '42501';
    end if;
    new.reviewed_by := actor;
  elsif current_user::text in ('anon', 'authenticated', 'service_role') then
    raise exception 'decision draft review requires an authenticated actor'
      using errcode = '42501';
  elsif new.reviewed_by is null then
    raise exception 'trusted maintenance review must identify its reviewer'
      using errcode = '23514';
  end if;
  new.review_notes := btrim(new.review_notes);
  new.reviewed_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists ai_drafts_integrity on public.ai_action_drafts;
create trigger ai_drafts_integrity
before insert or update on public.ai_action_drafts
for each row execute function public.enforce_ai_action_draft_integrity();
revoke all on function public.enforce_ai_action_draft_integrity()
  from public, anon, authenticated, service_role;

drop policy if exists ai_drafts_select_internal on public.ai_action_drafts;
create policy ai_drafts_select_internal
on public.ai_action_drafts for select to authenticated
using (
  (
    public.profile_role() = 'admin_xa'
    or (
      public.profile_role() = 'lanh_dao'
      and status = 'accepted'
      and reviewed_by is not null
      and reviewed_at is not null
      and review_notes is not null
      and char_length(btrim(review_notes)) between 10 and 2000
    )
  )
  and commune_id = public.profile_commune_id()
);

drop policy if exists ai_drafts_insert_internal on public.ai_action_drafts;
drop policy if exists ai_drafts_insert_admin on public.ai_action_drafts;
create policy ai_drafts_insert_admin
on public.ai_action_drafts for insert to authenticated
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
  and status = 'pending_review'
  and created_by = auth.uid()
  and reviewed_by is null
  and reviewed_at is null
  and review_notes is null
);

drop policy if exists ai_drafts_update_admin on public.ai_action_drafts;
create policy ai_drafts_update_admin
on public.ai_action_drafts for update to authenticated
using (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
  and status = 'pending_review'
)
with check (
  public.profile_role() = 'admin_xa'
  and public.profile_can_mutate()
  and commune_id = public.profile_commune_id()
  and status in ('accepted', 'rejected')
  and reviewed_by = auth.uid()
  and reviewed_at is not null
  and review_notes is not null
  and char_length(btrim(review_notes)) between 10 and 2000
);

commit;
