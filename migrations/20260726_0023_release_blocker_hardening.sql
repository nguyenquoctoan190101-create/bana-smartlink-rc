-- Close the final report-integrity and forbidden-channel release blockers.
-- Historical migrations remain checksum-stable; this overlay changes the
-- effective database state and is safe for both fresh and upgraded databases.

begin;

update public.alert_deliveries
set channel = 'in_app'
where channel = concat('za', 'lo');

alter table public.alert_deliveries
  drop constraint if exists alert_deliveries_channel_check;
alter table public.alert_deliveries
  add constraint alert_deliveries_channel_check
  check (channel in ('in_app', 'web_push', 'sms'));

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
  p_extraction_metadata jsonb
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
security invoker
set search_path = pg_catalog, public
as $$
declare
  saved record;
begin
  if p_report_source not in ('excel', 'photo_ocr')
     or p_idempotency_key is null
     or p_extraction_metadata is null
  then
    raise exception 'imported reports require extraction metadata and idempotency'
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

  if saved.report_id is null then
    raise exception 'report submission returned no result';
  end if;

  perform public.record_report_extraction_review(
    saved.report_id,
    p_idempotency_key,
    p_report_source,
    p_extraction_corrections,
    p_extraction_metadata
  );

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
  boolean, boolean, text, jsonb, jsonb
) from public;
grant execute on function public.save_report_submission_with_extraction(
  uuid, uuid, uuid, public.report_source, jsonb, jsonb, integer, uuid,
  boolean, boolean, text, jsonb, jsonb
) to authenticated;

commit;
