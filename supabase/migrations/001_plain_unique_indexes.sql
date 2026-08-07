-- Fast Lane Now — migration 001: make the unique indexes non-partial.
--
-- Run this once, in the Supabase SQL Editor, on any database created before
-- this migration existed. Databases built from the current schema.sql already
-- have it. Safe to re-run.
--
-- Why: the indexes were created as partial (`where endpoint is not null`).
-- Postgres only infers a partial unique index for ON CONFLICT if the statement
-- repeats the index predicate, and PostgREST — which is what supabase-js
-- .upsert() talks to — never emits one. So every /api/subscribe call failed
-- with SQLSTATE 42P10, "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification", and the app answered `storage_failed`.
--
-- Dropping the predicate loses nothing: a plain unique index already permits
-- any number of NULLs, because NULL is never equal to NULL. Telegram rows
-- (endpoint NULL) and web push rows (telegram_chat_id NULL) coexist exactly as
-- they did before.

drop index if exists public.subscriptions_endpoint_key;
drop index if exists public.subscriptions_telegram_key;

create unique index if not exists subscriptions_endpoint_key
  on public.subscriptions (endpoint);

create unique index if not exists subscriptions_telegram_key
  on public.subscriptions (telegram_chat_id);
