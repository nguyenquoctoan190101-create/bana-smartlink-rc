\set ON_ERROR_STOP on

-- Recreate the terminal-row shape accepted before migration 0030. This test
-- database is initialized from the canonical schema, so remove only the new
-- trigger/constraint before inserting the immutable legacy fixture.
drop trigger if exists ai_drafts_integrity on public.ai_action_drafts;
alter table public.ai_action_drafts
  drop constraint if exists ai_drafts_review_metadata;
alter table public.ai_action_drafts
  add constraint ai_drafts_review_metadata check (
    (
      status in ('accepted', 'rejected')
      and reviewed_by is not null
      and reviewed_at is not null
    )
    or status = 'pending_review'
  );

insert into auth.users (id) values
  ('70000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002');

insert into public.user_profiles (
  id, commune_id, display_name, role, force_password_reset
) values
  (
    '70000000-0000-4000-8000-000000000001',
    'ba_na', 'Legacy fixture administrator', 'admin_xa', false
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    'ba_na', 'Legacy fixture leader', 'lanh_dao', false
  );

insert into public.ai_action_drafts (
  id, commune_id, kind, content, citations, confidence, model_provider,
  status, created_by, reviewed_by, reviewed_at, review_notes
) values (
  '70000000-0000-4000-8000-000000000010',
  'ba_na', 'period_brief', 'Immutable legacy terminal draft.', '[]'::jsonb,
  0.75, 'legacy-fixture', 'accepted',
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '2026-07-20T03:00:00Z', null
);

\ir ../../migrations/20260728_0030_ai_draft_admin_mutation.sql

do $$
begin
  if not exists (
    select 1
    from public.ai_action_drafts
    where id = '70000000-0000-4000-8000-000000000010'
      and status = 'accepted'
      and content = 'Immutable legacy terminal draft.'
      and reviewed_by = '70000000-0000-4000-8000-000000000001'
      and reviewed_at = '2026-07-20T03:00:00Z'
      and review_notes is null
  ) then
    raise exception 'migration mutated or removed legacy terminal evidence';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_action_drafts'::regclass
      and conname = 'ai_drafts_review_metadata'
      and not convalidated
  ) then
    raise exception 'legacy metadata constraint should remain NOT VALID';
  end if;
end
$$;

-- NOT VALID preserves old rows but must still reject every new invalid row.
alter table public.ai_action_drafts disable trigger ai_drafts_integrity;
do $$
begin
  begin
    insert into public.ai_action_drafts (
      id, commune_id, kind, content, citations, confidence, model_provider,
      status, created_by, reviewed_by, reviewed_at, review_notes
    ) values (
      '70000000-0000-4000-8000-000000000011',
      'ba_na', 'trend_alert', 'Invalid new terminal draft.', '[]'::jsonb,
      0.75, 'legacy-fixture', 'accepted',
      '70000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001', now(), null
    );
    raise exception 'NOT VALID constraint accepted a new invalid row';
  exception
    when check_violation then null;
  end;
end
$$;
alter table public.ai_action_drafts enable trigger ai_drafts_integrity;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '70000000-0000-4000-8000-000000000002',
  false
);
do $$
begin
  if (select count(*) from public.ai_action_drafts) <> 0 then
    raise exception 'leadership can read invalid legacy terminal metadata';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '70000000-0000-4000-8000-000000000001',
  false
);
do $$
begin
  if (select count(*) from public.ai_action_drafts) <> 1 then
    raise exception 'administrator cannot audit preserved legacy metadata';
  end if;
end
$$;
reset role;
