# הנתיב המהיר עכשיו — Fast Lane Now

A free, no-signup web app that watches the [Fast Lane](https://fastlane.co.il/)
toll price for you and pushes it to your phone. Three things you can ask for:

| | |
| --- | --- |
| **Under a price** | One alert, once the price has *held* at or under the most you're willing to pay. ₪20 by default. |
| **Starting to fall** | One alert, once the price has been coming down — and not going back up — for a while. |
| **Every few minutes** | The price on a schedule, every minute to every half hour, for up to two hours. |

Hebrew by default, English at `/en`.

Installable as a PWA, mobile-first, works on desktop too.

---

## How it works

```
  fetcher on an Israeli connection (every minute)
      │  POST /api/price/ingest  (x-cron-secret)
      ▼
  Next.js on Vercel ──▶ price_samples in Supabase
      ▲
      │  POST /api/cron/tick  (x-cron-secret)
  pg_cron (every minute)
      │
      │  read latest price, fan out to every subscription now due
      ▼
  Web Push (VAPID) ──▶ service worker ──▶ notification
```

The important part: **one price fetch per minute, no matter how many users**.
The operator sees less traffic from us than from their own homepage, which
polls every 20 seconds while open.

Why the fetch happens on a machine in Israel rather than on Vercel is the next
section — it's the one genuinely surprising thing about this project.

### The data source

No scraping and no headless browser. The site's own homepage calls this, and so
do we:

```bash
curl -X POST https://fastlane.co.il/PageMethodsService.asmx/GetCurrentPrice \
  -H 'Content-Type: application/json' -d ''
# {"d":"{\"Price\":\"8\",\"PriceDateTime\":\"\\/Date(1786112069880)\\/\", ... }"}
```

It's an ASP.NET page method, so the payload is a JSON string nested inside a
JSON envelope, with a `/Date(ms)/` timestamp. [`lib/price.ts`](lib/price.ts)
unwraps all of that.

If they ever change it, that one file is the only thing that breaks.

### Why the price is fetched from a machine in Israel

The site is behind Cloudflare, which answers **403 to requests from cloud
providers**. This isn't a header or fingerprint problem — the same fetch, with
the same headers, succeeds or fails purely by where it comes from:

| Source | Result |
| --- | --- |
| Ordinary Israeli connection | **200** in ~60ms |
| Vercel (Frankfurt) | 403 |
| Supabase Postgres egress (`pg_net`) | 403 |
| Cloudflare Worker | 403 |

The browser can't do it either: the endpoint sends no `Access-Control-*`
headers and its `OPTIONS` preflight 404s, so no client-side or service-worker
fetch is possible.

A Cloudflare Worker looks like it should help and doesn't, for a reason worth
recording. Workers run at the edge nearest the *caller*, so one invoked from
Vercel executed in Washington DC. Pinning it with a Durable Object
`locationHint` doesn't fix it either — when a Worker fetches a host that is
itself behind Cloudflare, Cloudflare forwards the **original visitor's IP** to
the destination, so the relay is transparent to exactly the thing being
filtered. (And "Middle East" as a Cloudflare region is emphatically not
"Israel", which for a geo-filtering Israeli operator cuts the wrong way.)

So the one request that must come from Israel does:
[`scripts/fetch-price.mjs`](scripts/fetch-price.mjs) runs once a minute on an
ordinary Israeli connection and posts the reading to `/api/price/ingest`.
Everything else stays serverless. The server never calls fastlane.co.il.

**When the fetcher stops, the app degrades honestly.** Readings older than
three minutes are treated as no reading at all: the UI says the price is
unavailable and the tick sends nothing, rather than pushing a stale price.
When the fetcher comes back it resumes within a minute, unattended.

We identify honestly — `FastLaneNow/1.0` with a link to this repo, no browser
impersonation. That agent is served normally, so there's nothing to gain by
pretending otherwise, and the operator has a contact path if it ever bothers
them.

### Layout

| Path | What it does |
| --- | --- |
| `app/[locale]/` | The single page. Hebrew at `/`, English at `/en`. |
| `app/api/price` | Latest stored reading for the live display, CDN-cached 20s. |
| `app/api/price/ingest` | Where the Israeli fetcher posts readings. Secret-guarded. |
| `app/api/subscribe` | Creates a session and sends the confirmation push. |
| `app/api/unsubscribe` | Stops a session (needs id + stop token). |
| `app/api/session` | Lets a returning device check if its session is still live. |
| `app/api/cron/tick` | The heartbeat. Secret-guarded. |
| `lib/price-history.ts` | Whether a price condition has actually *held*. The heart of the watches. |
| `lib/notify/` | Channel abstraction: `webpush.ts` is live, `telegram.ts` is ready. |
| `supabase/schema.sql` | Tables, indexes, RLS lockdown. |
| `supabase/migrations/` | Changes to apply to databases created before them. |
| `supabase/cron.sql` | The per-minute schedule. |
| `public/sw.js` | Service worker: push, notification click, offline shell. |
| `scripts/fetch-price.mjs` | The once-a-minute fetcher. Runs in Israel, not on Vercel. |
| `scripts/com.fastlane-now.fetcher.plist` | launchd job that keeps it running on macOS. |
| `scripts/make_icons.py` | Regenerates every icon from one definition. |

---

## Setup

### 1. Supabase

Create a **dedicated project** for this app — don't add these tables to a
Supabase project that serves something else. The service role key bypasses RLS
on *every* table in a project, and that key has to sit in this app's
environment variables; a separate project keeps the blast radius to two tables
of push subscriptions.

Two things worth knowing about the free tier: active free projects are capped
per organization (2, as of writing — check current pricing), so if yours are
taken, make a new organization rather than paying. And free projects pause
after about a week of inactivity, which this one never hits: the tick queries
the database every minute regardless of whether anyone is subscribed.

Then, in the **SQL Editor**:

1. Run [`supabase/schema.sql`](supabase/schema.sql) — creates the tables with RLS
   on and no policies, so only the service role can touch them.
2. Leave [`supabase/cron.sql`](supabase/cron.sql) for after the first deploy —
   it needs the live URL.

A database created from the current `schema.sql` needs nothing from
[`supabase/migrations/`](supabase/migrations) — those files exist for databases
built before them, and each one says what it fixes and is safe to re-run.

From **Project Settings → API**, copy the project URL and the **service role**
key (not the anon key).

### 2. Environment

```bash
cp .env.example .env.local
node scripts/generate-vapid.mjs   # prints a VAPID key pair
openssl rand -hex 32              # your CRON_SECRET
```

Fill in `.env.local`. Rotating the VAPID keys later invalidates every push
subscription users have granted, so generate them once and keep them.

### 3. Run it

```bash
npm run dev
```

Web Push works on `localhost` (a secure context) — you can test the whole flow
locally except the minute-by-minute scheduler, which you can drive by hand:

```bash
curl -X POST http://localhost:3000/api/cron/tick -H "x-cron-secret: $CRON_SECRET"
```

### 4. Deploy

Push to GitHub, then **Add New → Project** in Vercel and import the repo — a
Vercel project maps one-to-one to a repo, so this gets its own. Add every
variable from `.env.local` under **Settings → Environment Variables** (set
`NEXT_PUBLIC_APP_URL` to the real domain). Deploy.

Hobby is free and enough for this, but it's licensed for non-commercial use —
if the project ever earns money, it needs Pro.

### 5. Start the heartbeat

Back in the Supabase SQL Editor, open [`supabase/cron.sql`](supabase/cron.sql),
replace `<APP_URL>` and `<CRON_SECRET>` with the real values, and run it.

Confirm it's alive:

```sql
select jobname, schedule, active from cron.job;
select status_code, content, created from net._http_response
 order by created desc limit 5;   -- expect 200s
```

---

## Notes worth knowing

**iPhone needs the app installed.** iOS only delivers Web Push to sites added to
the home screen. The app detects iOS Safari and shows the three-step
instructions instead of the enable button — without that, people tap "enable"
and silently get nothing. Android and desktop have no such restriction.

**When "enable" fails, it says why.** The error notice carries the exact cause
under it — `push subscribe — AbortError: …` (the browser or push service refused
to register), `server 500 storage_failed (42P10)` (the database write, with
Postgres' own SQLSTATE), `server 400 push_rejected` (the push service rejected
the confirmation message), `network — …` (the request never landed). The same
line goes to the console. A rejected
endpoint is retried once with a freshly minted subscription, because Safari
keeps handing back endpoints Apple has already forgotten — without that, every
retry fails identically forever.

**The upsert indexes must not be partial.** `subscriptions_endpoint_key` started
life as `unique (endpoint) where endpoint is not null`, which looks tidier and
silently breaks every subscribe: Postgres only infers a *partial* unique index
for `ON CONFLICT` when the statement repeats the predicate, and PostgREST — what
supabase-js `.upsert()` talks to — never emits one, so the insert dies with
SQLSTATE 42P10 and the app returns `storage_failed`. The predicate was
pointless anyway; a plain unique index already allows any number of NULLs.
`price_samples` was unaffected because its unique index was never partial, which
is exactly why the price kept working while notifications didn't.

**One session per device.** The push endpoint is unique in the database, so
starting a new session replaces the old one rather than stacking notifications.

**A price watch is about what held, not what happened.** "Under ₪20" firing the
instant the price touches ₪19 would be useless — by the time the phone is out
of the pocket it's ₪48 again. So both watches ask whether the condition has
been continuously true for a window the user picks (5, 10 or 15 minutes), and
the tick evaluates them every minute so they fire promptly once it is.

The "starting to fall" watch has a trap in it worth naming. A falling price is
one that hasn't risen — but so is a price that has been flat for an hour, so
timing the run from the start of the non-increasing stretch would score that
hour as stability and fire the instant the price first moved, which is the
exact opposite of a debounce. The clock therefore starts at the *first drop*
after the last rise, and the plateau before it doesn't count.

**A watch can't vouch for a window nobody watched.** `price_samples` holds one
row per price *change*, not one per minute — an unchanged price writes nothing
new. That makes a gap between rows ambiguous: either the price held, or the
fetcher was down. `last_seen_at` settles it, updated on every ingest even when
the reading is a repeat, so each row covers a known interval and a hole longer
than the staleness threshold breaks the run. Without it, a fetcher outage would
read as perfect stability and fire every watch the moment it came back.

**A watch ends when it fires, and says so when it doesn't.** One alert is the
whole point; a second one five minutes later helps nobody. If the watch runs
its full duration without the condition ever holding, it sends a short "that's
over, still ₪48" instead — silence is otherwise indistinguishable from a watch
that's still running. A push failure on the alert itself doesn't end the
session, though: it retries on the next tick, since the condition it fired on
is almost certainly still true.

**"Only when the price changes"** compares against the price of the last
notification the user actually received, not the last tick — so they never get
two identical alerts in a row, and a change is never missed.

**Ticks are self-correcting.** `next_run_at` advances in whole intervals from
its previous value, so a late or skipped tick doesn't drift the cadence.

**Dead subscriptions clean themselves up.** A 404/410 from the push service
deactivates the row immediately; transient failures are retried up to five
times before giving up.

**Push endpoints are allowlisted** to the four real browser push services
(`lib/push-endpoint.ts`). Without that, anyone could register an arbitrary URL
and have the server POST to it on a schedule.

---

## Adding Telegram later

Delivery is already implemented in `lib/notify/telegram.ts` and the tick loop
routes on the `channel` column. What's missing is the linking flow:

1. Create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN`.
2. Add a webhook route that handles `/start <code>` and writes a row with
   `channel = 'telegram'` and the chat id.
3. Show a "get it on Telegram instead" link in the UI with a one-time code.

Worth doing if iPhone install friction turns out to lose people.

---

## Regenerating icons

```bash
python3 scripts/make_icons.py   # needs pillow
```

Writes `public/icons/*` and `app/favicon.ico`. Committed, so it never runs at
build time.

---

## Disclaimer

Independent and unaffiliated with the Fast Lane operator. Prices are read from
their public site and shown as-is; the final fare is theirs alone to set.
