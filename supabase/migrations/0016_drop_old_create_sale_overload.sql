-- Adding a new parameter via CREATE OR REPLACE created a second overload instead of
-- replacing the function; two overloads with overlapping optional args makes PostgREST's
-- RPC resolution ambiguous, so the old 6-arg version must be dropped explicitly.
drop function if exists public.create_sale(uuid, uuid, jsonb, text, uuid, text);

revoke execute on function public.create_sale(uuid, uuid, jsonb, text, uuid, text, uuid) from public, anon;
grant execute on function public.create_sale(uuid, uuid, jsonb, text, uuid, text, uuid) to authenticated;
