-- Supabase snapshots can retain direct EXECUTE grants to API roles even after
-- PUBLIC is revoked. Remove both inherited and direct grants explicitly.
begin;

revoke all on function public.commit_report_import_batch(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_report_import_batch(uuid) to authenticated;

revoke all on function public.guard_report_import_file_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.report_indicator_values_are_valid(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_submitted_report_values()
  from public, anon, authenticated, service_role;

commit;
