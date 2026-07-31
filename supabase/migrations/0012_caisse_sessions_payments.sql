create table public.caisse_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  opened_by uuid not null references auth.users(id),
  opening_float numeric(14,2) not null check (opening_float >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references auth.users(id),
  closing_declared_cash numeric(14,2),
  expected_cash numeric(14,2),
  variance numeric(14,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Only one open session per store at a time.
create unique index caisse_sessions_one_open_per_store
  on public.caisse_sessions(store_id) where status = 'open';
create index caisse_sessions_org_id_idx on public.caisse_sessions(org_id);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  caisse_session_id uuid not null references public.caisse_sessions(id) on delete cascade,
  type text not null check (type in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index cash_movements_session_idx on public.cash_movements(caisse_session_id);

alter table public.sales add column caisse_session_id uuid references public.caisse_sessions(id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  method text not null check (method in ('cash','mobile_money','card')),
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index payments_sale_id_idx on public.payments(sale_id);

alter table public.caisse_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.payments enable row level security;

create policy caisse_sessions_select on public.caisse_sessions
  for select using (
    public.get_my_role(org_id) in ('proprietaire','gerant')
    or opened_by = auth.uid()
  );
-- No insert/update policy: only the RPCs below may open/close a session.

create policy cash_movements_select on public.cash_movements
  for select using (exists (
    select 1 from public.caisse_sessions cs
    where cs.id = cash_movements.caisse_session_id
      and (public.get_my_role(cs.org_id) in ('proprietaire','gerant') or cs.opened_by = auth.uid())
  ));
-- No insert policy: only record_cash_movement() may write here.

create policy payments_select on public.payments
  for select using (exists (
    select 1 from public.sales s where s.id = payments.sale_id
  ));
-- No insert policy: only create_sale() may write here.

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
  if public.get_my_role(p_org_id) not in ('proprietaire','gerant','caissier') then
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
  if public.get_my_role(v_session.org_id) not in ('proprietaire','gerant')
     and v_session.opened_by <> auth.uid() then
    raise exception 'not authorized';
  end if;
  if p_closing_declared_cash < 0 then
    raise exception 'invalid closing amount';
  end if;

  select coalesce(sum(p.amount), 0) into v_cash_sales
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where s.caisse_session_id = p_session_id and p.method = 'cash';

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
  if public.get_my_role(v_session.org_id) not in ('proprietaire','gerant')
     and v_session.opened_by <> auth.uid() then
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

-- create_sale now records a payment and can attach to an open caisse session; the argument
-- list changed so the old 3-arg version must be dropped explicitly rather than replaced.
drop function if exists public.create_sale(uuid, uuid, jsonb);

create function public.create_sale(
  p_org_id uuid,
  p_store_id uuid,
  p_lines jsonb,
  p_payment_method text default 'cash',
  p_caisse_session_id uuid default null
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

  insert into public.sales (org_id, store_id, sale_number, created_by, caisse_session_id)
  values (p_org_id, p_store_id, v_sale_number, auth.uid(), p_caisse_session_id)
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

revoke execute on function public.open_caisse_session(uuid, uuid, numeric) from public, anon;
revoke execute on function public.close_caisse_session(uuid, numeric) from public, anon;
revoke execute on function public.record_cash_movement(uuid, text, numeric, text) from public, anon;
revoke execute on function public.create_sale(uuid, uuid, jsonb, text, uuid) from public, anon;

grant execute on function public.open_caisse_session(uuid, uuid, numeric) to authenticated;
grant execute on function public.close_caisse_session(uuid, numeric) to authenticated;
grant execute on function public.record_cash_movement(uuid, text, numeric, text) to authenticated;
grant execute on function public.create_sale(uuid, uuid, jsonb, text, uuid) to authenticated;
