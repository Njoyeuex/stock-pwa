-- 1. Remove the three empty organizations left over from repeated onboarding tests.
--    Verified beforehand: no store, product, sale, purchase, movement or audit row
--    belongs to any of them - only the owner's own membership.
delete from public.memberships
where org_id in (
  '2c0524c6-c2bf-45cb-a850-06d014efea8e',
  'dfcd9045-a6ab-4a52-8247-9388f6853ac3',
  'ca61a5b0-ae85-4d1e-a879-dc65c49c0df8'
);

delete from public.organizations
where id in (
  '2c0524c6-c2bf-45cb-a850-06d014efea8e',
  'dfcd9045-a6ab-4a52-8247-9388f6853ac3',
  'ca61a5b0-ae85-4d1e-a879-dc65c49c0df8'
);

-- 2. Single-store deployment: nobody should be able to spin up a parallel
--    organization. Accounts are created by the owner through admin-create-user,
--    which inserts the membership directly.
revoke execute on function public.bootstrap_organization(text, text) from public, anon, authenticated;

-- 3. Defense in depth: RLS already blocks anonymous visitors on every table, but
--    Supabase's default table-level GRANTs to `anon` mean a future table created
--    without RLS would be world-readable. Remove the grants so RLS is not the
--    only thing standing in the way.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 4. The receipt header prints the organization name, which still carried the
--    default "<user>'s Org" placeholder.
update public.organizations set name = 'Magasin Manariyo' where slug = 'boutique-de-1bijou';
