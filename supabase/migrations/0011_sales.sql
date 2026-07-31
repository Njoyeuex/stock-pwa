alter table public.stores add column city text;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_number integer not null,
  status text not null default 'completed' check (status in ('completed','voided')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index sales_org_sale_number_idx on public.sales(org_id, sale_number);
create index sales_org_id_idx on public.sales(org_id);
create index sales_created_by_idx on public.sales(created_by);
create index sales_created_at_idx on public.sales(created_at);

create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);

create index sale_lines_sale_id_idx on public.sale_lines(sale_id);

alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;

-- proprietaire/gerant see every sale in the org; caissier/vendeur see only their own.
create policy sales_select on public.sales
  for select using (
    public.get_my_role(org_id) in ('proprietaire','gerant')
    or (public.get_my_role(org_id) in ('caissier','vendeur') and created_by = auth.uid())
  );
-- No insert/update policy: only create_sale() (below) may create sales.

create policy sale_lines_select on public.sale_lines
  for select using (exists (
    select 1 from public.sales s where s.id = sale_lines.sale_id
  ));

create or replace function public.create_sale(
  p_org_id uuid,
  p_store_id uuid,
  p_lines jsonb
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

  select coalesce(max(sale_number), 0) + 1 into v_sale_number
  from public.sales where org_id = p_org_id;

  insert into public.sales (org_id, store_id, sale_number, created_by)
  values (p_org_id, p_store_id, v_sale_number, auth.uid())
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

  return v_sale_id;
end;
$$;

revoke execute on function public.create_sale(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_sale(uuid, uuid, jsonb) to authenticated;
