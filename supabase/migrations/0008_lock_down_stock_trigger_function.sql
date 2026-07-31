-- Same pattern as handle_new_user: this fires only via the stock_movements trigger,
-- never called directly by any role.
revoke execute on function public.apply_stock_movement() from public, anon, authenticated;
