-- Prevent calendar-style report periods with impossible month numbers.
-- Legacy rows are not assigned a guessed month. They receive an explicit,
-- unique review label while retaining the original value for auditability.
begin;

alter table public.report_periods
  drop constraint if exists report_periods_calendar_name_valid;

update public.report_periods
set
  name = left(
    'Kỳ cần rà soát ' || left(id::text, 8) || ' — tên cũ: ' || btrim(name),
    120
  ),
  updated_at = now()
where
  btrim(name) ~* '^(th[aá]ng[[:space:]]*)?[0-9]{1,2}[[:space:]]*/[[:space:]]*[0-9]{4}$'
  and trim(
    split_part(
      regexp_replace(btrim(name), '^th[aá]ng[[:space:]]*', '', 'i'),
      '/',
      1
    )
  )::integer not between 1 and 12;

alter table public.report_periods
  add constraint report_periods_calendar_name_valid check (
    case
      when btrim(name) ~* '^(th[aá]ng[[:space:]]*)?[0-9]{1,2}[[:space:]]*/[[:space:]]*[0-9]{4}$'
      then trim(
        split_part(
          regexp_replace(btrim(name), '^th[aá]ng[[:space:]]*', '', 'i'),
          '/',
          1
        )
      )::integer between 1 and 12
      else true
    end
  );

commit;
