-- Fast Lane Now — database schema.
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- subscriptions: one row per active alert session.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  -- 'webpush' today; 'telegram' is wired in the notifier and ready to enable.
  channel            text not null default 'webpush'
                       check (channel in ('webpush', 'telegram')),

  -- Web Push credentials (PushSubscription.toJSON()).
  endpoint           text,
  p256dh             text,
  auth               text,

  -- Telegram credentials.
  telegram_chat_id   text,

  locale             text not null default 'he' check (locale in ('he', 'en')),

  -- What this session is waiting for.
  --   'interval' — a price every interval_minutes, the original behaviour.
  --   'target'   — one alert once the price holds at or under target_price.
  --   'drop'     — one alert once the price has been falling and staying down.
  -- Watches are evaluated every minute (interval_minutes = 1) and end when
  -- they fire, so the two watch modes never send twice.
  mode               text not null default 'interval'
                       check (mode in ('interval', 'target', 'drop')),
  target_price       numeric check (target_price > 0),
  -- How long the condition must hold before it counts. Null for 'interval'.
  stability_minutes  int check (stability_minutes between 1 and 60),

  interval_minutes   int  not null check (interval_minutes between 1 and 60),
  only_on_change     boolean not null default false,
  active             boolean not null default true,

  started_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  next_run_at        timestamptz not null,

  -- The price of the last notification we actually sent, so "only on change"
  -- compares against what the user last saw rather than the last tick.
  last_price         numeric,
  last_notified_at   timestamptz,
  notifications_sent int not null default 0,
  failure_count      int not null default 0,

  -- Secret returned to the client at subscribe time; required to stop or
  -- inspect a session, so knowing an endpoint alone isn't enough.
  stop_token         uuid not null default gen_random_uuid(),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint subscriptions_webpush_fields check (
    channel <> 'webpush'
    or (endpoint is not null and p256dh is not null and auth is not null)
  ),
  constraint subscriptions_telegram_fields check (
    channel <> 'telegram' or telegram_chat_id is not null
  ),
  constraint subscriptions_target_fields check (
    mode <> 'target' or target_price is not null
  ),
  constraint subscriptions_watch_fields check (
    mode = 'interval' or stability_minutes is not null
  )
);

-- One session per device, so re-subscribing replaces rather than duplicates.
--
-- These must NOT be partial indexes. Postgres can only infer a partial unique
-- index for ON CONFLICT when the statement repeats the index predicate, and
-- PostgREST (so supabase-js .upsert) never emits one — the insert dies with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" and every subscribe attempt 500s. A `where col is not null`
-- predicate bought nothing anyway: a plain unique index already allows any
-- number of NULLs, since NULL is never equal to NULL.
create unique index if not exists subscriptions_endpoint_key
  on public.subscriptions (endpoint);

create unique index if not exists subscriptions_telegram_key
  on public.subscriptions (telegram_chat_id);

-- The tick query: "give me everything due right now".
create index if not exists subscriptions_due_idx
  on public.subscriptions (next_run_at)
  where active;

create index if not exists subscriptions_expiry_idx
  on public.subscriptions (expires_at)
  where active;

-- ---------------------------------------------------------------------------
-- price_samples: every distinct reading we observe, for history and charts.
-- ---------------------------------------------------------------------------
create table if not exists public.price_samples (
  id          bigserial primary key,
  price       numeric not null,
  observed_at timestamptz not null,
  -- The last time the fetcher saw this price still standing. Because a row is
  -- only written when the operator's stamp changes, one row can cover an hour
  -- of unchanged price — and without this column there is no way to tell that
  -- apart from an hour when the fetcher was down. Price watches need the
  -- difference: "under 20 for ten minutes" is a claim about what we watched,
  -- not about what we happened to store.
  last_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- The operator stamps each price; upserting on that stamp de-duplicates
-- the once-a-minute polling down to genuine price updates.
create unique index if not exists price_samples_observed_at_key
  on public.price_samples (observed_at);

create index if not exists price_samples_recent_idx
  on public.price_samples (observed_at desc);

-- ---------------------------------------------------------------------------
-- Lock everything down. RLS on, zero policies: the anon and authenticated
-- roles can't touch these tables at all. Only the service role (which bypasses
-- RLS) reaches them, and it lives solely in server-side env vars.
-- ---------------------------------------------------------------------------
alter table public.subscriptions enable row level security;
alter table public.price_samples enable row level security;

revoke all on public.subscriptions from anon, authenticated;
revoke all on public.price_samples from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping: drop long-dead sessions so the table stays small.
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_subscriptions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.subscriptions
   where not active
     and updated_at < now() - interval '7 days';
$$;
