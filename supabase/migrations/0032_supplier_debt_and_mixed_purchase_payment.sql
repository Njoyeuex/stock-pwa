-- Supplier debt ledger (purchase_credit / repayment), mixed cash+credit purchases
-- with a due date on the credit portion, and a supplier-repayment RPC.
-- Mirrors the customer credit system. Full body applied via Supabase migration
-- "supplier_debt_and_mixed_purchase_payment"; see remote for the authoritative copy.
create table public.supplier_credit_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  supplier_id uuid not null references public.suppliers(id),
  type text not null check (type in ('purchase_credit','repayment')),
  amount numeric(14,2) not null check (amount > 0),
  due_date date,
  reference_table text,
  reference_id uuid,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index supplier_credit_movements_supplier_idx on public.supplier_credit_movements(supplier_id);
create index supplier_credit_movements_org_idx on public.supplier_credit_movements(org_id);

create table public.supplier_credit_balances (
  supplier_id uuid primary key references public.suppliers(id),
  balance numeric(14,2) not null default 0
);

create or replace function public.apply_supplier_credit_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_delta numeric(14,2);
begin
  v_delta := case when new.type = 'purchase_credit' then new.amount else -new.amount end;
  insert into public.supplier_credit_balances (supplier_id, balance)
  values (new.supplier_id, v_delta)
  on conflict (supplier_id) do update set balance = public.supplier_credit_balances.balance + excluded.balance;
  return new;
end; $$;
revoke execute on function public.apply_supplier_credit_movement() from public, anon, authenticated;

create trigger trg_apply_supplier_credit_movement
  after insert on public.supplier_credit_movements
  for each row execute function public.apply_supplier_credit_movement();

alter table public.supplier_credit_movements enable row level security;
alter table public.supplier_credit_balances enable row level security;
create policy supplier_credit_movements_select on public.supplier_credit_movements
  for select using (get_my_role(org_id) = any (array['proprietaire','gerant','magasinier']::app_role[]));
create policy supplier_credit_balances_select on public.supplier_credit_balances
  for select using (exists (
    select 1 from public.suppliers s where s.id = supplier_credit_balances.supplier_id
      and get_my_role(s.org_id) = any (array['proprietaire','gerant','magasinier']::app_role[])));
revoke all on public.supplier_credit_movements from anon;
revoke all on public.supplier_credit_balances from anon;

alter table public.purchases
  add column paid_amount numeric(14,2) not null default 0,
  add column credit_amount numeric(14,2) not null default 0,
  add column due_date date;
update public.purchases set paid_amount = total_amount where paid_amount = 0 and total_amount > 0;

-- receive_purchase and record_supplier_repayment: see remote migration for full bodies.
