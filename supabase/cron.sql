-- Fast Lane Now — the heartbeat.
--
-- Vercel's Hobby plan can't run a cron job every minute, so the scheduler
-- lives in Postgres instead. pg_cron fires once a minute and pg_net posts to
-- the app, which fetches the price ONCE and fans it out to whoever is due.
--
-- Before running: replace the two placeholders below.
--   <APP_URL>     e.g. https://fastlane-now.vercel.app   (no trailing slash)
--   <CRON_SECRET> the same value as the CRON_SECRET env var in Vercel

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running this file replaces the existing schedule rather than duplicating.
select cron.unschedule('fastlane-tick')
 where exists (select 1 from cron.job where jobname = 'fastlane-tick');

select cron.schedule(
  'fastlane-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := '<APP_URL>/api/cron/tick',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', '<CRON_SECRET>'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Weekly cleanup of dead sessions.
select cron.unschedule('fastlane-purge')
 where exists (select 1 from cron.job where jobname = 'fastlane-purge');

select cron.schedule(
  'fastlane-purge',
  '17 4 * * 0',
  $$ select public.purge_old_subscriptions(); $$
);

-- Useful checks --------------------------------------------------------------
-- Scheduled jobs:
--   select jobid, jobname, schedule, active from cron.job;
-- Recent runs (did it fire, did it error?):
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Recent HTTP responses from the app (status should be 200):
--   select id, status_code, content, created
--     from net._http_response order by created desc limit 20;
