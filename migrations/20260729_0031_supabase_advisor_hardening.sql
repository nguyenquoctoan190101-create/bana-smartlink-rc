-- Close the remaining Supabase database-advisor findings without weakening
-- application RLS. The migration ledger is internal-only, SECURITY DEFINER
-- functions are never executable by anonymous callers, auth.uid() is cached
-- once per statement, and overlapping ALL/SELECT policies are separated into
-- their mutation-specific commands.

begin;

create table if not exists public.schema_migrations (
  name text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on table public.schema_migrations from public, anon, authenticated,
  service_role;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default. Supabase
-- snapshots may additionally retain a direct anon grant, so remove both from
-- every SECURITY DEFINER function in the exposed public schema.
do $function_acl$
declare
  target_function record;
begin
  for target_function in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon',
      target_function.schema_name,
      target_function.function_name,
      target_function.identity_arguments
    );
  end loop;
end
$function_acl$;

-- Trigger functions are invoked by PostgreSQL, never as PostgREST RPCs.
revoke all on function public.audit_operations_change()
  from authenticated, service_role;
revoke all on function public.citizen_case_audit_status()
  from authenticated, service_role;

-- These helpers/RPCs are intentionally callable by signed-in staff because
-- RLS and atomic workflows depend on the caller JWT. Reassert only that exact
-- role after removing stale anonymous grants.
grant execute on function public.profile_role() to authenticated;
grant execute on function public.profile_village_id() to authenticated;
grant execute on function public.profile_commune_id() to authenticated;
grant execute on function public.profile_can_mutate() to authenticated;
grant execute on function public.can_select_village(uuid) to authenticated;
grant execute on function public.can_modify_village(uuid) to authenticated;
grant execute on function public.can_administer_village(uuid) to authenticated;
grant execute on function public.can_select_report(uuid) to authenticated;
grant execute on function public.can_modify_report(uuid) to authenticated;
grant execute on function public.create_report_period(
  text, timestamptz, uuid[], text
) to authenticated;

-- Supabase's auth_rls_initplan advisor requires auth.uid() to be evaluated as
-- a scalar subquery. Recreate the exact known policies from catalog metadata,
-- preserving roles, commands, permissiveness, USING and WITH CHECK semantics.
do $auth_initplan$
declare
  target_policy record;
  target_count integer;
  role_list text;
  create_statement text;
  target_names constant text[] := array[
    'action_items_select_scoped',
    'action_items_update_scoped',
    'ai_drafts_insert_admin',
    'ai_drafts_update_admin',
    'notifications_delete_own',
    'notifications_select_own',
    'notifications_update_own',
    'push_subscriptions_own',
    'submission_receipts_insert_own',
    'submission_receipts_select_own',
    'profiles_select_self_admin_leader',
    'assignments_select_scoped'
  ];
begin
  select count(*)
  into target_count
  from pg_policies
  where schemaname = 'public'
    and policyname = any(target_names);

  if target_count <> cardinality(target_names) then
    raise exception
      'auth.uid policy set drifted: expected %, found %',
      cardinality(target_names),
      target_count;
  end if;

  for target_policy in
    select *
    from pg_policies
    where schemaname = 'public'
      and policyname = any(target_names)
    order by tablename, policyname
  loop
    select string_agg(quote_ident(role_name::text), ', ' order by role_name::text)
    into role_list
    from unnest(target_policy.roles) as role_name;

    execute format(
      'drop policy %I on %I.%I',
      target_policy.policyname,
      target_policy.schemaname,
      target_policy.tablename
    );

    create_statement := format(
      'create policy %I on %I.%I as %s for %s to %s',
      target_policy.policyname,
      target_policy.schemaname,
      target_policy.tablename,
      target_policy.permissive,
      target_policy.cmd,
      role_list
    );
    if target_policy.qual is not null then
      create_statement := create_statement || format(
        ' using (%s)',
        replace(target_policy.qual, 'auth.uid()', '(select auth.uid())')
      );
    end if;
    if target_policy.with_check is not null then
      create_statement := create_statement || format(
        ' with check (%s)',
        replace(target_policy.with_check, 'auth.uid()', '(select auth.uid())')
      );
    end if;
    execute create_statement;
  end loop;
end
$auth_initplan$;

-- An ALL policy also participates in SELECT, so pairing it with a dedicated
-- SELECT policy makes PostgreSQL evaluate two permissive predicates. Preserve
-- the original mutation predicates while splitting ALL into explicit commands.
do $split_mutation_policies$
declare
  target_policy record;
  target_count integer;
  role_list text;
  target_names constant text[] := array[
    'assignments_write_admin',
    'case_assignments_mutate_admin',
    'support_points_mutate_admin',
    'champions_mutate_admin',
    'maturity_mutate_admin',
    'field_synonyms_manage_admin',
    'initiatives_mutate_admin',
    'knowledge_mutate_admin',
    'report_import_batches_mutate_admin',
    'report_import_files_mutate_admin',
    'report_import_resolutions_mutate_admin',
    'routing_rules_mutate_admin',
    'scenario_assumptions_mutate_admin',
    'scenarios_mutate_admin'
  ];
begin
  select count(*)
  into target_count
  from pg_policies
  where schemaname = 'public'
    and policyname = any(target_names)
    and cmd = 'ALL'
    and permissive = 'PERMISSIVE';

  if target_count <> cardinality(target_names) then
    raise exception
      'overlapping mutation policy set drifted: expected %, found %',
      cardinality(target_names),
      target_count;
  end if;

  for target_policy in
    select *
    from pg_policies
    where schemaname = 'public'
      and policyname = any(target_names)
      and cmd = 'ALL'
      and permissive = 'PERMISSIVE'
    order by tablename, policyname
  loop
    if target_policy.qual is null or target_policy.with_check is null then
      raise exception
        'mutation policy %.% must define USING and WITH CHECK',
        target_policy.tablename,
        target_policy.policyname;
    end if;

    select string_agg(quote_ident(role_name::text), ', ' order by role_name::text)
    into role_list
    from unnest(target_policy.roles) as role_name;

    execute format(
      'drop policy %I on %I.%I',
      target_policy.policyname,
      target_policy.schemaname,
      target_policy.tablename
    );
    execute format(
      'create policy %I on %I.%I for insert to %s with check (%s)',
      target_policy.policyname || '_insert',
      target_policy.schemaname,
      target_policy.tablename,
      role_list,
      target_policy.with_check
    );
    execute format(
      'create policy %I on %I.%I for update to %s using (%s) with check (%s)',
      target_policy.policyname || '_update',
      target_policy.schemaname,
      target_policy.tablename,
      role_list,
      target_policy.qual,
      target_policy.with_check
    );
    execute format(
      'create policy %I on %I.%I for delete to %s using (%s)',
      target_policy.policyname || '_delete',
      target_policy.schemaname,
      target_policy.tablename,
      role_list,
      target_policy.qual
    );
  end loop;
end
$split_mutation_policies$;

-- Fail the deployment instead of accepting a partial advisor cleanup.
do $verify_advisor_hardening$
begin
  if not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'schema_migrations'
      and relation.relrowsecurity
  ) then
    raise exception 'schema_migrations RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.schema_migrations', 'select')
     or has_table_privilege(
       'authenticated', 'public.schema_migrations', 'select'
     )
     or has_table_privilege(
       'service_role', 'public.schema_migrations', 'select'
     ) then
    raise exception 'an API role can read the migration ledger';
  end if;

  if exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and has_function_privilege('anon', procedure.oid, 'execute')
  ) then
    raise exception 'anonymous role can execute a public SECURITY DEFINER';
  end if;

  if has_function_privilege(
       'authenticated', 'public.audit_operations_change()', 'execute'
     )
     or has_function_privilege(
       'authenticated', 'public.citizen_case_audit_status()', 'execute'
     )
     or has_function_privilege(
       'service_role', 'public.audit_operations_change()', 'execute'
     )
     or has_function_privilege(
       'service_role', 'public.citizen_case_audit_status()', 'execute'
     ) then
    raise exception 'a trigger-only function remains directly executable';
  end if;

  if exists (
    with expanded as (
      select
        policy.tablename,
        role_name,
        action_name
      from pg_policies as policy
      cross join lateral unnest(policy.roles) as role_name
      cross join lateral unnest(
        case
          when policy.cmd = 'ALL'
            then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
          else array[policy.cmd]::text[]
        end
      ) as action_name
      where policy.schemaname = 'public'
        and policy.permissive = 'PERMISSIVE'
    )
    select 1
    from expanded
    group by tablename, role_name, action_name
    having count(*) > 1
  ) then
    raise exception 'overlapping permissive policies remain';
  end if;

  if exists (
    select 1
    from pg_policies as policy
    cross join lateral (
      select
        coalesce(policy.qual, '') || ' ' ||
        coalesce(policy.with_check, '') as expression
    ) as policy_expression
    where policy.schemaname = 'public'
      and policy_expression.expression like '%auth.uid()%'
      and regexp_count(
        policy_expression.expression,
        'auth\.uid\(\)'
      ) <> regexp_count(
        policy_expression.expression,
        'SELECT auth\.uid\(\)'
      )
  ) then
    raise exception 'an auth.uid policy still lacks an initplan subquery';
  end if;
end
$verify_advisor_hardening$;

commit;
