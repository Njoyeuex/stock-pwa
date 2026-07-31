-- Replaced by an on-demand JSON download (download-backup edge function) triggered
-- by the propriétaire from the app - no more external Google Drive dependency.
select cron.unschedule('weekly-backup-to-drive');

drop function if exists public.trigger_manual_backup();
drop table if exists public.backup_runs;
