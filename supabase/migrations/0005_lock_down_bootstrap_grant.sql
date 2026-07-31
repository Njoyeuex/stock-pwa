-- Supabase auto-grants EXECUTE directly to anon/authenticated on new functions (not just via
-- the PUBLIC default), so anon must be revoked explicitly, same fix as migration 0002/0003.
revoke execute on function public.bootstrap_organization(text, text) from anon;
