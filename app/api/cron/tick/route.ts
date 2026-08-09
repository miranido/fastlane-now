import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isWatchMode } from "@/lib/config";
import {
  buildPriceNotification,
  buildWatchEndedNotification,
  buildWatchHitNotification,
  deliver,
} from "@/lib/notify";
import type { PriceSnapshot } from "@/lib/price";
import {
  descentHeldSince,
  heldLongEnough,
  targetHeldSince,
  type PriceSample,
} from "@/lib/price-history";
import { readFreshPrice, readRecentSamples } from "@/lib/price-store";
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

type TickStats = {
  due: number;
  sent: number;
  suppressed: number;
  /** Watches whose condition came true this tick. */
  triggered: number;
  failed: number;
  deactivated: number;
  expired: number;
};

/**
 * The common bookkeeping after a delivery attempt, whatever prompted it.
 *
 * The two "is this the end" flags are separate because they aren't the same
 * question. A watch that fires is finished — but only if the alert actually
 * went out. When the push service blips on the one notification the user was
 * waiting for, the session has to survive to try again next minute, and the
 * condition it fired on will almost certainly still be true.
 */
function applyOutcome(
  outcome: Awaited<ReturnType<typeof deliver>>,
  row: SubscriptionRow,
  update: Partial<SubscriptionRow> & { updated_at: string },
  snapshot: PriceSnapshot,
  now: number,
  ending: { onSuccess: boolean; onFailure: boolean },
  stats: TickStats,
) {
  if (outcome.status === "sent") {
    stats.sent += 1;
    update.last_price = snapshot.price;
    update.last_notified_at = new Date(now).toISOString();
    update.notifications_sent = row.notifications_sent + 1;
    update.failure_count = 0;
    if (ending.onSuccess) {
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
    if (failures >= MAX_FAILURES || ending.onFailure) {
      update.active = false;
      stats.deactivated += 1;
    }
    console.warn(`tick: delivery failed for ${row.id}: ${outcome.reason}`);
  }
}

/**
 * A price watch: silent until the thing the user asked about has been true for
 * long enough, then one notification and the session is over.
 *
 * Firing ends the watch rather than re-arming it. The question was "tell me
 * when I can take the road" — once told, they're either on it or they aren't,
 * and a second alert five minutes later helps nobody.
 */
async function handleWatch(
  row: SubscriptionRow,
  snapshot: PriceSnapshot,
  samples: PriceSample[],
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
  const isFinal = nextRunAt.getTime() > expiresAt;
  const window = row.stability_minutes ?? 0;

  const update: Partial<SubscriptionRow> & { updated_at: string } = {
    next_run_at: nextRunAt.toISOString(),
    updated_at: new Date(now).toISOString(),
  };

  let hit = false;
  let fromPrice: number | null = null;

  if (row.mode === "target" && row.target_price !== null) {
    hit = heldLongEnough(
      targetHeldSince(samples, Number(row.target_price), now),
      now,
      window,
    );
  } else if (row.mode === "drop") {
    const descent = descentHeldSince(samples, now);
    hit = heldLongEnough(descent?.since ?? null, now, window);
    fromPrice = descent?.from ?? null;
  }

  // Still waiting, and there's another tick to wait in.
  if (!hit && !isFinal) {
    stats.suppressed += 1;
    await supabase.from("subscriptions").update(update).eq("id", row.id);
    return;
  }

  const mode = row.mode as "target" | "drop";
  const payload = hit
    ? buildWatchHitNotification({
        locale: row.locale,
        snapshot,
        mode,
        targetPrice: row.target_price === null ? null : Number(row.target_price),
        fromPrice,
        stabilityMinutes: window,
      })
    : // Out of time without the condition ever holding. Say so, rather than
      // leaving someone to wonder whether the watch is still running.
      buildWatchEndedNotification({
        locale: row.locale,
        snapshot,
        mode,
        targetPrice: row.target_price === null ? null : Number(row.target_price),
      });

  if (hit) stats.triggered += 1;

  const outcome = await deliver(row, payload);
  applyOutcome(
    outcome,
    row,
    update,
    snapshot,
    now,
    // A delivered alert ends the watch even mid-session: there's nothing left
    // to wait for. A failed one only ends it if the session was over anyway.
    { onSuccess: hit || isFinal, onFailure: isFinal },
    stats,
  );

  await supabase.from("subscriptions").update(update).eq("id", row.id);
}

async function handleInterval(
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

  applyOutcome(
    outcome,
    row,
    update,
    snapshot,
    now,
    { onSuccess: isFinal, onFailure: isFinal },
    stats,
  );

  await supabase.from("subscriptions").update(update).eq("id", row.id);
}

/**
 * Watches need price history; interval alerts only need the current reading.
 * `samples` is null when history couldn't be read, in which case watches are
 * left entirely untouched — next_run_at included — so the next tick picks up
 * where this one stopped rather than skipping a minute of the window.
 */
async function handleSubscription(
  row: SubscriptionRow,
  snapshot: PriceSnapshot,
  samples: PriceSample[] | null,
  now: number,
  stats: TickStats,
) {
  if (isWatchMode(row.mode)) {
    if (!samples) return;
    return handleWatch(row, snapshot, samples, now, stats);
  }
  return handleInterval(row, snapshot, now, stats);
}

async function runTick(): Promise<NextResponse> {
  const supabase = getServiceClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const stats: TickStats = {
    due: 0,
    sent: 0,
    suppressed: 0,
    triggered: 0,
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

  // One reading feeds every subscription in this tick.
  const snapshot: PriceSnapshot | null = await readFreshPrice();

  // No fresh reading means the fetcher is down. Leave next_run_at alone so
  // nobody's schedule advances, and send nothing rather than a stale price —
  // the tick a minute from now picks up exactly where this one stopped.
  if (!snapshot) {
    console.warn("tick: no fresh price, skipping this round");
    return NextResponse.json(
      { ok: false, error: "price_unavailable", ...stats },
      { status: 503 },
    );
  }

  // One history read feeds every watch in this tick, and only if there is one.
  let samples: PriceSample[] | null = null;
  if (due.some((row) => isWatchMode(row.mode))) {
    try {
      samples = await readRecentSamples();
    } catch (error) {
      console.error("tick: price history read failed", error);
    }
  }

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.allSettled(
      due
        .slice(i, i + CONCURRENCY)
        .map((row) => handleSubscription(row, snapshot, samples, now, stats)),
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
