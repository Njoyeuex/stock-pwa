create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  entity_table text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_id_idx on public.audit_log(org_id, created_at desc);

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select using (public.get_my_role(org_id) in ('proprietaire','gerant'));
-- No insert/update/delete policy: only the trigger below writes here.

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_entity_id uuid;
begin
  v_entity_id := coalesce(new.id, old.id);
  v_org_id := coalesce(new.org_id, old.org_id);

  insert into public.audit_log (org_id, user_id, action, entity_table, entity_id, old_data, new_data)
  values (
    v_org_id,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_entity_id,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

revoke execute on function public.log_audit_event() from public, anon, authenticated;

create trigger audit_memberships
after insert or update or delete on public.memberships
for each row execute function public.log_audit_event();

create trigger audit_products
after insert or update or delete on public.products
for each row execute function public.log_audit_event();

create trigger audit_sales
after insert or update or delete on public.sales
for each row execute function public.log_audit_event();

create trigger audit_caisse_sessions
after insert or update or delete on public.caisse_sessions
for each row execute function public.log_audit_event();

create trigger audit_customers
after insert or update or delete on public.customers
for each row execute function public.log_audit_event();

-- Only a gerant/proprietaire may void a sale (a caissier must ask, per the role matrix);
-- reverses the stock movements and, for credit sales, the customer's debt.
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

  for v_line in select * from public.sale_lines where sale_id = p_sale_id
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

revoke execute on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;

-- Cash reconciliation must exclude voided sales from the till, or a voided cash sale
-- would still be counted as money that should be in the drawer.
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
