\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.report_import_batches') is null
     or to_regclass('public.report_import_files') is null
     or to_regclass('public.report_import_resolutions') is null
     or to_regclass('public.report_import_lineage') is null then
    raise exception 'legacy import tables are incomplete';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'report_periods'
      and column_name = 'template_sha256'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'report_periods'
      and column_name = 'template_size_bytes'
  ) then
    raise exception 'report template integrity metadata is incomplete';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.reports'::regclass
      and tgname = 'reports_enforce_indicator_values'
      and not tgisinternal
  ) then
    raise exception 'database indicator validation trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.reports'::regclass
      and tgname = 'reports_assistance_provenance'
      and not tgisinternal
  ) then
    raise exception 'report assistance provenance trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.report_import_files'::regclass
      and tgname = 'report_import_files_guard'
      and not tgisinternal
  ) then
    raise exception 'import evidence immutability trigger is missing';
  end if;

  if public.report_indicator_values_are_valid(gen_random_uuid()) is distinct from false then
    raise exception 'a report without 14 values must be invalid';
  end if;

  if has_function_privilege('anon', 'public.commit_report_import_batch(uuid)', 'execute')
     or has_function_privilege('anon', 'public.report_indicator_values_are_valid(uuid)', 'execute')
     or has_function_privilege('anon', 'public.guard_report_import_file_mutation()', 'execute')
     or has_function_privilege('anon', 'public.enforce_submitted_report_values()', 'execute')
     or has_function_privilege('anon', 'public.enforce_report_assistance_provenance()', 'execute') then
    raise exception 'anonymous role can execute protected import/validation helpers';
  end if;

  if not has_function_privilege('authenticated', 'public.commit_report_import_batch(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.report_indicator_values_are_valid(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.guard_report_import_file_mutation()', 'execute')
     or has_function_privilege('authenticated', 'public.enforce_submitted_report_values()', 'execute')
     or has_function_privilege('authenticated', 'public.enforce_report_assistance_provenance()', 'execute') then
    raise exception 'authenticated role has an invalid import/helper privilege set';
  end if;

  if has_function_privilege('service_role', 'public.commit_report_import_batch(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.report_indicator_values_are_valid(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.guard_report_import_file_mutation()', 'execute')
     or has_function_privilege('service_role', 'public.enforce_submitted_report_values()', 'execute')
     or has_function_privilege('service_role', 'public.enforce_report_assistance_provenance()', 'execute') then
    raise exception 'service role retains direct execute on protected import/validation helpers';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.enforce_submitted_report_values()'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'submitted report trigger must validate as a hardened security definer';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.enforce_report_assistance_provenance()'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'report assistance trigger must be a hardened security definer';
  end if;

  if has_table_privilege('authenticated', 'public.report_import_lineage', 'insert') then
    raise exception 'authenticated callers can forge import lineage directly';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'villages_legacy'
      and column_name = 'proposed_dissolved_into_village_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'report_import_files'
      and column_name = 'review_reason'
  ) then
    raise exception 'partial-import safety metadata is incomplete';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'report_import_files'
      and policyname = 'report_import_files_select_internal'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'admin-scoped import file policy is missing';
  end if;
end
$$;
