-- Keep draft knowledge and revision history private to commune administrators.
-- Other roles only see approved material intended for their audience.
begin;

drop policy if exists knowledge_select_internal on public.knowledge_articles;
create policy knowledge_select_by_role
on public.knowledge_articles
for select
to authenticated
using (
  commune_id = public.profile_commune_id()
  and (
    public.profile_role() = 'admin_xa'
    or (
      status = 'approved'
      and (
        (public.profile_role() = 'lanh_dao' and audience in ('public', 'internal', 'champions'))
        or (public.profile_role() = 'can_bo_thon' and audience in ('public', 'internal'))
        or (public.profile_role() = 'to_cnscd' and audience in ('public', 'champions'))
      )
    )
  )
);

drop policy if exists knowledge_revisions_select_internal on public.knowledge_revisions;
create policy knowledge_revisions_select_by_role
on public.knowledge_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.knowledge_articles a
    where a.id = article_id
      and a.commune_id = public.profile_commune_id()
      and (
        public.profile_role() = 'admin_xa'
        or (
          a.status = 'approved'
          and (
            (public.profile_role() = 'lanh_dao' and a.audience in ('public', 'internal', 'champions'))
            or (public.profile_role() = 'can_bo_thon' and a.audience in ('public', 'internal'))
            or (public.profile_role() = 'to_cnscd' and a.audience in ('public', 'champions'))
          )
        )
      )
  )
);

commit;
