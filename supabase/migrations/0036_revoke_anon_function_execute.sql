-- Every SECURITY DEFINER function in public had EXECUTE granted back to anon (and
-- authenticated/service_role) outside the migrations, undoing the per-function revokes
-- of 0002-0034: an anonymous visitor could call them through /rest/v1/rpc. The worst
-- case was find_user_id_by_email, which has no auth check and let anyone probe which
-- emails have an account. Nothing in the app calls an RPC before login (sign-in goes
-- through the auth-login Edge Function), so anon needs none of them.

-- 1. RLS helpers: the policies run them as the signed-in user, so authenticated keeps EXECUTE.
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.get_my_role(uuid) from public, anon;
revoke execute on function public.has_store_access(uuid, uuid) from public, anon;
revoke execute on function public.has_permission(uuid, text) from public, anon;

-- 2. RPCs called by the app once signed in: authenticated keeps EXECUTE, each one
--    checks the caller's role itself. (get_inventory_value was never re-opened.)
revoke execute on function public.adjust_stock(uuid, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.open_caisse_session(uuid, uuid, numeric) from public, anon;
revoke execute on function public.close_caisse_session(uuid, numeric) from public, anon;
revoke execute on function public.record_cash_movement(uuid, text, numeric, text) from public, anon;
revoke execute on function public.create_sale(uuid, uuid, jsonb, text, uuid, text, uuid, numeric) from public, anon;
revoke execute on function public.void_sale(uuid, text) from public, anon;
revoke execute on function public.receive_purchase(uuid, uuid, uuid, jsonb, text, uuid, numeric, date) from public, anon;
revoke execute on function public.record_customer_repayment(uuid, numeric, uuid, text) from public, anon;
revoke execute on function public.record_supplier_repayment(uuid, numeric, boolean, uuid, text) from public, anon;
revoke execute on function public.delete_product(uuid) from public, anon;
revoke execute on function public.restore_backup(jsonb) from public, anon;

-- 3. Server-side only, back to their 0006 / 0031 state: find_user_id_by_email is for the
--    admin-unlock-account Edge Function (service_role), and bootstrap_organization must
--    not let a signed-in user spin up a parallel organization.
revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.bootstrap_organization(text, text) from public, anon, authenticated;

-- 4. Trigger functions: EXECUTE is only checked when the trigger is created, never when
--    it fires, so no API role needs it.
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke execute on function public.apply_stock_movement() from public, anon, authenticated, service_role;
revoke execute on function public.apply_credit_movement() from public, anon, authenticated, service_role;
revoke execute on function public.apply_supplier_credit_movement() from public, anon, authenticated, service_role;
revoke execute on function public.log_audit_event() from public, anon, authenticated, service_role;

-- 5. Future functions: drop Supabase's per-schema default that grants EXECUTE to anon.
--    Postgres' own default still grants EXECUTE to PUBLIC on every new function (a
--    per-schema revoke cannot remove it, and a global one would also close extensions
--    that postgres installs), so new functions keep needing their explicit
--    "revoke ... from public, anon" like every migration since 0007.
alter default privileges in schema public revoke execute on functions from anon;
