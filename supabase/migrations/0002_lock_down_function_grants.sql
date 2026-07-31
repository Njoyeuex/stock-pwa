-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which anon inherits from.
-- Revoking only from anon/authenticated individually leaves the PUBLIC grant in place.
revoke execute on function public.is_org_member(uuid) from public;
revoke execute on function public.get_my_role(uuid) from public;
revoke execute on function public.has_store_access(uuid, uuid) from public;
revoke execute on function public.handle_new_user() from public;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.get_my_role(uuid) to authenticated;
grant execute on function public.has_store_access(uuid, uuid) to authenticated;
-- handle_new_user is only ever invoked by the auth.users trigger, never called directly by any role.
