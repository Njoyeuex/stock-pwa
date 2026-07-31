alter table public.sale_lines alter column product_id drop not null;
alter table public.sale_lines add column service_id uuid references public.services(id);
alter table public.sale_lines add constraint sale_lines_product_xor_service
  check ((product_id is not null and service_id is null) or (product_id is null and service_id is not null));

create or replace function public.create_sale(
  p_org_id uuid,
  p_store_id uuid,
  p_lines jsonb,
  p_payment_method text default 'cash',
  p_caisse_session_id uuid default null,
  p_customer_name text default null,
  p_customer_id uuid default null
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
begin
  if public.get_my_role(p_org_id) not in ('proprietaire','gerant','caissier','vendeur') then
    raise exception 'not authorized';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid sale lines';
  end if;

  if p_payment_method not in ('cash','credit') then
    raise exception 'invalid payment method';
  end if;

  if p_payment_method = 'credit' then
    if p_customer_id is null then
      raise exception 'customer is required for credit sales';
    end if;
    if not exists (select 1 from public.customers where id = p_customer_id and org_id = p_org_id) then
      raise exception 'customer not found';
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

  insert into public.payments (sale_id, method, amount) values (v_sale_id, p_payment_method, v_total);

  if p_payment_method = 'credit' then
    insert into public.customer_credit_movements
      (org_id, customer_id, type, amount, reference_table, reference_id, created_by)
    values
      (p_org_id, p_customer_id, 'credit_sale', v_total, 'sales', v_sale_id, auth.uid());
  end if;

  return v_sale_id;
end;
$$;

-- void_sale must only restore stock for product lines (services have none).
create or replace function public.void_sale(
  p_sale_id uuid,
  p_reason text
)
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
  if public.get_my_role(v_sale.org_id) not in ('proprietaire','gerant') then
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
