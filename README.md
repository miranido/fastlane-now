# הנתיב המהיר עכשיו — Fast Lane Now

A free, no-signup web app that pushes the current [Fast Lane](https://fastlane.co.il/)
toll price to your phone on an interval you choose — every minute to every half
hour, for up to two hours. Hebrew by default, English at `/en`.

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

### Where to run the fetcher

Anything always-on in Israel with Node 20+ and one outbound connection. It uses
no meaningful CPU, memory or bandwidth — one small POST a minute — so the
constraint is entirely *where the packets come from*, never how big the machine
is. The smallest instance any provider sells is oversized for this.

The catch is that **an Israeli datacenter is not the same as an Israeli
connection.** The block above tracks cloud providers, not just geography, and a
VPS in Tel Aviv still sits on a hosting ASN. So on any candidate machine, settle
it in ten seconds before paying for a month:

```bash
bash scripts/check-upstream.sh   # 200 → use it. 403 → try elsewhere.
```

| Where | Why | Watch for |
| --- | --- | --- |
| A Raspberry Pi or old laptop on a home connection | The only option *known* to work — it's the same class of connection as the Mac that runs it today. No monthly cost. | Your own uptime. Fine, given the app degrades honestly when it stops. |
| A VPS from an Israeli host (e.g. Kamatera, which bills hourly) | Cheapest real test — spin one up, run the check, destroy it if it 403s. | Hosting ASN; must be verified, not assumed. |
| An Israel region at a global cloud (Vultr Tel Aviv, AWS `il-central-1`, GCP `me-west1`, Oracle Jerusalem) | Familiar tooling, hourly billing, easy to throw away. | The most likely to be filtered — these are exactly the ASNs the block targets. |

Prefer a provider that bills by the hour, so a failed check costs pennies rather
than a month. Once something passes, install it:

```bash
sudo bash scripts/install-fetcher-linux.sh   # systemd timer, every minute
```

That writes `/etc/fastlane-now.env` for `INGEST_URL` and `CRON_SECRET` — kept
outside the checkout so a `git pull` can't clobber them — and enables the timer.
On macOS use the launchd job instead:
[`scripts/com.fastlane-now.fetcher.plist`](scripts/com.fastlane-now.fetcher.plist).

Nothing about the fetcher is stateful or unique, so two of them in different
places is a perfectly good redundancy story: ingest just stores whichever
reading arrives.

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
| `lib/notify/` | Channel abstraction: `webpush.ts` is live, `telegram.ts` is ready. |
| `supabase/schema.sql` | Tables, indexes, RLS lockdown. |
| `supabase/cron.sql` | The per-minute schedule. |
| `public/sw.js` | Service worker: push, notification click, offline shell. |
| `scripts/fetch-price.mjs` | The once-a-minute fetcher. Runs in Israel, not on Vercel. |
| `scripts/com.fastlane-now.fetcher.plist` | launchd job that keeps it running on macOS. |
| `scripts/fastlane-fetcher.{service,timer}` | The same job for systemd — a VPS or a Pi. |
| `scripts/install-fetcher-linux.sh` | Installs those units. Idempotent. |
| `scripts/check-upstream.sh` | Does *this* machine get served, or 403? Run before paying. |
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
