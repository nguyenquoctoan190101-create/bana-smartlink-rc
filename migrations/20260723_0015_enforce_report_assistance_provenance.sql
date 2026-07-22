-- Report assistance provenance is derived from the authenticated CNSCD profile.
-- Client-provided names are never trusted, and an existing attribution cannot be
-- erased or replaced by a later editor.
begin;

create or replace function public.enforce_report_assistance_provenance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role public.user_role;
  actor_name text;
begin
  if tg_op = 'UPDATE' and old.assisted_by_cnscd then
    new.assisted_by_cnscd := true;
    new.assisted_member_name := old.assisted_member_name;
    return new;
  end if;

  if not new.assisted_by_cnscd then
    new.assisted_member_name := null;
    return new;
  end if;

  select profile.role, nullif(btrim(profile.display_name), '')
  into actor_role, actor_name
  from public.user_profiles as profile
  where profile.id = auth.uid()
    and profile.is_active = true;

  if actor_role is distinct from 'to_cnscd'::public.user_role then
    raise exception 'only an active to_cnscd profile may record report assistance'
      using errcode = '42501';
  end if;
  if actor_name is null then
    raise exception 'the assisting CNSCD profile requires a display name'
      using errcode = '23514';
  end if;

  new.assisted_member_name := actor_name;
  return new;
end
$$;

drop trigger if exists reports_assistance_provenance on public.reports;
create trigger reports_assistance_provenance
before insert or update of assisted_by_cnscd, assisted_member_name
on public.reports
for each row execute function public.enforce_report_assistance_provenance();

revoke all on function public.enforce_report_assistance_provenance()
  from public, anon, authenticated, service_role;

commit;
