-- 1. Ten RPCs guarded themselves with
--      if public.get_my_role(org) not in (...) then raise exception 'not authorized';
--    get_my_role() is NULL for anyone who is not an active member of that org, and
--    NULL not in (...) is NULL, so the check let them through: until 0036 that meant
--    anon, and it still meant any signed-in account without a membership. Every
--    check now fails closed (no role = not authorized), and opened_by <> auth.uid()
--    becomes "is distinct from" for the same reason. The bodies are otherwise
--    unchanged; create or replace keeps the grants set by 0036.

create or replace function public.adjust_stock(
  p_org_id uuid,
  p_store_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_type text;
  v_movement_id uuid;
begin
  if not coalesce(public.get_my_role(p_org_id) in ('proprietaire','gerant','magasinier'), false) then
    raise exception 'not authorized';
  end if;

  if p_quantity_delta = 0 then
    raise exception 'quantity delta must not be zero';
  end if;

  v_movement_type := case when p_quantity_delta > 0 then 'adjustment_in' else 'adjustment_out' end;

  insert into public.stock_movements (org_id, store_id, product_id, movement_type, quantity, note, created_by)
  values (p_org_id, p_store_id, p_product_id, v_movement_type, abs(p_quantity_delta), p_note, auth.uid())
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

create or replace function public.close_caisse_session(
  p_session_id uuid,
  p_closing_declared_cash numeric
)
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
  if not coalesce(public.get_my_role(v_session.org_id) in ('proprietaire','gerant'), false)
     and v_session.opened_by is distinct from auth.uid()
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

create or replace function public.create_sale(
  p_org_id uuid,
  p_store_id uuid,
  p_lines jsonb,
  p_payment_method text default 'cash',
  p_caisse_session_id uuid default null,
  p_customer_name text default null,
  p_customer_id uuid default null,
  p_cash_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale_number integer;
  v_total numeric(14,2) := 0;
  v_line jsonb;
  v_product_id uuid;
  v_service_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_cash_part numeric(14,2);
  v_credit_part numeric(14,2);
begin
  if not coalesce(public.get_my_role(p_org_id) in ('proprietaire','gerant','caissier','vendeur'), false) then
    raise exception 'not authorized';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid sale lines';
  end if;

  if p_payment_method not in ('cash','credit','mixed') then
    raise exception 'invalid payment method';
  end if;

  if p_payment_method in ('credit','mixed') then
    if p_customer_id is null then
      raise exception 'customer is required for credit sales';
    end if;
    if not exists (select 1 from public.customers where id = p_customer_id and org_id = p_org_id) then
      raise exception 'customer not found';
    end if;
  end if;

  if p_payment_method in ('cash','mixed') then
    if p_caisse_session_id is null then
      raise exception 'a caisse session must be open for cash sales';
    end if;
    if not exists (
      select 1 from public.caisse_sessions
      where id = p_caisse_session_id and org_id = p_org_id and store_id = p_store_id and status = 'open'
    ) then
      raise exception 'the caisse session is not open';
    end if;
  end if;

  select coalesce(max(sale_number), 0) + 1 into v_sale_number
  from public.sales where org_id = p_org_id;

  insert into public.sales (org_id, store_id, sale_number, created_by, caisse_session_id, customer_name, customer_id)
  values (p_org_id, p_store_id, v_sale_number, auth.uid(), p_caisse_session_id, nullif(trim(p_customer_name), ''), p_customer_id)
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := nullif(v_line->>'product_id', '')::uuid;
    v_service_id := nullif(v_line->>'service_id', '')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;

    if (v_product_id is null) = (v_service_id is null) then
      raise exception 'each line must reference exactly one product or service';
    end if;
    if v_qty is null or v_qty <= 0 or v_unit_price is null or v_unit_price < 0 then
      raise exception 'invalid sale line values';
    end if;

    v_line_total := v_qty * v_unit_price;
    v_total := v_total + v_line_total;

    insert into public.sale_lines (sale_id, product_id, service_id, quantity, unit_price, line_total)
    values (v_sale_id, v_product_id, v_service_id, v_qty, v_unit_price, v_line_total);

    if v_product_id is not null then
      insert into public.stock_movements
        (org_id, store_id, product_id, movement_type, quantity, reference_table, reference_id, created_by)
      values
        (p_org_id, p_store_id, v_product_id, 'sale_out', v_qty, 'sales', v_sale_id, auth.uid());
    end if;
  end loop;

  update public.sales set total_amount = v_total where id = v_sale_id;

  v_cash_part := case p_payment_method when 'cash' then v_total when 'credit' then 0 else p_cash_amount end;
  if p_payment_method = 'mixed' and (v_cash_part is null or v_cash_part <= 0 or v_cash_part >= v_total) then
    raise exception 'invalid cash amount for mixed payment';
  end if;
  v_credit_part := v_total - v_cash_part;

  if v_cash_part > 0 or p_payment_method = 'cash' then
    insert into public.payments (sale_id, method, amount) values (v_sale_id, 'cash', v_cash_part);
  end if;

  if v_credit_part > 0 or p_payment_method = 'credit' then
    insert into public.payments (sale_id, method, amount) values (v_sale_id, 'credit', v_credit_part);
  end if;

  if v_credit_part > 0 then
    insert into public.customer_credit_movements
      (org_id, customer_id, type, amount, reference_table, reference_id, created_by)
    values
      (p_org_id, p_customer_id, 'credit_sale', v_credit_part, 'sales', v_sale_id, auth.uid());
  end if;

  return v_sale_id;
end;
$$;

create or replace function public.delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.products where id = p_product_id;
  if v_org_id is null then
    raise exception 'product not found';
  end if;

  if not coalesce(public.get_my_role(v_org_id) in ('proprietaire','gerant'), false) then
    raise exception 'not authorized';
  end if;

  update public.products set is_active = false where id = p_product_id;
  delete from public.product_stock where product_id = p_product_id;
end;
$$;

create or replace function public.open_caisse_session(
  p_org_id uuid,
  p_store_id uuid,
  p_opening_float numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.get_my_role(p_org_id) in ('proprietaire','gerant','caissier'), false)
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

create or replace function public.receive_purchase(
  p_org_id uuid,
  p_store_id uuid,
  p_supplier_id uuid,
  p_lines jsonb,
  p_paid_source text default 'other',
  p_caisse_session_id uuid default null,
  p_credit_amount numeric default 0,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_total numeric(14,2) := 0;
  v_paid numeric(14,2);
  v_credit numeric(14,2) := coalesce(p_credit_amount, 0);
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_existing_qty numeric;
  v_existing_cost numeric;
  v_new_cost numeric;
begin
  if not coalesce(public.get_my_role(p_org_id) in ('proprietaire','gerant','magasinier'), false) then
    raise exception 'not authorized';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid purchase lines';
  end if;

  if p_paid_source not in ('caisse','other') then
    raise exception 'invalid payment source';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := (v_line->>'quantity')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;
    if v_qty is null or v_qty <= 0 or v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'invalid purchase line values';
    end if;
    v_total := v_total + v_qty * v_unit_cost;
  end loop;

  if v_credit < 0 or v_credit > v_total then
    raise exception 'invalid credit amount';
  end if;
  v_paid := v_total - v_credit;

  if v_credit > 0 then
    if p_supplier_id is null then
      raise exception 'supplier is required for a credit purchase';
    end if;
    if p_due_date is null then
      raise exception 'a due date is required for the credit portion';
    end if;
  end if;

  if p_paid_source = 'caisse' and v_paid > 0 then
    if p_caisse_session_id is null then
      raise exception 'a caisse session must be open to pay from the caisse';
    end if;
    if not exists (
      select 1 from public.caisse_sessions
      where id = p_caisse_session_id and org_id = p_org_id and store_id = p_store_id and status = 'open'
    ) then
      raise exception 'the caisse session is not open';
    end if;
  end if;

  insert into public.purchases
    (org_id, store_id, supplier_id, created_by, payment_source, caisse_session_id,
     paid_amount, credit_amount, due_date)
  values
    (p_org_id, p_store_id, p_supplier_id, auth.uid(), p_paid_source, p_caisse_session_id,
     v_paid, v_credit, case when v_credit > 0 then p_due_date else null end)
  returning id into v_purchase_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;

    if v_product_id is null then
      raise exception 'invalid purchase line values';
    end if;

    v_line_total := v_qty * v_unit_cost;

    select ps.quantity into v_existing_qty from public.product_stock ps
      where ps.product_id = v_product_id and ps.store_id = p_store_id;
    v_existing_qty := coalesce(v_existing_qty, 0);
    select pc.cost_price into v_existing_cost from public.product_costs pc where pc.product_id = v_product_id;

    insert into public.purchase_lines (purchase_id, product_id, quantity, unit_cost, line_total)
    values (v_purchase_id, v_product_id, v_qty, v_unit_cost, v_line_total);

    insert into public.stock_movements
      (org_id, store_id, product_id, movement_type, quantity, unit_cost, reference_table, reference_id, created_by)
    values
      (p_org_id, p_store_id, v_product_id, 'purchase_in', v_qty, v_unit_cost, 'purchases', v_purchase_id, auth.uid());

    v_new_cost := case
      when v_existing_cost is null then v_unit_cost
      else (v_existing_qty * v_existing_cost + v_qty * v_unit_cost) / (v_existing_qty + v_qty)
    end;

    insert into public.product_costs (product_id, cost_price)
    values (v_product_id, v_new_cost)
    on conflict (product_id) do update set cost_price = excluded.cost_price, updated_at = now();
  end loop;

  update public.purchases set total_amount = v_total where id = v_purchase_id;

  if p_paid_source = 'caisse' and v_paid > 0 then
    insert into public.cash_movements (caisse_session_id, type, amount, reason, created_by)
    values (p_caisse_session_id, 'out', v_paid, 'Achat', auth.uid());
  end if;

  if v_credit > 0 then
    insert into public.supplier_credit_movements
      (org_id, supplier_id, type, amount, due_date, reference_table, reference_id, created_by)
    values
      (p_org_id, p_supplier_id, 'purchase_credit', v_credit, p_due_date, 'purchases', v_purchase_id, auth.uid());
  end if;

  return v_purchase_id;
end;
$$;

create or replace function public.record_cash_movement(
  p_session_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.caisse_sessions;
  v_id uuid;
begin
  select * into v_session from public.caisse_sessions where id = p_session_id;
  if v_session is null or v_session.status <> 'open' then
    raise exception 'session not open';
  end if;
  if not coalesce(public.get_my_role(v_session.org_id) in ('proprietaire','gerant'), false)
     and v_session.opened_by is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;
  if p_type not in ('in','out') then
    raise exception 'invalid type';
  end if;
  if p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  insert into public.cash_movements (caisse_session_id, type, amount, reason, created_by)
  values (p_session_id, p_type, p_amount, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_customer_repayment(
  p_customer_id uuid,
  p_amount numeric,
  p_caisse_session_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_id uuid;
begin
  select org_id into v_org_id from public.customers where id = p_customer_id;
  if v_org_id is null then
    raise exception 'customer not found';
  end if;
  if not coalesce(public.get_my_role(v_org_id) in ('proprietaire','gerant','caissier','vendeur'), false) then
    raise exception 'not authorized';
  end if;
  if p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  if p_caisse_session_id is null or not exists (
    select 1 from public.caisse_sessions
    where id = p_caisse_session_id and org_id = v_org_id and status = 'open'
  ) then
    raise exception 'a caisse session must be open to record a repayment';
  end if;

  insert into public.cash_movements (caisse_session_id, type, amount, reason, created_by)
  values (p_caisse_session_id, 'in', p_amount, 'Remboursement client', auth.uid());

  insert into public.customer_credit_movements (org_id, customer_id, type, amount, note, created_by)
  values (v_org_id, p_customer_id, 'repayment', p_amount, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_supplier_repayment(
  p_supplier_id uuid,
  p_amount numeric,
  p_from_caisse boolean default false,
  p_caisse_session_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_id uuid;
begin
  select org_id into v_org_id from public.suppliers where id = p_supplier_id;
  if v_org_id is null then
    raise exception 'supplier not found';
  end if;
  if not coalesce(public.get_my_role(v_org_id) in ('proprietaire','gerant','magasinier'), false) then
    raise exception 'not authorized';
  end if;
  if p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  if p_from_caisse then
    if p_caisse_session_id is null then
      raise exception 'a caisse session must be open to pay from the caisse';
    end if;
    select store_id into v_store_id from public.caisse_sessions
      where id = p_caisse_session_id and org_id = v_org_id and status = 'open';
    if v_store_id is null then
      raise exception 'the caisse session is not open';
    end if;

    insert into public.cash_movements (caisse_session_id, type, amount, reason, created_by)
    values (p_caisse_session_id, 'out', p_amount, 'Remboursement fournisseur', auth.uid());
  end if;

  insert into public.supplier_credit_movements (org_id, supplier_id, type, amount, note, created_by)
  values (v_org_id, p_supplier_id, 'repayment', p_amount, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

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
  if not coalesce(public.get_my_role(v_sale.org_id) in ('proprietaire','gerant'), false)
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

-- 2. Table grants to anon came back outside the migrations, like the function grants
--    fixed in 0036, undoing 0031. RLS still hid every row, but anon has no business
--    with any table here: sign-in goes through auth-login, and product photos are
--    served from the public storage bucket, not from these tables.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
