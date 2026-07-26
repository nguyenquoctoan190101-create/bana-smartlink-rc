-- Make every report mutation pass through a scoped, audited RPC.
-- Imported previews remain ephemeral: the database stores only a one-time
-- digest and provenance envelope, never the extracted CT01-CT14 values.

begin;

create table if not exists public.report_extraction_evidence (
  id uuid primary key,
  user_id uuid not null,
  source_type text not null
    check (source_type in ('excel', 'photo_ocr', 'pdf_ocr')),
  source_checksum text not null
    check (source_checksum ~ '^[0-9a-f]{64}$'),
  extractor_versions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(extractor_versions) = 'array'),
  original_values_sha256 text not null
    check (original_values_sha256 ~ '^[0-9a-f]{64}$'),
  field_count integer not null check (field_count between 0 and 14),
  requires_review_count integer not null
    check (requires_review_count between 0 and 14),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_idempotency_key uuid,
  consumed_report_id uuid,
  created_at timestamptz not null default now(),
  constraint report_extraction_evidence_consumption_check check (
    (consumed_at is null
      and consumed_idempotency_key is null
      and consumed_report_id is null)
    or
    (consumed_at is not null
      and consumed_idempotency_key is not null
      and consumed_report_id is not null)
  )
);

alter table public.report_extraction_evidence enable row level security;
revoke all on public.report_extraction_evidence
  from public, anon, authenticated;
grant insert on public.report_extraction_evidence to service_role;

comment on table public.report_extraction_evidence is
  'Server-registered, one-time digest proving that an authenticated user reviewed an ephemeral Excel/OCR preview.';
comment on column public.report_extraction_evidence.original_values_sha256 is
  'SHA-256 of the canonical CT01-CT14 JSON object; the original preview values are intentionally not persisted.';

-- The base writer is an internal primitive. Its original invoker privileges
-- allowed a caller to label arbitrary values as Excel/OCR output.
revoke all on function public.save_report_submission(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb,
  integer, uuid, boolean, boolean, text
) from public, anon, authenticated, service_role;

revoke all on function public.record_report_extraction_review(
  uuid, uuid, public.report_source, jsonb, jsonb
) from public, anon, authenticated, service_role;

drop function if exists public.save_report_submission_with_extraction(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb, integer, uuid,
  boolean, boolean, text, jsonb, jsonb
);

create or replace function public.report_submission_scope_is_valid(
  p_village_id uuid,
  p_period_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    public.can_modify_village(p_village_id)
    and exists (
      select 1
      from public.villages as village
      join public.report_periods as period
        on period.id = p_period_id
       and period.commune_id = village.commune_id
      join public.report_period_villages as assignment
        on assignment.period_id = period.id
       and assignment.village_id = village.id
      where village.id = p_village_id
        and village.is_active
    )
$$;

revoke all on function public.report_submission_scope_is_valid(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Keep the database validator aligned with the deterministic application
-- rules, including the canonical CT14 <= CT01 invariant.
create or replace function public.report_indicator_values_are_valid(
  target_report_id uuid
)
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
      max(value) filter (where ct_code = 'CT11') as ct11,
      max(value) filter (where ct_code = 'CT14') as ct14
    from public.report_values
    where report_id = target_report_id
  )
  select
    populated_count = 14
    and ct01 is not null and ct02 is not null
    and ct03 is not null and ct04 is not null
    and ct07 is not null and ct08 is not null
    and ct09 is not null and ct10 is not null
    and ct11 is not null and ct14 is not null
    and ct03 <= ct01
    and ct03 + ct04 <= ct01
    and ct07 <= ct02
    and ct08 <= ct07
    and ct09 <= ct01
    and ct10 <= ct02
    and ct11 <= ct02
    and ct14 <= ct01
  from values_by_code
$$;

revoke all on function public.report_indicator_values_are_valid(uuid)
  from public, anon, authenticated, service_role;

-- PostgreSQL has jsonb_array_length but no jsonb_object_length. Earlier
-- upgrade migrations referenced the latter in already-created function
-- bodies. Keep those upgraded databases operational while clean installs use
-- jsonb_object_keys directly in db/schema.sql.
create or replace function public.jsonb_object_length(target jsonb)
returns integer
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select count(*)::integer
  from pg_catalog.jsonb_object_keys(target)
$$;

revoke all on function public.jsonb_object_length(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.save_manual_report_submission(
  p_report_id uuid,
  p_village_id uuid,
  p_period_id uuid,
  p_report_source public.report_source,
  p_values jsonb,
  p_flags jsonb,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_submit boolean,
  p_assisted_by_cnscd boolean,
  p_assisted_member_name text
)
returns table (
  report_id uuid,
  version integer,
  workflow_status public.report_workflow_status,
  timeliness_status public.report_timeliness_status,
  submitted_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_report_source not in ('manual', 'direct_api')
     or not public.report_submission_scope_is_valid(
       p_village_id,
       p_period_id
     )
  then
    raise exception 'report submission is outside the caller scope'
      using errcode = '42501';
  end if;

  return query
  select *
  from public.save_report_submission(
    p_report_id,
    p_village_id,
    p_period_id,
    p_report_source,
    p_values,
    p_flags,
    p_expected_version,
    p_idempotency_key,
    p_submit,
    p_assisted_by_cnscd,
    p_assisted_member_name
  );
end
$$;

revoke all on function public.save_manual_report_submission(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb, integer, uuid,
  boolean, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_manual_report_submission(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb, integer, uuid,
  boolean, boolean, text
) to authenticated;

create or replace function public.save_report_submission_with_extraction(
  p_report_id uuid,
  p_village_id uuid,
  p_period_id uuid,
  p_report_source public.report_source,
  p_values jsonb,
  p_flags jsonb,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_submit boolean,
  p_assisted_by_cnscd boolean,
  p_assisted_member_name text,
  p_extraction_corrections jsonb,
  p_extraction_metadata jsonb,
  p_extraction_evidence_id uuid
)
returns table (
  report_id uuid,
  version integer,
  workflow_status public.report_workflow_status,
  timeliness_status public.report_timeliness_status,
  submitted_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor uuid := auth.uid();
  evidence public.report_extraction_evidence%rowtype;
  correction jsonb;
  original_values jsonb := p_values;
  saved record;
begin
  if actor is null
     or p_report_source not in ('excel', 'photo_ocr')
     or p_idempotency_key is null
     or p_extraction_evidence_id is null
     or jsonb_typeof(p_extraction_corrections) <> 'array'
     or jsonb_typeof(p_extraction_metadata) <> 'object'
     or not public.report_submission_scope_is_valid(
       p_village_id,
       p_period_id
     )
  then
    raise exception 'invalid imported report submission'
      using errcode = '42501';
  end if;

  select *
  into evidence
  from public.report_extraction_evidence as registered
  where registered.id = p_extraction_evidence_id
    and registered.user_id = actor
  for update;

  if not found
     or evidence.expires_at < now()
     or (
       evidence.consumed_at is not null
       and evidence.consumed_idempotency_key is distinct from p_idempotency_key
     )
  then
    raise exception 'extraction evidence is missing, expired, or consumed'
      using errcode = '42501';
  end if;

  if (p_report_source = 'excel' and evidence.source_type <> 'excel')
     or (
       p_report_source = 'photo_ocr'
       and evidence.source_type not in ('photo_ocr', 'pdf_ocr')
     )
     or coalesce(p_extraction_metadata ->> 'source_type', '')
        <> evidence.source_type
     or coalesce(p_extraction_metadata ->> 'source_checksum', '')
        <> evidence.source_checksum
     or coalesce(
       p_extraction_metadata -> 'extractor_versions',
       '[]'::jsonb
     ) <> evidence.extractor_versions
     or coalesce(
       (p_extraction_metadata ->> 'field_count')::integer,
       -1
     ) <> evidence.field_count
     or coalesce(
       (p_extraction_metadata ->> 'requires_review_count')::integer,
       -1
     ) <> evidence.requires_review_count
  then
    raise exception 'extraction metadata does not match registered evidence'
      using errcode = '22023';
  end if;

  for correction in
    select item
    from jsonb_array_elements(p_extraction_corrections) as item
  loop
    if correction ->> 'code' !~ '^CT(0[1-9]|1[0-4])$'
       or not (correction ? 'before')
    then
      raise exception 'invalid extraction correction'
        using errcode = '22023';
    end if;
    original_values := jsonb_set(
      original_values,
      array[correction ->> 'code'],
      correction -> 'before',
      false
    );
  end loop;

  if encode(
    digest(
      convert_to(original_values::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ) <> evidence.original_values_sha256
  then
    raise exception 'submitted values do not match the reviewed preview'
      using errcode = '22023';
  end if;

  select *
  into saved
  from public.save_report_submission(
    p_report_id,
    p_village_id,
    p_period_id,
    p_report_source,
    p_values,
    p_flags,
    p_expected_version,
    p_idempotency_key,
    p_submit,
    p_assisted_by_cnscd,
    p_assisted_member_name
  );

  perform public.record_report_extraction_review(
    saved.report_id,
    p_idempotency_key,
    p_report_source,
    p_extraction_corrections,
    p_extraction_metadata
  );

  if evidence.consumed_report_id is not null
     and evidence.consumed_report_id <> saved.report_id
  then
    raise exception 'extraction evidence replay does not match its report'
      using errcode = '42501';
  end if;

  update public.report_extraction_evidence
  set consumed_at = coalesce(consumed_at, now()),
      consumed_idempotency_key = p_idempotency_key,
      consumed_report_id = saved.report_id
  where id = evidence.id;

  return query
  select
    saved.report_id::uuid,
    saved.version::integer,
    saved.workflow_status::public.report_workflow_status,
    saved.timeliness_status::public.report_timeliness_status,
    saved.submitted_at::timestamptz,
    saved.replayed::boolean;
end
$$;

revoke all on function public.save_report_submission_with_extraction(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb, integer, uuid,
  boolean, boolean, text, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.save_report_submission_with_extraction(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb, integer, uuid,
  boolean, boolean, text, jsonb, jsonb, uuid
) to authenticated;

create or replace function public.transition_report_workflow(
  p_report_id uuid,
  p_expected_version integer,
  p_action text
)
returns table (
  report_id uuid,
  workflow_status public.report_workflow_status,
  publication_status public.report_publication_status,
  version integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  target public.reports%rowtype;
  old_workflow public.report_workflow_status;
  old_publication public.report_publication_status;
begin
  select *
  into target
  from public.reports as report
  where report.id = p_report_id
  for update;

  if actor is null
     or not found
     or not public.can_administer_village(target.village_id)
     or target.version <> p_expected_version
  then
    raise exception 'report is missing, outside scope, or changed'
      using errcode = '40001';
  end if;

  old_workflow := target.workflow_status;
  old_publication := target.publication_status;

  if p_action = 'approve' then
    if target.workflow_status <> 'submitted'
       or target.publication_status <> 'private'
    then
      raise exception 'only a private submitted report can be approved'
        using errcode = '22023';
    end if;
    update public.reports as report
    set workflow_status = 'approved',
        version = report.version + 1,
        updated_at = now()
    where report.id = target.id
    returning * into target;
  elsif p_action = 'lock' then
    if target.workflow_status <> 'approved'
       or target.publication_status <> 'private'
    then
      raise exception 'only a private approved report can be locked'
        using errcode = '22023';
    end if;
    update public.reports as report
    set workflow_status = 'locked',
        version = report.version + 1,
        updated_at = now()
    where report.id = target.id
    returning * into target;
  elsif p_action = 'publish' then
    if target.workflow_status not in ('approved', 'locked')
       or target.publication_status <> 'private'
    then
      raise exception 'only an approved private report can be published'
        using errcode = '22023';
    end if;
    update public.reports as report
    set publication_status = 'published',
        version = report.version + 1,
        updated_at = now()
    where report.id = target.id
    returning * into target;
  else
    raise exception 'unsupported report workflow action'
      using errcode = '22023';
  end if;

  insert into public.audit_log (
    action,
    table_name,
    record_id,
    user_id,
    details
  ) values (
    'REPORT_' || upper(p_action),
    'reports',
    target.id,
    actor,
    jsonb_build_object(
      'from_workflow_status', old_workflow,
      'to_workflow_status', target.workflow_status,
      'from_publication_status', old_publication,
      'to_publication_status', target.publication_status,
      'version', target.version
    )
  );

  return query
  select
    target.id,
    target.workflow_status,
    target.publication_status,
    target.version;
end
$$;

revoke all on function public.transition_report_workflow(uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_report_workflow(uuid, integer, text)
  to authenticated;

create or replace function public.delete_report_submission(
  p_report_id uuid,
  p_expected_version integer
)
returns table (report_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  actor_role public.user_role := public.profile_role();
  target public.reports%rowtype;
begin
  select *
  into target
  from public.reports as report
  where report.id = p_report_id
  for update;

  if actor is null
     or not public.profile_can_mutate()
     or not found
     or target.version <> p_expected_version
     or target.workflow_status = 'locked'
     or target.publication_status = 'published'
     or not (
       public.can_administer_village(target.village_id)
       or (
         actor_role in ('can_bo_thon', 'to_cnscd')
         and public.can_modify_village(target.village_id)
         and target.workflow_status = 'draft'
         and target.publication_status = 'private'
       )
     )
  then
    raise exception 'report is missing, outside scope, or not deletable'
      using errcode = '42501';
  end if;

  delete from public.reports where id = target.id;

  insert into public.audit_log (
    action,
    table_name,
    record_id,
    user_id,
    details
  ) values (
    'REPORT_DELETE',
    'reports',
    target.id,
    actor,
    jsonb_build_object(
      'village_id', target.village_id,
      'period_id', target.period_id,
      'workflow_status', target.workflow_status,
      'publication_status', target.publication_status,
      'version', target.version
    )
  );

  return query select target.id;
end
$$;

revoke all on function public.delete_report_submission(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_report_submission(uuid, integer)
  to authenticated;

-- RLS remains defense in depth for reads. Authenticated clients can no longer
-- mutate report state or values by addressing REST tables directly.
revoke insert, update, delete on public.reports
  from authenticated;
revoke insert, update, delete on public.report_values
  from authenticated;
revoke insert, update, delete on public.report_validation_flags
  from authenticated;
revoke insert on public.report_submission_receipts
  from authenticated;

commit;
