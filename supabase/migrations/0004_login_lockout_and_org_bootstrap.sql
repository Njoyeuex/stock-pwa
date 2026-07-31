-- Pre-auth lockout tracking, keyed by email (works before a session exists).
-- RLS enabled with zero policies + explicit revoke: anon/authenticated get no access at all,
-- either via PostgREST or direct SQL. Only the service_role key (used exclusively by the
-- auth-login Edge Function) bypasses RLS and can read/write this table.
create table public.account_lockouts (
  email text primary key,
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.account_lockouts enable row level security;
revoke all on public.account_lockouts from anon, authenticated;

-- Atomic "create organization + become its owner" bootstrap, since a brand-new organization
-- has no members yet and the memberships RLS policy would otherwise block the very first insert.
create or replace function public.bootstrap_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role)
  values (v_org_id, auth.uid(), 'proprietaire');

  return v_org_id;
end;
$$;

revoke execute on function public.bootstrap_organization(text, text) from public;
grant execute on function public.bootstrap_organization(text, text) to authenticated;
