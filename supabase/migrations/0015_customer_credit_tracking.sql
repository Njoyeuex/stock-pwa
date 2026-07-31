create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index customers_org_id_idx on public.customers(org_id);

-- Materialized balance, maintained solely by the trigger below - mirrors the
-- products/product_stock split used for stock.
create table public.customer_credit_balances (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  balance numeric(14,2) not null default 0
);

-- Ledger: append-only, never written directly by clients.
create table public.customer_credit_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  type text not null check (type in ('credit_sale','repayment')),
  amount numeric(14,2) not null check (amount > 0),
  reference_table text,
  reference_id uuid,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index customer_credit_movements_customer_idx on public.customer_credit_movements(customer_id);
create index customer_credit_movements_org_idx on public.customer_credit_movements(org_id);

create or replace function public.apply_credit_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric(14,2);
begin
  v_delta := case when new.type = 'credit_sale' then new.amount else -new.amount end;

  insert into public.customer_credit_balances (customer_id, balance)
  values (new.customer_id, v_delta)
  on conflict (customer_id)
    do update set balance = public.customer_credit_balances.balance + excluded.balance;

  return new;
end;
$$;

create trigger customer_credit_movements_apply
after insert on public.customer_credit_movements
for each row execute function public.apply_credit_movement();

-- Sales can now reference a persistent customer (required for credit sales, so balances
-- can accumulate across multiple purchases); customer_name stays for free-text walk-ins.
alter table public.sales add column customer_id uuid references public.customers(id);

alter table public.customers enable row level security;
alter table public.customer_credit_balances enable row level security;
alter table public.customer_credit_movements enable row level security;

create policy customers_select on public.customers
  for select using (public.is_org_member(org_id));
create policy customers_write on public.customers
  for all using (public.get_my_role(org_id) in ('proprietaire','gerant','caissier','vendeur'))
  with check (public.get_my_role(org_id) in ('proprietaire','gerant','caissier','vendeur'));

create policy customer_credit_balances_select on public.customer_credit_balances
  for select using (exists (
    select 1 from public.customers c
    where c.id = customer_credit_balances.customer_id and public.is_org_member(c.org_id)
  ));
-- No insert/update/delete policy: only the trigger maintains this table.

create policy customer_credit_movements_select on public.customer_credit_movements
  for select using (public.get_my_role(org_id) in ('proprietaire','gerant','caissier','vendeur'));
-- No insert policy: only record_customer_repayment() and create_sale() may write here.

create or replace function public.record_customer_repayment(
  p_customer_id uuid,
  p_amount numeric,
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
  if public.get_my_role(v_org_id) not in ('proprietaire','gerant','caissier','vendeur') then
    raise exception 'not authorized';
  end if;
  if p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  insert into public.customer_credit_movements (org_id, customer_id, type, amount, note, created_by)
  values (v_org_id, p_customer_id, 'repayment', p_amount, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- create_sale now accepts an optional customer_id, required when paying on credit so the
-- debt can be tracked against a persistent customer rather than a free-text name.
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

  if p_payment_method = 'credit' then
    insert into public.customer_credit_movements
      (org_id, customer_id, type, amount, reference_table, reference_id, created_by)
    values
      (p_org_id, p_customer_id, 'credit_sale', v_total, 'sales', v_sale_id, auth.uid());
  end if;

  return v_sale_id;
end;
$$;

revoke execute on function public.record_customer_repayment(uuid, numeric, text) from public, anon;
grant execute on function public.record_customer_repayment(uuid, numeric, text) to authenticated;
revoke execute on function public.apply_credit_movement() from public, anon, authenticated;
