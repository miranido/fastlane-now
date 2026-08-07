import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { buildPriceNotification, deliver } from "@/lib/notify";
import { fetchCurrentPrice, type PriceSnapshot } from "@/lib/price";
import { getServiceClient, type SubscriptionRow } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Safety valve: one tick never handles more than this many subscriptions. */
const MAX_PER_TICK = 500;
/** How many pushes are in flight at once. */
const CONCURRENCY = 20;
/** Consecutive transient failures before we give up on a subscription. */
const MAX_FAILURES = 5;

function isAuthorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Walks next_run_at forward in whole intervals until it's in the future. Using
 * multiples of the original start time (rather than now + interval) keeps the
 * cadence honest even if a tick is late or skipped.
 */
function advance(from: Date, intervalMinutes: number, now: number): Date {
  const step = intervalMinutes * 60_000;
  let next = from.getTime();
  do {
    next += step;
  } while (next <= now);
  return new Date(next);
}

async function recordSample(snapshot: PriceSnapshot) {
  // Unique on observed_at, so re-observing the same reading is a no-op.
  const { error } = await getServiceClient()
    .from("price_samples")
    .upsert(
      { price: snapshot.price, observed_at: snapshot.observedAt },
      { onConflict: "observed_at", ignoreDuplicates: true },
    );
  if (error) console.error("tick: sample insert failed", error);
}

type TickStats = {
  due: number;
  sent: number;
  suppressed: number;
  failed: number;
  deactivated: number;
  expired: number;
};

async function handleSubscription(
  row: SubscriptionRow,
  snapshot: PriceSnapshot,
  now: number,
  stats: TickStats,
) {
  const supabase = getServiceClient();
  const expiresAt = new Date(row.expires_at).getTime();
  const nextRunAt = advance(
    new Date(row.next_run_at),
    row.interval_minutes,
    now,
  );
  // Nothing more is scheduled before the session ends, so this is the last one.
  const isFinal = nextRunAt.getTime() > expiresAt;

  const unchanged =
    row.last_price !== null && Number(row.last_price) === snapshot.price;

  const update: Partial<SubscriptionRow> & { updated_at: string } = {
    next_run_at: nextRunAt.toISOString(),
    updated_at: new Date(now).toISOString(),
  };

  // "Only when the price changes" — stay silent, but keep the schedule moving.
  if (row.only_on_change && unchanged) {
    stats.suppressed += 1;
    if (isFinal) {
      update.active = false;
      stats.deactivated += 1;
    }
    await supabase.from("subscriptions").update(update).eq("id", row.id);
    return;
  }

  const outcome = await deliver(
    row,
    buildPriceNotification({
      locale: row.locale,
      snapshot,
      previousPrice: row.last_price === null ? null : Number(row.last_price),
      isFinal,
    }),
  );

  if (outcome.status === "sent") {
    stats.sent += 1;
    update.last_price = snapshot.price;
    update.last_notified_at = new Date(now).toISOString();
    update.notifications_sent = row.notifications_sent + 1;
    update.failure_count = 0;
    if (isFinal) {
      update.active = false;
      stats.deactivated += 1;
    }
  } else if (outcome.status === "gone") {
    stats.deactivated += 1;
    update.active = false;
  } else {
    stats.failed += 1;
    const failures = row.failure_count + 1;
    update.failure_count = failures;
    if (failures >= MAX_FAILURES || isFinal) {
      update.active = false;
      stats.deactivated += 1;
    }
    console.warn(`tick: delivery failed for ${row.id}: ${outcome.reason}`);
  }

  await supabase.from("subscriptions").update(update).eq("id", row.id);
}

async function runTick(): Promise<NextResponse> {
  const supabase = getServiceClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const stats: TickStats = {
    due: 0,
    sent: 0,
    suppressed: 0,
    failed: 0,
    deactivated: 0,
    expired: 0,
  };

  // Retire sessions that have run past their end time.
  const { data: expired, error: expireError } = await supabase
    .from("subscriptions")
    .update({ active: false, updated_at: nowIso })
    .eq("active", true)
    .lte("expires_at", nowIso)
    .select("id");
  if (expireError) console.error("tick: expiry sweep failed", expireError);
  stats.expired = expired?.length ?? 0;

  const { data: due, error: dueError } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("active", true)
    .lte("next_run_at", nowIso)
    .gt("expires_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(MAX_PER_TICK)
    .returns<SubscriptionRow[]>();

  if (dueError) {
    console.error("tick: due query failed", dueError);
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }

  stats.due = due?.length ?? 0;
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, ...stats });
  }

  // One fetch feeds every subscription in this tick.
  let snapshot: PriceSnapshot;
  try {
    snapshot = await fetchCurrentPrice();
  } catch (error) {
    // Leave next_run_at alone; the next tick a minute from now retries.
    console.error("tick: price fetch failed", error);
    return NextResponse.json(
      { ok: false, error: "price_unavailable", ...stats },
      { status: 503 },
    );
  }

  await recordSample(snapshot);

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.allSettled(
      due
        .slice(i, i + CONCURRENCY)
        .map((row) => handleSubscription(row, snapshot, now, stats)),
    );
  }

  return NextResponse.json({ ok: true, price: snapshot.raw, ...stats });
}

/**
 * pg_cron only ever sees the status code and body, so surface configuration
 * problems as readable JSON instead of an opaque 500.
 */
async function guarded(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await runTick();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error("tick: unhandled failure", error);
    return NextResponse.json({ error: "tick_failed", reason }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return guarded(request);
}

/** Same guard — GET just makes manual testing with curl easier. */
export async function GET(request: Request) {
  return guarded(request);
}
