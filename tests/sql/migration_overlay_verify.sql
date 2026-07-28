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

do $$
declare
  channel_constraint text;
  scope_definition text;
  indicator_definition text;
  delete_definition text;
begin
  if to_regprocedure(
    'public.save_report_submission_with_extraction(uuid,uuid,uuid,public.report_source,jsonb,jsonb,integer,uuid,boolean,boolean,text,jsonb,jsonb,uuid)'
  ) is null then
    raise exception 'atomic extraction submission RPC is missing';
  end if;

  if has_function_privilege(
       'anon',
       'public.save_report_submission_with_extraction(uuid,uuid,uuid,public.report_source,jsonb,jsonb,integer,uuid,boolean,boolean,text,jsonb,jsonb,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_report_submission_with_extraction(uuid,uuid,uuid,public.report_source,jsonb,jsonb,integer,uuid,boolean,boolean,text,jsonb,jsonb,uuid)',
       'execute'
     ) then
    raise exception 'atomic extraction submission RPC privileges are invalid';
  end if;

  if to_regclass('public.report_extraction_evidence') is null
     or has_table_privilege(
       'authenticated',
       'public.report_extraction_evidence',
       'select'
     )
     or has_table_privilege(
       'authenticated',
       'public.report_extraction_evidence',
       'insert'
     )
     or not has_table_privilege(
       'service_role',
       'public.report_extraction_evidence',
       'insert'
     ) then
    raise exception 'extraction evidence table privileges are invalid';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.save_report_submission(uuid,uuid,uuid,public.report_source,jsonb,jsonb,integer,uuid,boolean,boolean,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.jsonb_object_length(jsonb)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.record_report_extraction_review(uuid,uuid,public.report_source,jsonb,jsonb)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_manual_report_submission(uuid,uuid,uuid,public.report_source,jsonb,jsonb,integer,uuid,boolean,boolean,text)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.transition_report_workflow(uuid,integer,text)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.delete_report_submission(uuid,integer)',
       'execute'
     ) then
    raise exception 'canonical report RPC privileges are invalid';
  end if;

  if public.jsonb_object_length(
       '{"CT01":1,"CT02":2,"CT03":3}'::jsonb
     ) <> 3 then
    raise exception 'upgraded JSON object compatibility helper is invalid';
  end if;
  if has_function_privilege(
       'anon',
       'public.jsonb_object_length(jsonb)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.jsonb_object_length(jsonb)',
       'execute'
     ) then
    raise exception 'JSON object compatibility helper is externally executable';
  end if;

  if has_table_privilege('authenticated', 'public.reports', 'insert')
     or has_table_privilege('authenticated', 'public.reports', 'update')
     or has_table_privilege('authenticated', 'public.reports', 'delete')
     or has_table_privilege('authenticated', 'public.report_values', 'insert')
     or has_table_privilege('authenticated', 'public.report_values', 'update')
     or has_table_privilege('authenticated', 'public.report_values', 'delete')
     or has_table_privilege(
       'authenticated',
       'public.report_submission_receipts',
       'insert'
     ) then
    raise exception 'authenticated role retains direct report mutation grants';
  end if;

  select pg_get_functiondef(
    'public.report_submission_scope_is_valid(uuid,uuid)'::regprocedure
  )
  into scope_definition;
  select pg_get_functiondef(
    'public.report_indicator_values_are_valid(uuid)'::regprocedure
  )
  into indicator_definition;
  select pg_get_functiondef(
    'public.delete_report_submission(uuid,integer)'::regprocedure
  )
  into delete_definition;

  if scope_definition is null
     or position('village.is_active' in scope_definition) = 0
     or position('assignment.period_id = period.id' in scope_definition) = 0
     or position('assignment.village_id = village.id' in scope_definition) = 0 then
    raise exception 'report submission scope omits active-village or period-assignment checks';
  end if;
  if indicator_definition is null
     or position('ct14 <= ct01' in indicator_definition) = 0 then
    raise exception 'database indicator validation omits the CT14/CT01 invariant';
  end if;
  if delete_definition is null
     or position('target.workflow_status = ''locked''' in delete_definition) = 0
     or position('target.publication_status = ''published''' in delete_definition) = 0 then
    raise exception 'report deletion can remove an immutable workflow state';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.report_submission_scope_is_valid(uuid,uuid)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'report submission scope helper is not hardened';
  end if;

  select pg_get_constraintdef(oid)
  into channel_constraint
  from pg_constraint
  where conrelid = 'public.alert_deliveries'::regclass
    and conname = 'alert_deliveries_channel_check';
  if channel_constraint is null
     or channel_constraint !~ '''in_app'''
     or channel_constraint !~ '''web_push'''
     or channel_constraint !~ '''sms'''
     or channel_constraint ~ concat('''za', 'lo''') then
    raise exception 'alert delivery channels are not release compliant';
  end if;
end
$$;

do $$
declare
  audit_policy text;
  pending_policy text;
  action_policy text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_log'
      and column_name = 'commune_id'
  ) then
    raise exception 'audit log commune scope is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.audit_log'::regclass
      and tgname = 'audit_log_assign_commune'
      and not tgisinternal
  ) then
    raise exception 'audit log commune trigger is missing';
  end if;

  select qual into audit_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'audit_log'
    and policyname = 'audit_log_select_admin';
  if audit_policy is null
     or position('profile_commune_id' in audit_policy) = 0
     or position('commune_id' in audit_policy) = 0 then
    raise exception 'audit log policy is not commune scoped';
  end if;

  select qual into pending_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'pending_updates'
    and policyname = 'pending_updates_select_scoped';
  if pending_policy is null
     or position('can_select_report' in pending_policy) = 0 then
    raise exception 'pending update policy bypasses report scope';
  end if;

  select qual into action_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'action_items'
    and policyname = 'action_items_select_scoped';
  if action_policy is null
     or position('profile_commune_id' in action_policy) = 0
     or position('commune_id' in action_policy) = 0 then
    raise exception 'operations action policy is not commune scoped';
  end if;
end
$$;

do $$
declare
  select_qual text;
  insert_check text;
  update_using text;
  update_check text;
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.ai_action_drafts'::regclass
      and tgname = 'ai_drafts_integrity'
      and not tgisinternal
  ) then
    raise exception 'decision draft integrity trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_index
    where indexrelid = 'public.ai_action_drafts_one_pending_idx'::regclass
      and indisunique
      and indnullsnotdistinct
      and indpred is not null
  ) then
    raise exception 'pending decision draft uniqueness guard is incomplete';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_action_drafts'::regclass
      and conname = 'ai_drafts_review_metadata'
      and convalidated
  ) then
    raise exception 'decision draft review metadata constraint is not validated';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.enforce_ai_action_draft_integrity()'::regprocedure
      and not prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  )
     or has_function_privilege(
       'authenticated',
       'public.enforce_ai_action_draft_integrity()',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.enforce_ai_action_draft_integrity()',
       'execute'
     ) then
    raise exception 'decision draft trigger function privileges are unsafe';
  end if;

  select qual into select_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ai_action_drafts'
    and policyname = 'ai_drafts_select_internal';
  select with_check into insert_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ai_action_drafts'
    and policyname = 'ai_drafts_insert_admin';
  select qual, with_check into update_using, update_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ai_action_drafts'
    and policyname = 'ai_drafts_update_admin';

  if select_qual is null
     or position('admin_xa' in select_qual) = 0
     or position('lanh_dao' in select_qual) = 0
     or position('accepted' in select_qual) = 0
     or position('reviewed_by' in select_qual) = 0
     or position('reviewed_at' in select_qual) = 0
     or position('review_notes' in select_qual) = 0
     or position('char_length' in select_qual) = 0
     or position('profile_commune_id' in select_qual) = 0
     or insert_check is null
     or position('admin_xa' in insert_check) = 0
     or position('created_by' in insert_check) = 0
     or position('auth.uid()' in insert_check) = 0
     or position('pending_review' in insert_check) = 0
     or update_using is null
     or position('pending_review' in update_using) = 0
     or update_check is null
     or position('accepted' in update_check) = 0
     or position('rejected' in update_check) = 0
     or position('reviewed_by' in update_check) = 0
     or position('auth.uid()' in update_check) = 0 then
    raise exception 'decision draft write policies are incomplete';
  end if;
end
$$;

do $$
declare
  function_definition text;
  foreign_village_id constant uuid := '90000000-0000-4000-8000-000000000024';
begin
  select pg_get_functiondef(
    'public.create_citizen_case(text,uuid,text,text,text,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,boolean,boolean)'::regprocedure
  )
  into function_definition;

  if function_definition is null
     or position('village.id = p_village_id' in function_definition) = 0
     or position('village.commune_id = p_commune_id' in function_definition) = 0
     or position('village_not_in_commune' in function_definition) = 0
     or position(
       'p_privacy_consent is distinct from true'
       in lower(function_definition)
     ) = 0
     or position('consent_required' in function_definition) = 0 then
    raise exception 'public case RPC lacks the hardened village/commune invariant';
  end if;
  if to_regprocedure(
       'public.create_citizen_case(text,uuid,text,text,text,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,boolean)'
     ) is not null then
    raise exception 'legacy case RPC overload can bypass explicit privacy consent';
  end if;
  if not exists (
    select 1
    from pg_proc
    where oid = 'public.create_citizen_case(text,uuid,text,text,text,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,boolean,boolean)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'public case RPC security semantics changed unexpectedly';
  end if;

  if has_function_privilege(
       'anon',
       'public.create_citizen_case(text,uuid,text,text,text,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,boolean,boolean)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.create_citizen_case(text,uuid,text,text,text,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,boolean,boolean)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.create_citizen_case(text,uuid,text,text,text,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,boolean,boolean)',
       'execute'
     ) then
    raise exception 'public case RPC privileges changed unexpectedly';
  end if;

  insert into public.villages (id, commune_id, name)
  values (foreign_village_id, 'commune_other', 'Cross-commune RPC guard fixture');

  begin
    perform *
    from public.create_citizen_case(
      'ba_na',
      foreign_village_id,
      'road',
      'Cross-commune field report must be rejected.',
      'critical',
      null,
      null,
      null,
      'scope-test',
      now(),
      repeat('9', 64),
      null,
      null,
      null,
      null,
      false,
      true
    );
    raise exception 'public case RPC accepted a village from another commune';
  exception
    when check_violation then
      if sqlerrm <> 'village_not_in_commune' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.citizen_cases
    where tracking_code_hash = repeat('9', 64)
  ) then
    raise exception 'rejected cross-commune case left persisted data';
  end if;

  begin
    perform *
    from public.create_citizen_case(
      'ba_na',
      null,
      'road',
      'A field report without explicit consent must be rejected.',
      'normal',
      null,
      null,
      null,
      'scope-test',
      now(),
      repeat('8', 64),
      null,
      null,
      null,
      null,
      false,
      false
    );
    raise exception 'public case RPC accepted false privacy consent';
  exception
    when check_violation then
      if sqlerrm <> 'consent_required' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.citizen_cases
    where tracking_code_hash = repeat('8', 64)
  ) then
    raise exception 'rejected non-consensual case left persisted data';
  end if;

  delete from public.villages where id = foreign_village_id;
end
$$;

do $$
declare
  assignment_definition text;
  evacuation_policy record;
  village_policy record;
  merge_policy record;
begin
  select pg_get_functiondef(
    'public.assign_citizen_case(uuid,text,uuid)'::regprocedure
  )
  into assignment_definition;

  if assignment_definition is null
     or position('assignee.id = p_assignee_id' in assignment_definition) = 0
     or position('assignee.commune_id = target_case.commune_id' in assignment_definition) = 0
     or position('assignee_not_in_commune' in assignment_definition) = 0 then
    raise exception 'case assignment RPC lacks the assignee tenant invariant';
  end if;
  if not exists (
    select 1
    from pg_proc
    where oid = 'public.assign_citizen_case(uuid,text,uuid)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'case assignment RPC security semantics changed unexpectedly';
  end if;
  if has_function_privilege(
       'anon',
       'public.assign_citizen_case(uuid,text,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.assign_citizen_case(uuid,text,uuid)',
       'execute'
     ) then
    raise exception 'case assignment RPC privileges changed unexpectedly';
  end if;

  if has_table_privilege('anon', 'public.evacuation_points', 'select')
     or has_table_privilege('anon', 'public.villages', 'select')
     or has_table_privilege('anon', 'public.village_merge_map', 'select') then
    raise exception 'anonymous role can enumerate protected base tables';
  end if;
  if not has_table_privilege('service_role', 'public.evacuation_points', 'select')
     or not has_table_privilege('service_role', 'public.villages', 'select')
     or not has_table_privilege('service_role', 'public.village_merge_map', 'select') then
    raise exception 'backend service role lost required base-table reads';
  end if;

  select roles, qual
  into evacuation_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'evacuation_points'
    and policyname = 'evacuation_points_select';
  if evacuation_policy.roles is distinct from array['authenticated']::name[]
     or evacuation_policy.qual is null
     or position('can_select_village' in evacuation_policy.qual) = 0
     or position('is_verified' in evacuation_policy.qual) > 0 then
    raise exception 'evacuation point direct-read policy is not tenant scoped';
  end if;

  select roles, qual
  into village_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'villages'
    and policyname = 'villages_select_active';
  if village_policy.roles is distinct from array['authenticated']::name[]
     or village_policy.qual is null
     or position('can_select_village' in village_policy.qual) = 0 then
    raise exception 'village direct-read policy is not tenant scoped';
  end if;

  select roles, qual
  into merge_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'village_merge_map'
    and policyname = 'village_merge_map_select';
  if merge_policy.roles is distinct from array['authenticated']::name[]
     or merge_policy.qual is null
     or position('can_select_village' in merge_policy.qual) = 0 then
    raise exception 'village merge direct-read policy is not tenant scoped';
  end if;
end
$$;
