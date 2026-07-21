-- Do not force synthetic evacuation points to carry a fake phone number.
-- A contact phone is only stored when an authority-approved number exists.
begin;

alter table public.evacuation_points
  alter column contact_phone drop not null;

commit;
