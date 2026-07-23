-- Persist admin-approved Excel column mappings instead of mutating a release file.
begin;

create table if not exists public.field_synonyms (
  id uuid primary key default gen_random_uuid(),
  commune_id text not null,
  normalized_name text not null,
  original_name text not null,
  ct_code text not null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_synonyms_name_length check (
    length(btrim(normalized_name)) between 1 and 240
    and length(btrim(original_name)) between 1 and 240
  ),
  constraint field_synonyms_ct_code check (
    ct_code ~ '^CT(0[1-9]|1[0-4])$'
  ),
  constraint field_synonyms_commune_name_unique unique (commune_id, normalized_name)
);

create index if not exists field_synonyms_commune_code_idx
  on public.field_synonyms (commune_id, ct_code);

drop trigger if exists field_synonyms_set_updated_at on public.field_synonyms;
create trigger field_synonyms_set_updated_at
before update on public.field_synonyms
for each row execute function public.set_updated_at();

alter table public.field_synonyms enable row level security;
revoke all on table public.field_synonyms from anon;
grant select, insert, update, delete on table public.field_synonyms to authenticated;

drop policy if exists field_synonyms_select_scoped on public.field_synonyms;
create policy field_synonyms_select_scoped
on public.field_synonyms for select to authenticated
using (commune_id = public.profile_commune_id());

drop policy if exists field_synonyms_manage_admin on public.field_synonyms;
create policy field_synonyms_manage_admin
on public.field_synonyms for all to authenticated
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

create or replace function public.confirm_field_synonym(
  p_original_name text,
  p_normalized_name text,
  p_ct_code text
)
returns setof public.field_synonyms
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_commune_id text;
begin
  if public.profile_role() <> 'admin_xa' or not public.profile_can_mutate() then
    raise exception 'Only an active admin_xa can confirm field mappings'
      using errcode = '42501';
  end if;
  if p_original_name is null
     or length(btrim(p_original_name)) not between 1 and 240
     or p_normalized_name is null
     or length(btrim(p_normalized_name)) not between 1 and 240
     or p_ct_code is null
     or upper(btrim(p_ct_code)) !~ '^CT(0[1-9]|1[0-4])$' then
    raise exception 'Invalid field mapping'
      using errcode = '22023';
  end if;

  target_commune_id := public.profile_commune_id();
  if target_commune_id is null then
    raise exception 'The caller has no commune scope'
      using errcode = '42501';
  end if;

  return query
  insert into public.field_synonyms as mapping (
    commune_id,
    normalized_name,
    original_name,
    ct_code,
    created_by
  )
  values (
    target_commune_id,
    lower(btrim(p_normalized_name)),
    btrim(p_original_name),
    upper(btrim(p_ct_code)),
    auth.uid()
  )
  on conflict (commune_id, normalized_name) do update
  set original_name = excluded.original_name,
      ct_code = excluded.ct_code,
      created_by = auth.uid(),
      updated_at = now()
  returning mapping.*;
end
$$;

revoke all on function public.confirm_field_synonym(text, text, text) from public;
grant execute on function public.confirm_field_synonym(text, text, text) to authenticated;

drop trigger if exists field_synonyms_audit on public.field_synonyms;
create trigger field_synonyms_audit
after insert or update or delete on public.field_synonyms
for each row execute function public.audit_operations_change();

commit;
