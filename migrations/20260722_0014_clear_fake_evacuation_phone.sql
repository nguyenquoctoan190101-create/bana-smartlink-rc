-- Remove the legacy synthetic placeholder from existing demo rows.
-- Real contact details must only be stored after authority approval.
begin;

update public.evacuation_points
set contact_phone = null,
    updated_at = now()
where contact_phone = '0000000000';

commit;
