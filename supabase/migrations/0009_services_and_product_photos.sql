-- Services: any billable service rendered that isn't a physical stock item
-- (e.g. repair, delivery, labor). Same tenancy/permission model as products.
create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  price numeric(14,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index services_org_id_idx on public.services(org_id);

alter table public.services enable row level security;

create policy services_select on public.services
  for select using (public.is_org_member(org_id));
create policy services_write on public.services
  for all using (public.get_my_role(org_id) in ('proprietaire','gerant'))
  with check (public.get_my_role(org_id) in ('proprietaire','gerant'));

-- Product photo: stored as a path in the product-images bucket, resolved to a public URL
-- client-side. Photos aren't sensitive data, so the bucket is public for simplicity.
alter table public.products add column image_path text;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Path convention: {org_id}/{product_id}.{ext} - lets policies scope by org from the path.
create policy product_images_select on storage.objects
  for select using (
    bucket_id = 'product-images'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy product_images_write on storage.objects
  for all using (
    bucket_id = 'product-images'
    and public.get_my_role(((storage.foldername(name))[1])::uuid) in ('proprietaire','gerant')
  )
  with check (
    bucket_id = 'product-images'
    and public.get_my_role(((storage.foldername(name))[1])::uuid) in ('proprietaire','gerant')
  );
