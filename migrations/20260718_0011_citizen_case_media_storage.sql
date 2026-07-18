-- Private storage bucket for citizen field-report images.
-- Plain PostgreSQL CI does not have the Supabase storage schema, so this is
-- intentionally optional there; the API still keeps metadata RLS-protected.
begin;

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'citizen-case-media',
      'citizen-case-media',
      false,
      8388608,
      array['image/jpeg', 'image/png', 'image/webp']
    )
    on conflict (id) do update set
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$storage$;

commit;
