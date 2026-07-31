-- Enums
create type public.app_role as enum ('proprietaire','gerant','caissier','vendeur','magasinier');
create type public.store_type as enum ('boutique','depot');

-- Core tenancy tables
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  currency text not null default 'BIF',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type public.store_type not null default 'boutique',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  store_id uuid references public.stores(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships(user_id);
create index memberships_org_id_idx on public.memberships(org_id);
create index stores_org_id_idx on public.stores(org_id);

-- Anti-recursion RLS helper functions (SECURITY DEFINER, owned by postgres -> bypasses RLS internally)
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid() and is_active
  );
$$;

create or replace function public.get_my_role(p_org_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.memberships
  where org_id = p_org_id and user_id = auth.uid() and is_active
  limit 1;
$$;

create or replace function public.has_store_access(p_org_id uuid, p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid() and is_active
      and (store_id is null or store_id = p_store_id)
  );
$$;

revoke execute on function public.is_org_member(uuid) from anon;
revoke execute on function public.get_my_role(uuid) from anon;
revoke execute on function public.has_store_access(uuid, uuid) from anon;

-- Auto-create a profile row whenever a new auth user is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.memberships enable row level security;

create policy organizations_select on public.organizations
  for select using (public.is_org_member(id));
create policy organizations_update on public.organizations
  for update using (public.get_my_role(id) = 'proprietaire')
  with check (public.get_my_role(id) = 'proprietaire');

create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.org_id = m2.org_id
      where m1.user_id = auth.uid() and m1.role = 'proprietaire'
        and m2.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy stores_select on public.stores
  for select using (public.is_org_member(org_id));
create policy stores_write on public.stores
  for all using (public.get_my_role(org_id) = 'proprietaire')
  with check (public.get_my_role(org_id) = 'proprietaire');

create policy memberships_select on public.memberships
  for select using (public.is_org_member(org_id));
create policy memberships_write on public.memberships
  for all using (public.get_my_role(org_id) = 'proprietaire')
  with check (public.get_my_role(org_id) = 'proprietaire');
