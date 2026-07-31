create extension if not exists moddatetime with schema extensions;

alter table public.products add column updated_at timestamptz not null default now();

create trigger products_set_updated_at
before update on public.products
for each row execute procedure extensions.moddatetime(updated_at);
