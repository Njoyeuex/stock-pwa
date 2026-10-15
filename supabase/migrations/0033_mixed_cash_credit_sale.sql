-- Mixed sales: the customer pays part in cash and leaves the rest on credit.
-- p_payment_method 'mixed' + p_cash_amount records two payments (cash and credit),
-- puts the credit part on the customer's account, and needs both an open caisse
-- and a customer. Existing 'cash' / 'credit' calls behave exactly as before.
drop function if exists public.create_sale(uuid, uuid, jsonb, text, uuid, text, uuid);

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
  if public.get_my_role(p_org_id) not in ('proprietaire','gerant','caissier','vendeur') then
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

revoke execute on function public.create_sale(uuid, uuid, jsonb, text, uuid, text, uuid, numeric) from public, anon;
grant execute on function public.create_sale(uuid, uuid, jsonb, text, uuid, text, uuid, numeric) to authenticated;
