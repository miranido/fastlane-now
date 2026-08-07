import "server-only";
import { DISPLAY_TIME_ZONE } from "./config";
import type { PriceSnapshot } from "./price";
import { getServiceClient } from "./supabase";

/**
 * The server can't call fastlane.co.il itself — Cloudflare blocks cloud egress
 * (see the README). A fetcher on an ordinary Israeli connection posts readings
 * to /api/price/ingest, and everything server-side reads them from here.
 */

/**
 * How old a reading may be before we treat it as no reading at all. Three
 * missed minutes means the fetcher is down, and showing a price from an hour
 * ago as if it were current would be worse than showing nothing.
 */
export const PRICE_STALE_AFTER_MS = 3 * 60_000;

function formatInIsrael(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: DISPLAY_TIME_ZONE,
    ...options,
  }).format(date);
}

export async function recordPrice(snapshot: PriceSnapshot): Promise<void> {
  const { error } = await getServiceClient()
    .from("price_samples")
    .upsert(
      { price: snapshot.price, observed_at: snapshot.observedAt },
      { onConflict: "observed_at", ignoreDuplicates: true },
    );

  if (error) throw new Error(`failed to record price: ${error.message}`);
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
