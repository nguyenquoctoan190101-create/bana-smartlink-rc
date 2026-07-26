-- Versioned, fail-closed import of 22 legacy-village workbooks into the
-- 10-village reporting model. Apply after 0003.
begin;

alter table public.village_merge_map alter column new_village_id drop not null;
alter table public.village_merge_map add column if not exists mapping_version text not null default 'unversioned';
alter table public.village_merge_map add column if not exists proposed_new_village_id uuid references public.villages(id) on update cascade on delete restrict;
update public.village_merge_map map
set proposed_new_village_id = target.id
from public.villages target
where map.mapping_status = 'pending_official_decision'
  and map.old_village_name = 'Thôn Đông Sơn'
  and target.name = 'Thôn Hòa Ninh'
  and map.proposed_new_village_id is null;
alter table public.village_merge_map drop constraint if exists village_merge_map_target_check;
alter table public.village_merge_map add constraint village_merge_map_target_check check (
  (mapping_status = 'confirmed' and new_village_id is not null and proposed_new_village_id is null)
  or (mapping_status = 'pending_official_decision' and new_village_id is null and proposed_new_village_id is not null)
);

alter table public.villages_legacy add column if not exists mapping_version text not null default 'unversioned';
alter table public.villages_legacy add column if not exists legacy_unit_type text not null default 'village';
alter table public.villages_legacy add column if not exists proposed_dissolved_into_village_id uuid references public.villages(id) on update cascade on delete set null;
update public.villages_legacy legacy
set proposed_dissolved_into_village_id = target.id
from public.villages target
where legacy.mapping_status = 'pending_official_decision'
  and legacy.old_name = 'Thôn Đông Sơn'
  and target.name = 'Thôn Hòa Ninh'
  and legacy.proposed_dissolved_into_village_id is null;
alter table public.villages_legacy drop constraint if exists villages_legacy_unit_type_check;
alter table public.villages_legacy add constraint villages_legacy_unit_type_check check (legacy_unit_type in ('village', 'resettlement_area'));
alter table public.villages_legacy drop constraint if exists villages_legacy_target_check;
alter table public.villages_legacy add constraint villages_legacy_target_check check (
  (mapping_status = 'confirmed' and dissolved_into_village_id is not null and proposed_dissolved_into_village_id is null)
  or (mapping_status = 'pending_official_decision' and dissolved_into_village_id is null and proposed_dissolved_into_village_id is not null)
);

create table if not exists public.report_import_batches (
  id uuid primary key default gen_random_uuid(), commune_id text not null,
  period_id uuid not null references public.report_periods(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','review_ready','blocked','committed','cancelled')),
  mapping_version text not null, expected_village_count integer not null default 22 check (expected_village_count > 0),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  committed_by uuid references public.user_profiles(id) on delete restrict, committed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint report_import_batches_commune_not_blank check (btrim(commune_id) <> ''),
  constraint report_import_batches_mapping_version_not_blank check (btrim(mapping_version) <> ''),
  constraint report_import_batches_commit_metadata check ((status = 'committed' and committed_by is not null and committed_at is not null) or status <> 'committed')
);
create table if not exists public.report_import_files (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.report_import_batches(id) on delete cascade,
  source_filename text not null, content_sha256 text not null, size_bytes integer not null check (size_bytes > 0),
  source_village_name text not null, legacy_village_id uuid references public.villages_legacy(id) on delete restrict,
  target_village_id uuid references public.villages(id) on delete restrict,
  mapping_status text not null check (mapping_status in ('confirmed','pending_official_decision','unmapped')),
  report_source public.report_source not null default 'excel', metadata jsonb not null default '{}'::jsonb,
  raw_values jsonb not null, normalized_values jsonb not null, validation_flags jsonb not null default '[]'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending','accepted','rejected')),
  review_reason text,
  reviewed_by uuid references public.user_profiles(id) on delete restrict, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint report_import_files_filename_not_blank check (btrim(source_filename) <> ''),
  constraint report_import_files_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint report_import_files_village_not_blank check (btrim(source_village_name) <> ''),
  constraint report_import_files_json_shapes check (jsonb_typeof(metadata)='object' and jsonb_typeof(raw_values)='object' and jsonb_typeof(normalized_values)='object' and jsonb_typeof(validation_flags)='array'),
  constraint report_import_files_target_check check ((mapping_status='confirmed' and target_village_id is not null) or (mapping_status in ('pending_official_decision','unmapped') and target_village_id is null)),
  constraint report_import_files_review_metadata check (
    (review_status='accepted' and reviewed_by is not null and reviewed_at is not null and review_reason is null)
    or (review_status='rejected' and reviewed_by is not null and reviewed_at is not null and btrim(review_reason) <> '')
    or (review_status='pending' and reviewed_by is null and reviewed_at is null and review_reason is null)
  ),
  constraint report_import_files_batch_hash_unique unique (batch_id, content_sha256),
  constraint report_import_files_batch_village_unique unique (batch_id, source_village_name)
);
alter table public.report_import_files add column if not exists review_reason text;
alter table public.report_import_files drop constraint if exists report_import_files_review_metadata;
alter table public.report_import_files add constraint report_import_files_review_metadata check (
  (review_status='accepted' and reviewed_by is not null and reviewed_at is not null and review_reason is null)
  or (review_status='rejected' and reviewed_by is not null and reviewed_at is not null and btrim(review_reason) <> '')
  or (review_status='pending' and reviewed_by is null and reviewed_at is null and review_reason is null)
);
create table if not exists public.report_import_resolutions (
  id uuid primary key default gen_random_uuid(), import_file_id uuid not null references public.report_import_files(id) on delete cascade,
  ct_code text not null check (ct_code ~ '^CT(0[1-9]|1[0-4])$'), raw_value jsonb not null,
  accepted_value integer check (accepted_value is null or accepted_value >= 0),
  decision text not null check (decision in ('accepted','corrected','rejected')), reason text not null check (btrim(reason) <> ''),
  resolved_by uuid not null references public.user_profiles(id) on delete restrict, resolved_at timestamptz not null default now(),
  constraint report_import_resolutions_file_code_unique unique (import_file_id, ct_code)
);
create table if not exists public.report_import_lineage (
  report_id uuid not null references public.reports(id) on delete cascade,
  import_file_id uuid not null references public.report_import_files(id) on delete restrict,
  created_at timestamptz not null default now(), primary key (report_id, import_file_id)
);
create or replace function public.commit_report_import_batch(p_batch_id uuid)
returns table (batch_id uuid, report_count integer, source_file_count integer, already_committed boolean)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  target_batch public.report_import_batches%rowtype;
  target_record record;
  target_report_id uuid;
  committed_reports integer := 0;
  file_count integer := 0;
  accepted_count integer := 0;
  rejected_count integer := 0;
  eligible_target_count integer := 0;
begin
  if actor is null or public.profile_role() <> 'admin_xa' or not public.profile_can_mutate() then
    raise exception 'Admin mutation permission is required' using errcode = '42501';
  end if;
  select * into target_batch from public.report_import_batches batch
  where batch.id = p_batch_id and batch.commune_id = public.profile_commune_id() for update;
  if not found then raise exception 'Import batch not found' using errcode = 'P0002'; end if;
  select count(*)::integer into file_count from public.report_import_files file where file.batch_id = p_batch_id;
  if target_batch.status = 'committed' then
    return query select p_batch_id, count(distinct lineage.report_id)::integer, file_count, true
    from public.report_import_lineage lineage join public.report_import_files file on file.id = lineage.import_file_id
    where file.batch_id = p_batch_id;
    return;
  end if;
  if target_batch.status = 'cancelled' then raise exception 'Import batch is cancelled' using errcode = 'P0001'; end if;
  if file_count = 0 or file_count > target_batch.expected_village_count then
    raise exception 'Import batch file count is invalid' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.report_import_files file
    left join public.villages_legacy legacy on legacy.id = file.legacy_village_id
    where file.batch_id = p_batch_id and (legacy.id is null or legacy.legacy_unit_type <> 'village')
  ) then raise exception 'Import batch contains an unsupported legacy unit' using errcode = '23514'; end if;
  if exists (select 1 from public.report_import_files file where file.batch_id = p_batch_id and file.review_status = 'pending')
  then raise exception 'Every uploaded file must be reviewed' using errcode = '23514'; end if;
  if exists (select 1 from public.report_import_files file where file.batch_id = p_batch_id
    and file.review_status = 'accepted' and (file.mapping_status <> 'confirmed' or file.target_village_id is null))
  then raise exception 'An accepted file has no confirmed village mapping' using errcode = '23514'; end if;
  select
    count(*) filter (where file.review_status = 'accepted')::integer,
    count(*) filter (where file.review_status = 'rejected')::integer
  into accepted_count, rejected_count
  from public.report_import_files file where file.batch_id = p_batch_id;
  if accepted_count = 0 then raise exception 'At least one source file must be accepted' using errcode = '23514'; end if;
  if exists (
    select 1 from public.report_import_files file where file.batch_id = p_batch_id
      and file.review_status = 'accepted' and (
      (
        select count(*)
        from jsonb_object_keys(file.normalized_values)
      ) <> 14
      or exists (select 1 from jsonb_each(file.normalized_values) item
                 where item.key !~ '^CT(0[1-9]|1[0-4])$' or jsonb_typeof(item.value) <> 'number')
    )
  ) then raise exception 'Import batch contains missing or non-numeric values' using errcode = '23514'; end if;
  select count(*)::integer into eligible_target_count
  from public.villages target
  where target.commune_id = target_batch.commune_id
    and exists (
      select 1 from public.villages_legacy legacy
      where legacy.commune_id = target_batch.commune_id
        and legacy.mapping_version = target_batch.mapping_version
        and legacy.legacy_unit_type = 'village'
        and legacy.mapping_status = 'confirmed'
        and legacy.dissolved_into_village_id = target.id
    )
    and not exists (
      select 1 from public.villages_legacy legacy
      where legacy.commune_id = target_batch.commune_id
        and legacy.mapping_version = target_batch.mapping_version
        and legacy.legacy_unit_type = 'village'
        and legacy.mapping_status = 'pending_official_decision'
        and legacy.proposed_dissolved_into_village_id = target.id
    )
    and not exists (
      select 1 from public.villages_legacy legacy
      where legacy.commune_id = target_batch.commune_id
        and legacy.mapping_version = target_batch.mapping_version
        and legacy.legacy_unit_type = 'village'
        and legacy.mapping_status = 'confirmed'
        and legacy.dissolved_into_village_id = target.id
        and not exists (
          select 1 from public.report_import_files file
          where file.batch_id = p_batch_id and file.legacy_village_id = legacy.id
            and file.review_status = 'accepted' and file.mapping_status = 'confirmed'
            and file.target_village_id = target.id
        )
    );
  if eligible_target_count = 0 then
    raise exception 'No complete current-village group is eligible for import' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.reports report
    where report.period_id = target_batch.period_id
      and report.workflow_status not in ('draft', 'needs_revision')
      and report.village_id in (
        select target.id from public.villages target
        where target.commune_id = target_batch.commune_id
          and exists (select 1 from public.villages_legacy legacy where legacy.commune_id = target_batch.commune_id and legacy.mapping_version = target_batch.mapping_version and legacy.legacy_unit_type = 'village' and legacy.mapping_status = 'confirmed' and legacy.dissolved_into_village_id = target.id)
          and not exists (select 1 from public.villages_legacy legacy where legacy.commune_id = target_batch.commune_id and legacy.mapping_version = target_batch.mapping_version and legacy.legacy_unit_type = 'village' and legacy.mapping_status = 'pending_official_decision' and legacy.proposed_dissolved_into_village_id = target.id)
          and not exists (
            select 1 from public.villages_legacy legacy
            where legacy.commune_id = target_batch.commune_id and legacy.mapping_version = target_batch.mapping_version
              and legacy.legacy_unit_type = 'village' and legacy.mapping_status = 'confirmed' and legacy.dissolved_into_village_id = target.id
              and not exists (select 1 from public.report_import_files file where file.batch_id = p_batch_id and file.legacy_village_id = legacy.id and file.review_status = 'accepted' and file.mapping_status = 'confirmed' and file.target_village_id = target.id)
          )
      )
  ) then raise exception 'An approved or locked report cannot be replaced by an import' using errcode = '23514'; end if;
  for target_record in
    select target.id as village_id from public.villages target
    where target.commune_id = target_batch.commune_id
      and exists (select 1 from public.villages_legacy legacy where legacy.commune_id = target_batch.commune_id and legacy.mapping_version = target_batch.mapping_version and legacy.legacy_unit_type = 'village' and legacy.mapping_status = 'confirmed' and legacy.dissolved_into_village_id = target.id)
      and not exists (select 1 from public.villages_legacy legacy where legacy.commune_id = target_batch.commune_id and legacy.mapping_version = target_batch.mapping_version and legacy.legacy_unit_type = 'village' and legacy.mapping_status = 'pending_official_decision' and legacy.proposed_dissolved_into_village_id = target.id)
      and not exists (
        select 1 from public.villages_legacy legacy
        where legacy.commune_id = target_batch.commune_id and legacy.mapping_version = target_batch.mapping_version
          and legacy.legacy_unit_type = 'village' and legacy.mapping_status = 'confirmed' and legacy.dissolved_into_village_id = target.id
          and not exists (select 1 from public.report_import_files file where file.batch_id = p_batch_id and file.legacy_village_id = legacy.id and file.review_status = 'accepted' and file.mapping_status = 'confirmed' and file.target_village_id = target.id)
      )
  loop
    insert into public.reports (
      village_id, period_id, workflow_status, timeliness_status, publication_status,
      report_source, version, created_by, submitted_by, submitted_at
    )
    select target_record.village_id, target_batch.period_id, 'draft',
      'not_submitted'::public.report_timeliness_status,
      'private', 'excel', 1, actor, null, null
    from public.report_periods period where period.id = target_batch.period_id
    on conflict (village_id, period_id) do update set
      workflow_status = 'draft', timeliness_status = 'not_submitted',
      publication_status = 'private', report_source = 'excel', submitted_by = null, submitted_at = null,
      approved_by = null, approved_at = null, locked_by = null, locked_at = null,
      published_by = null, published_at = null, version = public.reports.version + 1
    returning id into target_report_id;
    delete from public.report_validation_flags where report_id = target_report_id;
    delete from public.report_values where report_id = target_report_id;
    insert into public.report_values (report_id, ct_code, value)
    select target_report_id, item.key, sum((item.value #>> '{}')::integer)::integer
    from public.report_import_files file cross join lateral jsonb_each(file.normalized_values) item
    where file.batch_id = p_batch_id and file.target_village_id = target_record.village_id
      and file.review_status = 'accepted' group by item.key;
    insert into public.report_import_lineage (report_id, import_file_id)
    select target_report_id, file.id from public.report_import_files file
    where file.batch_id = p_batch_id and file.target_village_id = target_record.village_id
      and file.review_status = 'accepted' on conflict do nothing;
    update public.reports report set
      workflow_status = 'submitted',
      timeliness_status = case when now() <= (select due_date from public.report_periods where id = target_batch.period_id)
        then 'on_time'::public.report_timeliness_status else 'late'::public.report_timeliness_status end,
      submitted_by = actor,
      submitted_at = now()
    where report.id = target_report_id;
    committed_reports := committed_reports + 1;
  end loop;
  insert into public.audit_log (action, table_name, record_id, user_id, details)
  values ('BATCH_IMPORT_COMMIT', 'report_import_batches', p_batch_id, actor,
    jsonb_build_object(
      'mapping_version', target_batch.mapping_version,
      'uploaded_source_count', file_count,
      'accepted_source_count', accepted_count,
      'rejected_source_count', rejected_count,
      'missing_source_count', greatest(target_batch.expected_village_count - file_count, 0),
      'eligible_target_count', eligible_target_count,
      'excluded_target_count', 10 - eligible_target_count
    ));
  update public.report_import_batches set status = 'committed', committed_by = actor, committed_at = now() where id = p_batch_id;
  return query select p_batch_id, committed_reports, file_count, false;
end
$$;
revoke all on function public.commit_report_import_batch(uuid) from public, anon, authenticated, service_role;
grant execute on function public.commit_report_import_batch(uuid) to authenticated;

create or replace function public.guard_report_import_file_mutation()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  target_batch_status text;
begin
  select batch.status into target_batch_status
  from public.report_import_batches batch
  where batch.id = case when tg_op = 'DELETE' then old.batch_id else new.batch_id end;
  if target_batch_status is null then
    raise exception 'Import batch not found' using errcode = 'P0002';
  end if;
  if target_batch_status in ('committed', 'cancelled') then
    raise exception 'Closed import evidence is immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.review_status <> 'pending' then
      raise exception 'A reviewed import file is immutable' using errcode = '23514';
    end if;
    if old.batch_id is distinct from new.batch_id
      or old.source_filename is distinct from new.source_filename
      or old.content_sha256 is distinct from new.content_sha256
      or old.size_bytes is distinct from new.size_bytes
      or old.source_village_name is distinct from new.source_village_name
      or old.legacy_village_id is distinct from new.legacy_village_id
      or old.target_village_id is distinct from new.target_village_id
      or old.mapping_status is distinct from new.mapping_status
      or old.report_source is distinct from new.report_source
      or old.raw_values is distinct from new.raw_values
    then
      raise exception 'Source import evidence is immutable' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function public.guard_report_import_file_mutation() from public, anon, authenticated, service_role;

create index if not exists report_import_batches_scope_idx on public.report_import_batches (commune_id,period_id,status);
create index if not exists report_import_files_batch_status_idx on public.report_import_files (batch_id,mapping_status,review_status);
drop trigger if exists report_import_batches_set_updated_at on public.report_import_batches;
create trigger report_import_batches_set_updated_at before update on public.report_import_batches for each row execute function public.set_updated_at();
drop trigger if exists report_import_batches_audit on public.report_import_batches;
create trigger report_import_batches_audit after insert or update or delete on public.report_import_batches for each row execute function public.audit_operations_change();
drop trigger if exists report_import_files_audit on public.report_import_files;
create trigger report_import_files_audit after insert or update or delete on public.report_import_files for each row execute function public.audit_operations_change();
drop trigger if exists report_import_files_guard on public.report_import_files;
create trigger report_import_files_guard before insert or update or delete on public.report_import_files for each row execute function public.guard_report_import_file_mutation();
drop trigger if exists report_import_resolutions_audit on public.report_import_resolutions;
create trigger report_import_resolutions_audit after insert or update or delete on public.report_import_resolutions for each row execute function public.audit_operations_change();

alter table public.report_import_batches enable row level security;
alter table public.report_import_files enable row level security;
alter table public.report_import_resolutions enable row level security;
alter table public.report_import_lineage enable row level security;
grant select,insert,update on public.report_import_batches,public.report_import_files,public.report_import_resolutions to authenticated;
revoke insert,update,delete on public.report_import_lineage from authenticated;
grant select on public.report_import_lineage to authenticated;
drop policy if exists report_import_batches_select_internal on public.report_import_batches;
create policy report_import_batches_select_internal on public.report_import_batches for select to authenticated using (public.profile_role() in ('admin_xa','lanh_dao') and commune_id=public.profile_commune_id());
drop policy if exists report_import_batches_mutate_admin on public.report_import_batches;
create policy report_import_batches_mutate_admin on public.report_import_batches for all to authenticated using (public.profile_role()='admin_xa' and public.profile_can_mutate() and commune_id=public.profile_commune_id()) with check (public.profile_role()='admin_xa' and public.profile_can_mutate() and commune_id=public.profile_commune_id());
drop policy if exists report_import_files_select_internal on public.report_import_files;
create policy report_import_files_select_internal on public.report_import_files for select to authenticated using (exists (select 1 from public.report_import_batches batch where batch.id=batch_id and batch.commune_id=public.profile_commune_id() and public.profile_role() in ('admin_xa','lanh_dao')));
drop policy if exists report_import_files_mutate_admin on public.report_import_files;
create policy report_import_files_mutate_admin on public.report_import_files for all to authenticated using (public.profile_role()='admin_xa' and public.profile_can_mutate() and exists (select 1 from public.report_import_batches batch where batch.id=batch_id and batch.commune_id=public.profile_commune_id())) with check (public.profile_role()='admin_xa' and public.profile_can_mutate() and exists (select 1 from public.report_import_batches batch where batch.id=batch_id and batch.commune_id=public.profile_commune_id()));
drop policy if exists report_import_resolutions_select_internal on public.report_import_resolutions;
create policy report_import_resolutions_select_internal on public.report_import_resolutions for select to authenticated using (exists (select 1 from public.report_import_files file join public.report_import_batches batch on batch.id=file.batch_id where file.id=import_file_id and batch.commune_id=public.profile_commune_id() and public.profile_role() in ('admin_xa','lanh_dao')));
drop policy if exists report_import_resolutions_mutate_admin on public.report_import_resolutions;
create policy report_import_resolutions_mutate_admin on public.report_import_resolutions for all to authenticated using (
  public.profile_role()='admin_xa' and public.profile_can_mutate()
  and exists (
    select 1 from public.report_import_files file join public.report_import_batches batch on batch.id=file.batch_id
    where file.id=import_file_id and batch.commune_id=public.profile_commune_id()
  )
) with check (
  public.profile_role()='admin_xa' and public.profile_can_mutate()
  and exists (
    select 1 from public.report_import_files file join public.report_import_batches batch on batch.id=file.batch_id
    where file.id=import_file_id and batch.commune_id=public.profile_commune_id()
  )
);
drop policy if exists report_import_lineage_select_internal on public.report_import_lineage;
create policy report_import_lineage_select_internal on public.report_import_lineage for select to authenticated using (public.can_select_report(report_id));
drop policy if exists report_import_lineage_insert_admin on public.report_import_lineage;
create policy report_import_lineage_insert_admin on public.report_import_lineage for insert to authenticated with check (
  public.profile_role()='admin_xa' and public.profile_can_mutate()
  and public.can_select_report(report_id)
  and exists (
    select 1 from public.report_import_files file join public.report_import_batches batch on batch.id=file.batch_id
    where file.id=import_file_id and batch.commune_id=public.profile_commune_id()
  )
);

commit;
