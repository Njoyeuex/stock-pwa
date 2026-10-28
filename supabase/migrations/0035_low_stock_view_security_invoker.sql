-- low_stock_products ran with its owner's rights (SECURITY DEFINER behaviour), so it
-- bypassed RLS on products/product_stock: anyone, even anon, could read every org's
-- low-stock rows. Run it as the querying user instead; the existing
-- "is_org_member" policies on both tables then scope it to the user's own org.
alter view public.low_stock_products set (security_invoker = true);

-- The view is read-only for the app: no access for anon, select only for signed-in users.
revoke all on public.low_stock_products from anon;
revoke insert, update, delete, truncate, references, trigger on public.low_stock_products from authenticated;
grant select on public.low_stock_products to authenticated;
