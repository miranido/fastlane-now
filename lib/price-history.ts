/**
 * Deciding whether a price condition has *held*.
 *
 * A watch is only worth anything if it ignores blips. The price touching ₪19
 * for one reading and bouncing back to ₪48 is not something anyone can act on
 * — by the time the phone buzzes it's over. So every watch asks the same
 * question: has this been true continuously for the last N minutes?
 *
 * The subtlety is what "continuously" means given how readings are stored.
 * price_samples holds one row per *price change*, not one per minute: the
 * operator stamps a price, we upsert on that stamp, and an unchanged price
 * writes nothing new. So a single row can span an hour — and a gap between
 * rows is ambiguous. It means either "the price held" or "the fetcher was
 * down", and those must not be treated alike, or a watch fires on a window
 * nobody was watching.
 *
 * `last_seen_at` resolves it: each row carries the last moment the fetcher
 * confirmed that price still standing, so a row covers [startedAt, lastSeenAt]
 * and anything outside a covered interval is genuinely unknown.
 */

import { PRICE_STALE_AFTER_MS } from "./config";

export type PriceSample = {
  price: number;
  /** When this price took effect (the operator's own stamp). */
  startedAt: number;
  /** The last time we confirmed it was still the price. */
  lastSeenAt: number;
};

/**
 * The longest we'll tolerate between one sample's last sighting and the next
 * one taking effect. Readings arrive once a minute, so anything past the
 * staleness threshold is a fetcher outage, and an outage breaks the run: we
 * can't vouch for what the price did while we weren't looking.
 */
const MAX_COVERAGE_GAP_MS = PRICE_STALE_AFTER_MS;

/**
 * Walks back from the newest reading for as long as `holds` keeps being true
 * and our coverage stays unbroken, oldest first.
 *
 * `holds` is called with the sample under consideration and the one that
 * follows it — null for the newest, which every run has to start from.
 * Returns null when there's no fresh reading at all.
 */
function continuousRun(
  samples: PriceSample[],
  now: number,
  holds: (candidate: PriceSample, newer: PriceSample | null) => boolean,
): PriceSample[] | null {
  if (samples.length === 0) return null;

  const ordered = [...samples].sort((a, b) => a.startedAt - b.startedAt);
  const newest = ordered[ordered.length - 1];

  // Nobody has confirmed the current price recently enough to reason about.
  if (now - newest.lastSeenAt > MAX_COVERAGE_GAP_MS) return null;
  if (!holds(newest, null)) return null;

  const run = [newest];
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const candidate = ordered[index];
    const newer = run[0];

    // A hole in what we watched. Everything older is unusable, even if it
    // would have satisfied the condition.
    if (newer.startedAt - candidate.lastSeenAt > MAX_COVERAGE_GAP_MS) break;
    if (!holds(candidate, newer)) break;

    run.unshift(candidate);
  }

  return run;
}

/**
 * When the price last rose to at or above `target` — or rather, the moment
 * from which it has been at or under it ever since. Null if it isn't under the
 * threshold right now, or if we can't account for the recent past.
 *
 * A price that has been under the threshold all along returns a time far in
 * the past, which is the honest answer: the user asked to hear about ₪20 and
 * it's already ₪8, so there's nothing to wait for.
 */
export function targetHeldSince(
  samples: PriceSample[],
  target: number,
  now: number,
): number | null {
  const run = continuousRun(samples, now, (candidate) => candidate.price <= target);
  return run ? run[0].startedAt : null;
}

/**
 * The current descent: when the price first came off the level it had been
 * sitting at, given it hasn't risen since.
 *
 * The plateau *before* the first drop is deliberately excluded. It's part of
 * the same non-increasing run — a flat price never rises — but counting it
 * would mean a price that had been steady for an hour and dropped a second ago
 * scored an hour of "stability" and fired instantly, which is the exact
 * behaviour a debounce exists to prevent. The clock starts at the first drop.
 *
 * Returns null when the price is flat or rising, or when coverage is broken.
 */
export function descentHeldSince(
  samples: PriceSample[],
  now: number,
): { since: number; from: number } | null {
  const run = continuousRun(
    samples,
    now,
    // Reading backwards: the older price must be at least the newer one, i.e.
    // going forwards the price never went up.
    (candidate, newer) => newer === null || candidate.price >= newer.price,
  );
  if (!run) return null;

  const from = run[0].price;
  const firstDrop = run.find((sample) => sample.price < from);
  // Non-increasing but never actually decreasing — that's a steady price, not
  // a falling one.
  if (!firstDrop) return null;

  return { since: firstDrop.startedAt, from };
}

/** Whether a condition that began at `since` has now held long enough. */
export function heldLongEnough(
  since: number | null,
  now: number,
  minutes: number,
): boolean {
  return since !== null && now - since >= minutes * 60_000;
}
