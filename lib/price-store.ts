import "server-only";
import { DISPLAY_TIME_ZONE, PRICE_STALE_AFTER_MS } from "./config";
import type { PriceSnapshot } from "./price";
import type { PriceSample } from "./price-history";
import { getServiceClient } from "./supabase";

/**
 * The server can't call fastlane.co.il itself — Cloudflare blocks cloud egress
 * (see the README). A fetcher on an ordinary Israeli connection posts readings
 * to /api/price/ingest, and everything server-side reads them from here.
 */

export { PRICE_STALE_AFTER_MS };

/**
 * How many past readings a watch evaluation looks at. Rows only appear when
 * the price actually changes, so even at the pathological rate of one change
 * per minute this reaches back well past the longest stability window.
 */
const HISTORY_DEPTH = 40;

function formatInIsrael(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: DISPLAY_TIME_ZONE,
    ...options,
  }).format(date);
}

export async function recordPrice(snapshot: PriceSnapshot): Promise<void> {
  // Not ignoreDuplicates: a repeat reading is the whole point of last_seen_at.
  // The operator's stamp stays put while the price holds, so re-ingesting the
  // same stamp is how we record "still true at this moment" — the evidence
  // price watches need to tell a steady price from a dead fetcher.
  const { error } = await getServiceClient()
    .from("price_samples")
    .upsert(
      {
        price: snapshot.price,
        observed_at: snapshot.observedAt,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "observed_at" },
    );

  if (error) throw new Error(`failed to record price: ${error.message}`);
}

/**
 * Recent readings as coverage intervals, oldest first — what the watches in
 * lib/price-history.ts reason over.
 */
export async function readRecentSamples(): Promise<PriceSample[]> {
  const { data, error } = await getServiceClient()
    .from("price_samples")
    .select("price, observed_at, last_seen_at")
    .order("observed_at", { ascending: false })
    .limit(HISTORY_DEPTH)
    .returns<
      { price: number; observed_at: string; last_seen_at: string | null }[]
    >();

  if (error) throw new Error(`failed to read price history: ${error.message}`);
  if (!data) return [];

  return data
    .map((row) => {
      const startedAt = new Date(row.observed_at).getTime();
      // Rows predating the last_seen_at column can only vouch for the instant
      // they were stamped, which is what the migration backfilled them with.
      const lastSeenAt = row.last_seen_at
        ? new Date(row.last_seen_at).getTime()
        : startedAt;
      return {
        price: Number(row.price),
        // The two timestamps come from different clocks — the operator's stamp
        // and ours. They normally agree to within a poll, but a stamp landing
        // after we saw it would make the interval run backwards.
        startedAt: Math.min(startedAt, lastSeenAt),
        lastSeenAt,
      };
    })
    .reverse();
}

export type StoredPrice = PriceSnapshot & { ageMs: number; stale: boolean };

/** The most recent reading, or null if there has never been one. */
export async function readLatestPrice(): Promise<StoredPrice | null> {
  const { data, error } = await getServiceClient()
    .from("price_samples")
    .select("price, observed_at")
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ price: number; observed_at: string }>();

  if (error) throw new Error(`failed to read price: ${error.message}`);
  if (!data) return null;

  const observed = new Date(data.observed_at);
  const ageMs = Date.now() - observed.getTime();
  const price = Number(data.price);

  return {
    price,
    // Trim a trailing ".00" that Postgres numeric round-trips can introduce.
    raw: String(price),
    observedAt: observed.toISOString(),
    timeStr: formatInIsrael(observed, { hour: "2-digit", minute: "2-digit" }),
    dateStr: formatInIsrael(observed, { dateStyle: "long" }),
    ageMs,
    stale: ageMs > PRICE_STALE_AFTER_MS,
  };
}

/** The latest reading, but only if it's fresh enough to act on. */
export async function readFreshPrice(): Promise<StoredPrice | null> {
  const latest = await readLatestPrice();
  return latest && !latest.stale ? latest : null;
}
