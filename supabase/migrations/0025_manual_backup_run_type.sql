create or replace function public.trigger_manual_backup()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships where user_id = auth.uid() and role = 'proprietaire' and is_active
  ) then
    raise exception 'not authorized';
  end if;

  perform net.http_post(
    url := 'https://pbsxxibkeimbtekfccnb.supabase.co/functions/v1/backup-to-drive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-backup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_trigger_secret')
    ),
    body := jsonb_build_object('run_type', 'manual')
  );
end;
$$;

revoke execute on function public.trigger_manual_backup() from public, anon;
grant execute on function public.trigger_manual_backup() to authenticated;
