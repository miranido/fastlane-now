-- Fast Lane Now — migration 002: price watches.
--
-- Run this once, in the Supabase SQL Editor, on any database created before
-- this migration existed. Databases built from the current schema.sql already
-- have it. Safe to re-run.
--
-- Adds the two watch modes ("tell me when it drops under ₪20", "tell me when
-- it starts falling and stays down") alongside the original interval alerts,
-- and gives price_samples the coverage column those watches are built on.

-- --- subscriptions ---------------------------------------------------------

alter table public.subscriptions
  add column if not exists mode text not null default 'interval',
  add column if not exists target_price numeric,
  add column if not exists stability_minutes int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_mode_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_mode_check
      check (mode in ('interval', 'target', 'drop'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_target_price_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_target_price_check
      check (target_price > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_stability_minutes_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_stability_minutes_check
      check (stability_minutes between 1 and 60);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_target_fields'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_target_fields
      check (mode <> 'target' or target_price is not null);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_watch_fields'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_watch_fields
      check (mode = 'interval' or stability_minutes is not null);
  end if;
end
$$;

-- --- price_samples ---------------------------------------------------------
--
-- Backfilled from observed_at rather than now(): rows written before this
-- migration were never confirmed as still standing, and claiming we watched
-- them until this moment would let a watch fire on a window we never saw.

alter table public.price_samples
  add column if not exists last_seen_at timestamptz;

update public.price_samples
   set last_seen_at = observed_at
 where last_seen_at is null;

alter table public.price_samples
  alter column last_seen_at set default now();

alter table public.price_samples
  alter column last_seen_at set not null;
