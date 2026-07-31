-- Supabase's default privileges auto-grant EXECUTE directly to anon/authenticated on new
-- public functions; REVOKE ... FROM PUBLIC does not remove those explicit per-role grants.
-- handle_new_user must only ever fire via the auth.users trigger, never be called directly.
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
