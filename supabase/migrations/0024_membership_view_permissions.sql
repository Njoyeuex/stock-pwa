-- Two more grantable, view-only permissions: seeing the users list, and seeing sales reports
-- (full org visibility, like gerant, rather than "only my own sales").
alter table public.memberships
  add column perm_view_users boolean not null default false,
  add column perm_view_reports boolean not null default false;

create or replace function public.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.is_active
      and (
        m.role = 'proprietaire'
        or (p_permission = 'caisse' and m.perm_caisse)
        or (p_permission = 'catalog' and m.perm_catalog)
        or (p_permission = 'invoices' and m.perm_invoices)
        or (p_permission = 'users' and m.perm_users)
        or (p_permission = 'view_users' and m.perm_view_users)
        or (p_permission = 'view_reports' and m.perm_view_reports)
      )
  );
$$;

revoke execute on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- Reports: full visibility (like gerant) for anyone granted perm_view_reports.
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select
  using (
    get_my_role(org_id) = any (array['proprietaire','gerant']::app_role[])
    or has_permission(org_id, 'view_reports')
    or (get_my_role(org_id) = any (array['caissier','vendeur']::app_role[]) and created_by = auth.uid())
  );

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select
  using (
    exists (
      select 1 from public.caisse_sessions cs
      where cs.id = cash_movements.caisse_session_id
        and (
          get_my_role(cs.org_id) = any (array['proprietaire','gerant']::app_role[])
          or has_permission(cs.org_id, 'view_reports')
          or cs.opened_by = auth.uid()
        )
    )
  );

drop policy if exists caisse_sessions_select on public.caisse_sessions;
create policy caisse_sessions_select on public.caisse_sessions
  for select
  using (
    get_my_role(org_id) = any (array['proprietaire','gerant']::app_role[])
    or has_permission(org_id, 'view_reports')
    or opened_by = auth.uid()
  );
