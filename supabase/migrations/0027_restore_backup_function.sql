-- Restore business data from a JSON backup produced by download-backup, for disaster
-- recovery (outage / corrupted data). Wipes and reloads every operational table in one
-- transaction (all-or-nothing) so a failure never leaves the database half-restored.
-- organizations and profiles are intentionally left untouched (org identity and auth
-- linkage are out of scope, and touching them risks orphaning auth.users references).
create or replace function public.restore_backup(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships where user_id = auth.uid() and role = 'proprietaire' and is_active
  ) then
    raise exception 'not authorized';
  end if;

  truncate table
    public.audit_log,
    public.cash_movements,
    public.payments,
    public.sale_lines,
    public.sales,
    public.caisse_sessions,
    public.purchase_lines,
    public.purchases,
    public.customer_credit_movements,
    public.customer_credit_balances,
    public.stock_movements,
    public.product_stock,
    public.product_costs,
    public.products,
    public.product_categories,
    public.services,
    public.suppliers,
    public.customers,
    public.memberships,
    public.stores
  cascade;

  insert into public.stores
    select * from jsonb_populate_recordset(null::public.stores, coalesce(p_payload->'stores', '[]'::jsonb));
  insert into public.product_categories
    select * from jsonb_populate_recordset(null::public.product_categories, coalesce(p_payload->'product_categories', '[]'::jsonb));
  insert into public.products
    select * from jsonb_populate_recordset(null::public.products, coalesce(p_payload->'products', '[]'::jsonb));
  insert into public.product_costs
    select * from jsonb_populate_recordset(null::public.product_costs, coalesce(p_payload->'product_costs', '[]'::jsonb));
  insert into public.product_stock
    select * from jsonb_populate_recordset(null::public.product_stock, coalesce(p_payload->'product_stock', '[]'::jsonb));
  insert into public.suppliers
    select * from jsonb_populate_recordset(null::public.suppliers, coalesce(p_payload->'suppliers', '[]'::jsonb));
  insert into public.customers
    select * from jsonb_populate_recordset(null::public.customers, coalesce(p_payload->'customers', '[]'::jsonb));
  insert into public.customer_credit_balances
    select * from jsonb_populate_recordset(null::public.customer_credit_balances, coalesce(p_payload->'customer_credit_balances', '[]'::jsonb));
  insert into public.customer_credit_movements
    select * from jsonb_populate_recordset(null::public.customer_credit_movements, coalesce(p_payload->'customer_credit_movements', '[]'::jsonb));
  insert into public.purchases
    select * from jsonb_populate_recordset(null::public.purchases, coalesce(p_payload->'purchases', '[]'::jsonb));
  insert into public.purchase_lines
    select * from jsonb_populate_recordset(null::public.purchase_lines, coalesce(p_payload->'purchase_lines', '[]'::jsonb));
  insert into public.services
    select * from jsonb_populate_recordset(null::public.services, coalesce(p_payload->'services', '[]'::jsonb));
  insert into public.caisse_sessions
    select * from jsonb_populate_recordset(null::public.caisse_sessions, coalesce(p_payload->'caisse_sessions', '[]'::jsonb));
  insert into public.sales
    select * from jsonb_populate_recordset(null::public.sales, coalesce(p_payload->'sales', '[]'::jsonb));
  insert into public.sale_lines
    select * from jsonb_populate_recordset(null::public.sale_lines, coalesce(p_payload->'sale_lines', '[]'::jsonb));
  insert into public.payments
    select * from jsonb_populate_recordset(null::public.payments, coalesce(p_payload->'payments', '[]'::jsonb));
  insert into public.cash_movements
    select * from jsonb_populate_recordset(null::public.cash_movements, coalesce(p_payload->'cash_movements', '[]'::jsonb));
  insert into public.memberships
    select * from jsonb_populate_recordset(null::public.memberships, coalesce(p_payload->'memberships', '[]'::jsonb));
  insert into public.stock_movements
    select * from jsonb_populate_recordset(null::public.stock_movements, coalesce(p_payload->'stock_movements', '[]'::jsonb));
  insert into public.audit_log
    select * from jsonb_populate_recordset(null::public.audit_log, coalesce(p_payload->'audit_log', '[]'::jsonb));

  -- Never finish a restore that would lock the calling owner out of their own app.
  if not exists (
    select 1 from public.memberships where user_id = auth.uid() and role = 'proprietaire' and is_active
  ) then
    raise exception 'restore would remove your own owner access - aborted';
  end if;
end;
$$;

revoke execute on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
