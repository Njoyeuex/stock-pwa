-- pg_net does not support ALTER EXTENSION ... SET SCHEMA, so moving it out of public
-- (per the database linter's "extension_in_public" advisory) requires a drop/recreate.
-- The net.http_post() function itself lives in its own "net" schema either way, so this
-- has no effect on the cron job that calls it.
drop extension pg_net;
create extension pg_net schema extensions;
