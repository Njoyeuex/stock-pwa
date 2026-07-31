-- Internal-only helper for the admin-unlock-account Edge Function: auth.users isn't in an
-- exposed PostgREST schema, so this SECURITY DEFINER function is the only way to resolve an
-- email to a user id server-side. Never granted to anon/authenticated - service_role only.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;
