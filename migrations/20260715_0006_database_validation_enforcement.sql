-- Database-level deterministic validation for every workflow transition.
begin;

create or replace function public.report_indicator_values_are_valid(target_report_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  with values_by_code as (
    select
      count(*) filter (where value is not null) as populated_count,
      max(value) filter (where ct_code = 'CT01') as ct01,
      max(value) filter (where ct_code = 'CT02') as ct02,
      max(value) filter (where ct_code = 'CT03') as ct03,
      max(value) filter (where ct_code = 'CT04') as ct04,
      max(value) filter (where ct_code = 'CT07') as ct07,
      max(value) filter (where ct_code = 'CT08') as ct08,
      max(value) filter (where ct_code = 'CT09') as ct09,
      max(value) filter (where ct_code = 'CT10') as ct10,
      max(value) filter (where ct_code = 'CT11') as ct11
    from public.report_values
    where report_id = target_report_id
  )
  select
    populated_count = 14
    and ct01 is not null and ct02 is not null and ct03 is not null and ct04 is not null
    and ct07 is not null and ct08 is not null and ct09 is not null and ct10 is not null and ct11 is not null
    and ct03 <= ct01
    and ct03 + ct04 <= ct01
    and ct07 <= ct02
    and ct08 <= ct07
    and ct09 <= ct01
    and ct10 <= ct02
    and ct11 <= ct02
  from values_by_code
$$;

create or replace function public.enforce_submitted_report_values()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.workflow_status in ('submitted', 'approved', 'locked')
     and not public.report_indicator_values_are_valid(new.id) then
    raise exception 'submitted report values violate deterministic rules' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists reports_enforce_indicator_values on public.reports;
create trigger reports_enforce_indicator_values
before insert or update on public.reports
for each row execute function public.enforce_submitted_report_values();

revoke all on function public.report_indicator_values_are_valid(uuid) from public, anon, authenticated, service_role;
revoke all on function public.enforce_submitted_report_values() from public, anon, authenticated, service_role;

commit;
