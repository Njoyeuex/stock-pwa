alter table public.sales add column customer_name text;

drop function if exists public.create_sale(uuid, uuid, jsonb, text, uuid);

create function public.create_sale(
  p_org_id uuid,
  p_store_id uuid,
  p_lines jsonb,
  p_payment_method text default 'cash',
  p_caisse_session_id uuid default null,
  p_customer_name text default null
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

  if p_payment_method not in ('cash','mobile_money','card') then
    raise exception 'invalid payment method';
  end if;

  select coalesce(max(sale_number), 0) + 1 into v_sale_number
  from public.sales where org_id = p_org_id;

  insert into public.sales (org_id, store_id, sale_number, created_by, caisse_session_id, customer_name)
  values (p_org_id, p_store_id, v_sale_number, auth.uid(), p_caisse_session_id, nullif(trim(p_customer_name), ''))
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;

    if v_product_id is null or v_qty is null or v_qty <= 0 or v_unit_price is null or v_unit_price < 0 then
      raise exception 'invalid sale line values';
    end if;

    v_line_total := v_qty * v_unit_price;
    v_total := v_total + v_line_total;

    insert into public.sale_lines (sale_id, product_id, quantity, unit_price, line_total)
    values (v_sale_id, v_product_id, v_qty, v_unit_price, v_line_total);

    insert into public.stock_movements
      (org_id, store_id, product_id, movement_type, quantity, reference_table, reference_id, created_by)
    values
      (p_org_id, p_store_id, v_product_id, 'sale_out', v_qty, 'sales', v_sale_id, auth.uid());
  end loop;

  update public.sales set total_amount = v_total where id = v_sale_id;

  insert into public.payments (sale_id, method, amount) values (v_sale_id, p_payment_method, v_total);

  return v_sale_id;
end;
$$;

revoke execute on function public.create_sale(uuid, uuid, jsonb, text, uuid, text) from public, anon;
grant execute on function public.create_sale(uuid, uuid, jsonb, text, uuid, text) to authenticated;
