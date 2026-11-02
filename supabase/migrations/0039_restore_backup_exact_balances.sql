-- restore_backup (0027) reloaded the saved stock and credit balances first and the
-- movements after, and the movement triggers added every quantity again: after a
-- restore, stock and customer credit were counted twice. It also inserted purchases
-- before the caisse sessions they can reference (0029), so a backup holding a purchase
-- paid from the caisse could not be restored at all, and supplier debts (0032) were
-- wiped by the cascade but never reloaded.
-- Rows now go in parents first; the movements rebuild the balances through their
-- triggers, and the saved balances then replace what was rebuilt, so the result is
-- exactly the backup. The audit rows that the insert triggers write during the reload
-- are dropped for the saved journal, plus one entry recording the restore.
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
    public.supplier_credit_movements,
    public.supplier_credit_balances,
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
  insert into public.services
    select * from jsonb_populate_recordset(null::public.services, coalesce(p_payload->'services', '[]'::jsonb));
  insert into public.suppliers
    select * from jsonb_populate_recordset(null::public.suppliers, coalesce(p_payload->'suppliers', '[]'::jsonb));
  insert into public.customers
    select * from jsonb_populate_recordset(null::public.customers, coalesce(p_payload->'customers', '[]'::jsonb));
  insert into public.memberships
    select * from jsonb_populate_recordset(null::public.memberships, coalesce(p_payload->'memberships', '[]'::jsonb));
  insert into public.caisse_sessions
    select * from jsonb_populate_recordset(null::public.caisse_sessions, coalesce(p_payload->'caisse_sessions', '[]'::jsonb));
  insert into public.purchases
    select * from jsonb_populate_recordset(null::public.purchases, coalesce(p_payload->'purchases', '[]'::jsonb));
  insert into public.purchase_lines
    select * from jsonb_populate_recordset(null::public.purchase_lines, coalesce(p_payload->'purchase_lines', '[]'::jsonb));
  insert into public.sales
    select * from jsonb_populate_recordset(null::public.sales, coalesce(p_payload->'sales', '[]'::jsonb));
  insert into public.sale_lines
    select * from jsonb_populate_recordset(null::public.sale_lines, coalesce(p_payload->'sale_lines', '[]'::jsonb));
  insert into public.payments
    select * from jsonb_populate_recordset(null::public.payments, coalesce(p_payload->'payments', '[]'::jsonb));
  insert into public.cash_movements
    select * from jsonb_populate_recordset(null::public.cash_movements, coalesce(p_payload->'cash_movements', '[]'::jsonb));
  insert into public.stock_movements
    select * from jsonb_populate_recordset(null::public.stock_movements, coalesce(p_payload->'stock_movements', '[]'::jsonb));
  insert into public.customer_credit_movements
    select * from jsonb_populate_recordset(null::public.customer_credit_movements, coalesce(p_payload->'customer_credit_movements', '[]'::jsonb));
  insert into public.supplier_credit_movements
    select * from jsonb_populate_recordset(null::public.supplier_credit_movements, coalesce(p_payload->'supplier_credit_movements', '[]'::jsonb));

  -- The saved balances replace what the movement triggers just rebuilt. A backup made
  -- before supplier debts were exported has no supplier_credit_balances: keep the
  -- rebuilt ones then. (truncate, not delete: the API's safeupdate rejects a bare
  -- delete, even inside a function.)
  if jsonb_typeof(p_payload->'product_stock') = 'array' then
    truncate table public.product_stock;
    insert into public.product_stock
      select * from jsonb_populate_recordset(null::public.product_stock, p_payload->'product_stock');
  end if;
  if jsonb_typeof(p_payload->'customer_credit_balances') = 'array' then
    truncate table public.customer_credit_balances;
    insert into public.customer_credit_balances
      select * from jsonb_populate_recordset(null::public.customer_credit_balances, p_payload->'customer_credit_balances');
  end if;
  if jsonb_typeof(p_payload->'supplier_credit_balances') = 'array' then
    truncate table public.supplier_credit_balances;
    insert into public.supplier_credit_balances
      select * from jsonb_populate_recordset(null::public.supplier_credit_balances, p_payload->'supplier_credit_balances');
  end if;

  -- Never finish a restore that would lock the calling owner out of their own app.
  if not exists (
    select 1 from public.memberships where user_id = auth.uid() and role = 'proprietaire' and is_active
  ) then
    raise exception 'restore would remove your own owner access - aborted';
  end if;

  -- The insert triggers logged every reloaded row as new: keep the saved journal instead,
  -- and record the restore itself.
  truncate table public.audit_log;
  insert into public.audit_log
    select * from jsonb_populate_recordset(null::public.audit_log, coalesce(p_payload->'audit_log', '[]'::jsonb));
  insert into public.audit_log (org_id, user_id, action, entity_table)
    select org_id, auth.uid(), 'backup_restored', 'backup' from public.memberships
    where user_id = auth.uid() and role = 'proprietaire' and is_active
    limit 1;
end;
$$;
