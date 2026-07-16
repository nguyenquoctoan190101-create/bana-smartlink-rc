\set ON_ERROR_STOP on

-- Reproduce direct grants found on an upgraded Supabase project. CREATE OR
-- REPLACE preserves these ACLs, so migrations must revoke the named API roles
-- rather than relying only on revoking PUBLIC.
grant execute on function public.commit_report_import_batch(uuid)
  to anon, authenticated, service_role;
grant execute on function public.report_indicator_values_are_valid(uuid)
  to anon, authenticated, service_role;
grant execute on function public.guard_report_import_file_mutation()
  to anon, authenticated, service_role;
grant execute on function public.enforce_submitted_report_values()
  to anon, authenticated, service_role;
