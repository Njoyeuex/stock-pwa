alter table public.suppliers
  add column nif text,
  add column address text,
  drop column email;
