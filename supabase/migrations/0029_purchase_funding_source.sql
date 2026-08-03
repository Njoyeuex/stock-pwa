-- Where the money for a purchase comes from: straight from the till (caisse), which
-- must then reflect the outflow, or from somewhere else (bank transfer, owner's own
-- funds, etc.) that doesn't touch the caisse's cash balance.
alter table public.purchases
  add column payment_source text not null default 'other' check (payment_source in ('caisse', 'other')),
  add column caisse_session_id uuid references public.caisse_sessions(id);

create or replace function public.receive_purchase(
  p_org_id uuid,
  p_store_id uuid,
  p_supplier_id uuid,
  p_lines jsonb,
  p_payment_source text default 'other',
  p_caisse_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_total numeric(14,2) := 0;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_existing_qty numeric;
  v_existing_cost numeric;
  v_new_cost numeric;
begin
  if public.get_my_role(p_org_id) not in ('proprietaire','gerant','magasinier') then
    raise exception 'not authorized';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid purchase lines';
  end if;

  if p_payment_source not in ('caisse', 'other') then
    raise exception 'invalid payment source';
  end if;

  if p_payment_source = 'caisse' then
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

  insert into public.purchases (org_id, store_id, supplier_id, created_by, payment_source, caisse_session_id)
  values (p_org_id, p_store_id, p_supplier_id, auth.uid(), p_payment_source, p_caisse_session_id)
  returning id into v_purchase_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;

    if v_product_id is null or v_qty is null or v_qty <= 0 or v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'invalid purchase line values';
    end if;

    v_line_total := v_qty * v_unit_cost;
    v_total := v_total + v_line_total;

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

  if p_payment_source = 'caisse' then
    insert into public.cash_movements (caisse_session_id, type, amount, reason, created_by)
    values (p_caisse_session_id, 'out', v_total, 'Achat', auth.uid());
  end if;

  return v_purchase_id;
end;
$$;

drop function if exists public.receive_purchase(uuid, uuid, uuid, jsonb);
revoke execute on function public.receive_purchase(uuid, uuid, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.receive_purchase(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
