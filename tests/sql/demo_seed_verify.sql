do $$
begin
  if (
    select count(*)
    from public.villages
    where commune_id = 'ba_na'
      and is_active
  ) <> 10 then
    raise exception 'synthetic demo villages must use the canonical ba_na scope';
  end if;

  if (
    select count(*)
    from public.report_periods
    where commune_id = 'ba_na'
      and name = 'Bản công bố minh họa — Tháng 7/2026'
  ) <> 1 then
    raise exception 'synthetic demo period must use the canonical ba_na scope';
  end if;

  if (
    select count(*)
    from public.reports as report
    join public.report_periods as period on period.id = report.period_id
    where report.publication_status = 'published'
      and period.name = 'Bản công bố minh họa — Tháng 7/2026'
  ) <> 10 then
    raise exception 'synthetic demo seed must publish exactly 10 reports';
  end if;

  if (
    select count(*)
    from public.report_values as value
    join public.reports as report on report.id = value.report_id
    join public.report_periods as period on period.id = report.period_id
    where report.publication_status = 'published'
      and period.name = 'Bản công bố minh họa — Tháng 7/2026'
  ) <> 140 then
    raise exception 'synthetic demo seed must create 14 values for each report';
  end if;
end
$$;
