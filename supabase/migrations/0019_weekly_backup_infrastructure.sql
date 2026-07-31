create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null default 'scheduled' check (run_type in ('scheduled','manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed')),
  drive_file_id text,
  error_message text
);

create index backup_runs_started_at_idx on public.backup_runs(started_at desc);

alter table public.backup_runs enable row level security;

-- Backups span every organization on this project, so visibility is intentionally not
-- org-scoped like the rest of the schema: only a proprietaire may view backup history,
-- and only the service_role (bypassing RLS) writes to this table.
create policy backup_runs_select on public.backup_runs
  for select using (
    exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.role = 'proprietaire' and m.is_active)
  );

-- Shared secret the weekly cron job sends to the backup-to-drive Edge Function so it can't
-- be triggered by anyone else; stored in Vault rather than inline in the cron job body.
select vault.create_secret(
  'c543df27c7eb1e82af1fbe7385670a725c4b544a95b35b3764f42130601854a3',
  'backup_trigger_secret',
  'Shared secret sent by the weekly pg_cron job to authenticate calls to backup-to-drive'
);

select cron.schedule(
  'weekly-backup-to-drive',
  '0 2 * * 0',
  $$
  select net.http_post(
    url := 'https://pbsxxibkeimbtekfccnb.supabase.co/functions/v1/backup-to-drive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-backup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_trigger_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
