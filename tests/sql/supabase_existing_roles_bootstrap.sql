\set ON_ERROR_STOP on

-- The database-contract job creates Supabase roles once at cluster scope. A
-- second disposable database still needs the auth schema/function owned by the
-- database itself, but must not attempt to recreate those cluster roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Supabase-compatible cluster roles are missing';
  end if;
end
$$;

create schema auth;
create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
