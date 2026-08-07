# הנתיב המהיר עכשיו — Fast Lane Now

A free, no-signup web app that pushes the current [Fast Lane](https://fastlane.co.il/)
toll price to your phone on an interval you choose — every minute to every half
hour, for up to two hours. Hebrew by default, English at `/en`.

Installable as a PWA, mobile-first, works on desktop too.

---

## How it works

```
pg_cron (every minute)
      │  POST /api/cron/tick  (x-cron-secret)
      ▼
  Next.js on Vercel ──── one fetch ────▶ fastlane.co.il page method
      │
      │  fan out to every subscription whose next_run_at has passed
      ▼
  Web Push (VAPID) ──▶ service worker ──▶ notification
```

The important part: **one price fetch per tick, no matter how many users**. The
operator sees at most one request a minute from us — less than their own
homepage, which polls every 20 seconds.

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

### Why there's a Cloudflare Worker in the middle

The site is behind Cloudflare, which answers **403 to requests from cloud
providers**. This isn't a header or fingerprint problem — the same fetch, with
the same headers, behaves differently purely by source IP:

| Source | Result |
| --- | --- |
| Ordinary Israeli connection | 200 in ~60ms |
| Vercel (Frankfurt) | 403 |
| Supabase Postgres egress (`pg_net`) | 403 |

Both 403s return Cloudflare's access-denied page. So the app can't call the
endpoint from its own server — and it can't call it from the browser either:
the endpoint sends no `Access-Control-*` headers and its `OPTIONS` preflight
404s, which rules out any client-side or service-worker fetch.

[`workers/price-proxy`](workers/price-proxy/index.js) is a small relay that
makes the call from Cloudflare's own network, which has a Tel Aviv edge —
responses come back stamped `x-cf-colo: TLV`. It is not an open proxy: the
target URL is hard-coded and every request must present `PROXY_SECRET`.

We identify honestly: `FastLaneNow/1.0` with a link to this repo, no browser
impersonation. That User-Agent is served normally, so there's nothing to gain
by pretending otherwise, and if the operator ever objects the contact path is
right there in the request.

Set `PRICE_PROXY_URL` and `PRICE_PROXY_SECRET` and the app routes through the
relay; leave them unset and it calls the endpoint directly, which is what local
development does from an Israeli connection.

### Layout

| Path | What it does |
| --- | --- |
| `app/[locale]/` | The single page. Hebrew at `/`, English at `/en`. |
| `app/api/price` | Current price for the live display, CDN-cached 20s. |
| `app/api/subscribe` | Creates a session and sends the confirmation push. |
| `app/api/unsubscribe` | Stops a session (needs id + stop token). |
| `app/api/session` | Lets a returning device check if its session is still live. |
| `app/api/cron/tick` | The heartbeat. Secret-guarded. |
| `lib/notify/` | Channel abstraction: `webpush.ts` is live, `telegram.ts` is ready. |
| `supabase/schema.sql` | Tables, indexes, RLS lockdown. |
| `supabase/cron.sql` | The per-minute schedule. |
| `public/sw.js` | Service worker: push, notification click, offline shell. |
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

**One session per device.** The push endpoint is unique in the database, so
starting a new session replaces the old one rather than stacking notifications.

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
