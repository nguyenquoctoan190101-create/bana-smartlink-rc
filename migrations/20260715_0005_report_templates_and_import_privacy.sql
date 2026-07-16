begin;

alter table public.report_periods add column if not exists template_sha256 text;
alter table public.report_periods add column if not exists template_size_bytes integer;

alter table public.report_periods drop constraint if exists report_periods_template_sha256_check;
alter table public.report_periods add constraint report_periods_template_sha256_check check (
  template_sha256 is null or template_sha256 ~ '^[0-9a-f]{64}$'
);
alter table public.report_periods drop constraint if exists report_periods_template_size_check;
alter table public.report_periods add constraint report_periods_template_size_check check (
  template_size_bytes is null or template_size_bytes between 1 and 5242880
);
alter table public.report_periods drop constraint if exists report_periods_template_metadata_check;
alter table public.report_periods add constraint report_periods_template_metadata_check check (
  (template_path is null and template_sha256 is null and template_size_bytes is null)
  or (template_path is not null and template_sha256 is not null and template_size_bytes is not null)
);

drop policy if exists report_import_files_select_internal on public.report_import_files;
create policy report_import_files_select_internal on public.report_import_files for select to authenticated using (
  exists (
    select 1 from public.report_import_batches batch
    where batch.id = batch_id and batch.commune_id = public.profile_commune_id()
      and public.profile_role() = 'admin_xa'
  )
);

drop policy if exists report_import_resolutions_select_internal on public.report_import_resolutions;
create policy report_import_resolutions_select_internal on public.report_import_resolutions for select to authenticated using (
  exists (
    select 1 from public.report_import_files file
    join public.report_import_batches batch on batch.id = file.batch_id
    where file.id = import_file_id and batch.commune_id = public.profile_commune_id()
      and public.profile_role() = 'admin_xa'
  )
);

drop policy if exists report_import_resolutions_mutate_admin on public.report_import_resolutions;
create policy report_import_resolutions_mutate_admin on public.report_import_resolutions for all to authenticated using (
  public.profile_role() = 'admin_xa' and public.profile_can_mutate()
  and exists (
    select 1 from public.report_import_files file
    join public.report_import_batches batch on batch.id = file.batch_id
    where file.id = import_file_id and batch.commune_id = public.profile_commune_id()
  )
) with check (
  public.profile_role() = 'admin_xa' and public.profile_can_mutate()
  and exists (
    select 1 from public.report_import_files file
    join public.report_import_batches batch on batch.id = file.batch_id
    where file.id = import_file_id and batch.commune_id = public.profile_commune_id()
  )
);

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'report-templates',
      'report-templates',
      false,
      5242880,
      array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    )
    on conflict (id) do update set
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists report_templates_insert_admin on storage.objects';
    execute 'drop policy if exists report_templates_select_internal on storage.objects';
    execute $policy$
      create policy report_templates_insert_admin
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'report-templates'
        and public.profile_role() = 'admin_xa'
        and public.profile_can_mutate()
        and split_part(name, '/', 1) = public.profile_commune_id()
      )
    $policy$;
    execute $policy$
      create policy report_templates_select_internal
      on storage.objects for select to authenticated
      using (
        bucket_id = 'report-templates'
        and public.profile_role() in ('admin_xa', 'lanh_dao', 'can_bo_thon', 'to_cnscd')
        and split_part(name, '/', 1) = public.profile_commune_id()
      )
    $policy$;
  end if;
end
$storage$;

commit;
