-- Grantable, per-user permissions that a role alone doesn't cover: the owner can hand
-- any of these to a specific account regardless of its base role (e.g. let a trusted
-- vendeur open/close the caisse, or let a gerant create/delete user accounts).
alter table public.memberships
  add column perm_caisse boolean not null default false,
  add column perm_catalog boolean not null default false,
  add column perm_invoices boolean not null default false,
  add column perm_users boolean not null default false;

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
      )
  );
$$;

revoke execute on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- Caisse: role check OR the perm_caisse flag.
create or replace function public.open_caisse_session(p_org_id uuid, p_store_id uuid, p_opening_float numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.get_my_role(p_org_id) not in ('proprietaire','gerant','caissier')
     and not public.has_permission(p_org_id, 'caisse') then
    raise exception 'not authorized';
  end if;
  if p_opening_float < 0 then
    raise exception 'invalid opening float';
  end if;

  insert into public.caisse_sessions (org_id, store_id, opened_by, opening_float)
  values (p_org_id, p_store_id, auth.uid(), p_opening_float)
  returning id into v_id;

  return v_id;
exception when unique_violation then
  raise exception 'a session is already open for this store';
end;
$$;

create or replace function public.close_caisse_session(p_session_id uuid, p_closing_declared_cash numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.caisse_sessions;
  v_cash_sales numeric(14,2);
  v_cash_in numeric(14,2);
  v_cash_out numeric(14,2);
  v_expected numeric(14,2);
begin
  select * into v_session from public.caisse_sessions where id = p_session_id;
  if v_session is null then
    raise exception 'session not found';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session already closed';
  end if;
  if public.get_my_role(v_session.org_id) not in ('proprietaire','gerant')
     and v_session.opened_by <> auth.uid()
     and not public.has_permission(v_session.org_id, 'caisse') then
    raise exception 'not authorized';
  end if;
  if p_closing_declared_cash < 0 then
    raise exception 'invalid closing amount';
  end if;

  select coalesce(sum(p.amount), 0) into v_cash_sales
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where s.caisse_session_id = p_session_id and p.method = 'cash' and s.status = 'completed';

  select coalesce(sum(case when type = 'in' then amount else 0 end), 0),
         coalesce(sum(case when type = 'out' then amount else 0 end), 0)
    into v_cash_in, v_cash_out
  from public.cash_movements where caisse_session_id = p_session_id;

  v_expected := v_session.opening_float + v_cash_sales + v_cash_in - v_cash_out;

  update public.caisse_sessions
  set status = 'closed',
      closed_by = auth.uid(),
      closed_at = now(),
      closing_declared_cash = p_closing_declared_cash,
      expected_cash = v_expected,
      variance = p_closing_declared_cash - v_expected
  where id = p_session_id;
end;
$$;

revoke execute on function public.open_caisse_session(uuid, uuid, numeric) from public, anon;
grant execute on function public.open_caisse_session(uuid, uuid, numeric) to authenticated;
revoke execute on function public.close_caisse_session(uuid, numeric) from public, anon;
grant execute on function public.close_caisse_session(uuid, numeric) to authenticated;

-- Catalogue (produits/services): role check OR the perm_catalog flag.
drop policy if exists products_write on public.products;
create policy products_write on public.products
  for all
  using (get_my_role(org_id) = any (array['proprietaire','gerant']::app_role[]) or has_permission(org_id, 'catalog'))
  with check (get_my_role(org_id) = any (array['proprietaire','gerant']::app_role[]) or has_permission(org_id, 'catalog'));

drop policy if exists services_write on public.services;
create policy services_write on public.services
  for all
  using (get_my_role(org_id) = any (array['proprietaire','gerant']::app_role[]) or has_permission(org_id, 'catalog'))
  with check (get_my_role(org_id) = any (array['proprietaire','gerant']::app_role[]) or has_permission(org_id, 'catalog'));

-- Factures (annulation de vente) : role check OR the perm_invoices flag.
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_line record;
  v_payment record;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale is null then
    raise exception 'sale not found';
  end if;
  if v_sale.status <> 'completed' then
    raise exception 'sale already voided';
  end if;
  if public.get_my_role(v_sale.org_id) not in ('proprietaire','gerant')
     and not public.has_permission(v_sale.org_id, 'invoices') then
    raise exception 'not authorized';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a reason is required';
  end if;

  for v_line in select * from public.sale_lines where sale_id = p_sale_id and product_id is not null
  loop
    insert into public.stock_movements
      (org_id, store_id, product_id, movement_type, quantity, reference_table, reference_id, created_by, note)
    values
      (v_sale.org_id, v_sale.store_id, v_line.product_id, 'adjustment_in', v_line.quantity,
       'sales', p_sale_id, auth.uid(), 'Annulation vente #' || v_sale.sale_number || ': ' || p_reason);
  end loop;

  if v_sale.customer_id is not null then
    for v_payment in select * from public.payments where sale_id = p_sale_id and method = 'credit'
    loop
      insert into public.customer_credit_movements
        (org_id, customer_id, type, amount, reference_table, reference_id, created_by, note)
      values
        (v_sale.org_id, v_sale.customer_id, 'repayment', v_payment.amount, 'sales', p_sale_id, auth.uid(),
         'Annulation vente #' || v_sale.sale_number || ': ' || p_reason);
    end loop;
  end if;

  update public.sales set status = 'voided', voided_by = auth.uid() where id = p_sale_id;
end;
$$;

revoke execute on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;
