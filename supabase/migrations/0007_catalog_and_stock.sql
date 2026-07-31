-- Catalog
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  parent_id uuid references public.product_categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete set null,
  sku text,
  barcode text,
  name text not null,
  unit text not null default 'unite',
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  reorder_threshold numeric(14,3) not null default 0 check (reorder_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index products_org_sku_idx on public.products(org_id, sku) where sku is not null;
create unique index products_org_barcode_idx on public.products(org_id, barcode) where barcode is not null;
create index products_org_id_idx on public.products(org_id);
create index product_categories_org_id_idx on public.product_categories(org_id);

-- Cost price kept in a separate table so it can be hidden from caissier/vendeur at the
-- table-privilege level (Postgres RLS can't mask individual columns of a shared row).
create table public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index suppliers_org_id_idx on public.suppliers(org_id);

-- Stock ledger: append-only, never written directly by clients (see RPCs below).
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  movement_type text not null check (movement_type in
    ('purchase_in','sale_out','adjustment_in','adjustment_out','transfer_in','transfer_out')),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2),
  reference_table text,
  reference_id uuid,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index stock_movements_product_store_idx on public.stock_movements(product_id, store_id);
create index stock_movements_org_id_idx on public.stock_movements(org_id);

-- Materialized current quantity, maintained solely by the trigger below.
create table public.product_stock (
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  quantity numeric(14,3) not null default 0,
  primary key (product_id, store_id)
);

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric(14,3);
begin
  v_delta := case
    when new.movement_type in ('purchase_in','adjustment_in','transfer_in') then new.quantity
    else -new.quantity
  end;

  insert into public.product_stock (product_id, store_id, quantity)
  values (new.product_id, new.store_id, v_delta)
  on conflict (product_id, store_id)
    do update set quantity = public.product_stock.quantity + excluded.quantity;

  return new;
end;
$$;

create trigger stock_movements_apply
after insert on public.stock_movements
for each row execute function public.apply_stock_movement();

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  status text not null default 'received' check (status in ('received','cancelled')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);

create index purchases_org_id_idx on public.purchases(org_id);
create index purchase_lines_purchase_id_idx on public.purchase_lines(purchase_id);

-- RLS
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.suppliers enable row level security;
alter table public.stock_movements enable row level security;
alter table public.product_stock enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;

create policy product_categories_select on public.product_categories
  for select using (public.is_org_member(org_id));
create policy product_categories_write on public.product_categories
  for all using (public.get_my_role(org_id) in ('proprietaire','gerant'))
  with check (public.get_my_role(org_id) in ('proprietaire','gerant'));

create policy products_select on public.products
  for select using (public.is_org_member(org_id));
create policy products_write on public.products
  for all using (public.get_my_role(org_id) in ('proprietaire','gerant'))
  with check (public.get_my_role(org_id) in ('proprietaire','gerant'));

create policy product_costs_select on public.product_costs
  for select using (exists (
    select 1 from public.products p
    where p.id = product_costs.product_id
      and public.get_my_role(p.org_id) in ('proprietaire','gerant','magasinier')
  ));
create policy product_costs_write on public.product_costs
  for all using (exists (
    select 1 from public.products p
    where p.id = product_costs.product_id
      and public.get_my_role(p.org_id) in ('proprietaire','gerant')
  ))
  with check (exists (
    select 1 from public.products p
    where p.id = product_costs.product_id
      and public.get_my_role(p.org_id) in ('proprietaire','gerant')
  ));

create policy suppliers_select on public.suppliers
  for select using (public.is_org_member(org_id));
create policy suppliers_write on public.suppliers
  for all using (public.get_my_role(org_id) in ('proprietaire','gerant','magasinier'))
  with check (public.get_my_role(org_id) in ('proprietaire','gerant','magasinier'));

create policy stock_movements_select on public.stock_movements
  for select using (public.get_my_role(org_id) in ('proprietaire','gerant','magasinier'));
-- No insert/update/delete policy: only the SECURITY DEFINER RPCs below may write here.

create policy product_stock_select on public.product_stock
  for select using (exists (
    select 1 from public.products p where p.id = product_stock.product_id and public.is_org_member(p.org_id)
  ));
-- No insert/update/delete policy: only the trigger (SECURITY DEFINER) maintains this table.

create policy purchases_select on public.purchases
  for select using (public.get_my_role(org_id) in ('proprietaire','gerant','magasinier'));
-- No insert policy: only receive_purchase() may create purchases.

create policy purchase_lines_select on public.purchase_lines
  for select using (exists (
    select 1 from public.purchases pu
    where pu.id = purchase_lines.purchase_id
      and public.get_my_role(pu.org_id) in ('proprietaire','gerant','magasinier')
  ));

-- RPCs: the only way to move stock or receive a purchase.
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
  if public.get_my_role(p_org_id) not in ('proprietaire','gerant','magasinier') then
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

create or replace function public.receive_purchase(
  p_org_id uuid,
  p_store_id uuid,
  p_supplier_id uuid,
  p_lines jsonb
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

  insert into public.purchases (org_id, store_id, supplier_id, created_by)
  values (p_org_id, p_store_id, p_supplier_id, auth.uid())
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

  return v_purchase_id;
end;
$$;

revoke execute on function public.adjust_stock(uuid, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.receive_purchase(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.adjust_stock(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.receive_purchase(uuid, uuid, uuid, jsonb) to authenticated;

create view public.low_stock_products
with (security_invoker = true) as
select
  p.org_id,
  ps.store_id,
  ps.product_id,
  p.name,
  p.unit,
  ps.quantity,
  p.reorder_threshold
from public.product_stock ps
join public.products p on p.id = ps.product_id
where ps.quantity <= p.reorder_threshold;
