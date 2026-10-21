-- Total value of the stock on hand, for every member of the organization.
-- Returns only org-wide totals: caissier/vendeur still cannot read individual
-- cost prices (product_costs stays locked down), they only see the sum.
create or replace function public.get_inventory_value(p_org_id uuid)
returns table (cost_value numeric, sale_value numeric, products_in_stock integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(s.qty * coalesce(pc.cost_price, 0)), 0)::numeric(14,2) as cost_value,
    coalesce(sum(s.qty * p.sale_price), 0)::numeric(14,2) as sale_value,
    count(*)::integer as products_in_stock
  from (
    select ps.product_id, sum(ps.quantity) as qty
    from public.product_stock ps
    group by ps.product_id
  ) s
  join public.products p on p.id = s.product_id
  left join public.product_costs pc on pc.product_id = p.id
  where p.org_id = p_org_id
    and s.qty > 0
    and public.is_org_member(p_org_id);
$$;

revoke execute on function public.get_inventory_value(uuid) from public, anon;
grant execute on function public.get_inventory_value(uuid) to authenticated;
