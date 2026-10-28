-- The Users page shows each account's login email to the people allowed to reset its
-- password: the propriétaire, and a gérant granted perm_users. Emails live in
-- auth.users, which the client cannot read, so this returns them for one org's
-- members. Anyone else gets no rows (the exists() check cannot be NULL, so it fails
-- closed). Password resets themselves go through the admin-set-password Edge Function.
create or replace function public.get_org_member_emails(p_org_id uuid)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select m.user_id, u.email::text
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
    and exists (
      select 1 from public.memberships me
      where me.org_id = p_org_id
        and me.user_id = auth.uid()
        and me.is_active
        and (me.role = 'proprietaire' or (me.role = 'gerant' and me.perm_users))
    );
$$;

revoke execute on function public.get_org_member_emails(uuid) from public, anon;
grant execute on function public.get_org_member_emails(uuid) to authenticated;
