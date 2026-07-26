-- Preserve the human review evidence for Excel/OCR submissions without
-- storing the uploaded document or preview output.

begin;

create or replace function public.record_report_extraction_review(
  p_report_id uuid,
  p_idempotency_key uuid,
  p_source public.report_source,
  p_corrections jsonb,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  can_record boolean;
begin
  if actor is null
     or p_report_id is null
     or p_idempotency_key is null
     or p_source not in ('excel', 'photo_ocr')
     or jsonb_typeof(p_corrections) <> 'array'
     or jsonb_array_length(p_corrections) > 14
     or jsonb_typeof(p_metadata) <> 'object'
     or coalesce(p_metadata ->> 'source_checksum', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_metadata ->> 'source_type', '') not in ('excel', 'photo_ocr', 'pdf_ocr')
     or jsonb_typeof(coalesce(p_metadata -> 'extractor_versions', '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid extraction review payload' using errcode = '22023';
  end if;

  if (p_source = 'excel' and p_metadata ->> 'source_type' <> 'excel')
     or (
       p_source = 'photo_ocr'
       and p_metadata ->> 'source_type' not in ('photo_ocr', 'pdf_ocr')
     )
  then
    raise exception 'extraction source mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_corrections) as correction
    where not (correction ?& array['code', 'before', 'after', 'reason'])
       or correction ->> 'code' !~ '^CT(0[1-9]|1[0-4])$'
       or jsonb_typeof(correction -> 'after') <> 'number'
       or (
         jsonb_typeof(correction -> 'before') not in ('number', 'null')
       )
       or (correction ->> 'after')::numeric < 0
       or (correction ->> 'after')::numeric
          <> trunc((correction ->> 'after')::numeric)
       or (
         jsonb_typeof(correction -> 'before') = 'number'
         and (
           (correction ->> 'before')::numeric < 0
           or (correction ->> 'before')::numeric
              <> trunc((correction ->> 'before')::numeric)
           or (correction ->> 'before')::numeric
              = (correction ->> 'after')::numeric
         )
       )
       or length(btrim(coalesce(correction ->> 'reason', ''))) not between 3 and 240
  ) then
    raise exception 'invalid extraction correction' using errcode = '22023';
  end if;

  if (
    select count(distinct correction ->> 'code')
    from jsonb_array_elements(p_corrections) as correction
  ) <> jsonb_array_length(p_corrections) then
    raise exception 'duplicate extraction correction' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.reports as report
    where report.id = p_report_id
      and report.submitted_by = actor
      and report.idempotency_key = p_idempotency_key
      and report.report_source = p_source
  ) into can_record;
  if not coalesce(can_record, false) then
    raise exception 'extraction review is outside report scope' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_corrections) as correction
    left join public.report_values as report_value
      on report_value.report_id = p_report_id
     and report_value.ct_code = correction ->> 'code'
    where report_value.ct_code is null
       or report_value.value <> (correction ->> 'after')::integer
  ) then
    raise exception 'correction does not match submitted values' using errcode = '22023';
  end if;

  insert into public.audit_log (action, table_name, record_id, user_id, details)
  select
    'REVIEW_EXTRACTED_REPORT',
    'reports',
    p_report_id,
    actor,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'source', p_source,
      'metadata', p_metadata,
      'corrections', p_corrections
    )
  where not exists (
    select 1
    from public.audit_log as audit
    where audit.action = 'REVIEW_EXTRACTED_REPORT'
      and audit.table_name = 'reports'
      and audit.record_id = p_report_id
      and audit.user_id = actor
      and audit.details ->> 'idempotency_key' = p_idempotency_key::text
  );
end
$$;

revoke all on function public.record_report_extraction_review(
  uuid, uuid, public.report_source, jsonb, jsonb
) from public;
grant execute on function public.record_report_extraction_review(
  uuid, uuid, public.report_source, jsonb, jsonb
) to authenticated;

commit;
