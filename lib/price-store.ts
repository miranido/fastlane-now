import "server-only";
import {
  DISPLAY_TIME_ZONE,
  HISTORY_BUCKET_MINUTES,
  HISTORY_WINDOW_MINUTES,
} from "./config";
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

/* --- history ---------------------------------------------------------------
 * The graph of the last hour. */

const BUCKET_MS = HISTORY_BUCKET_MINUTES * 60_000;
const WINDOW_MS = HISTORY_WINDOW_MINUTES * 60_000;

/**
 * Enough rows for an hour of once-a-minute readings several times over. The
 * query orders newest first so hitting this ceiling drops the oldest readings
 * rather than the ones the graph's head is drawn from.
 */
const HISTORY_MAX_SAMPLES = 500;

export type PriceHistoryPoint = {
  /** The instant this point describes, ISO. */
  t: string;
  /** The price in effect then, or null if no reading vouches for that moment. */
  price: number | null;
};

type Sample = { price: number; at: number };

/** The instants the graph is drawn from: five-minute marks, then the present. */
export function historyMarks(now: number): number[] {
  // Marks sit on wall-clock five-minute boundaries so the axis labels hold
  // still between polls.
  const end = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const marks: number[] = [];
  for (let mark = end - WINDOW_MS; mark <= end; mark += BUCKET_MS) {
    marks.push(mark);
  }
  // Finish on the present moment, so the head of the graph is the same reading
  // the big number above it shows rather than one up to five minutes behind.
  if (now > end) marks.push(now);
  return marks;
}

/**
 * A price holds until the next reading changes it, so each mark takes the last
 * reading at or before it rather than an average — the graph is a staircase,
 * which is what a toll actually does.
 *
 * The carry-forward stops at PRICE_STALE_AFTER_MS for the same reason the live
 * display does: past that the fetcher was down, so we know nothing about those
 * minutes rather than knowing the price stayed put. Those marks come back null
 * and the line breaks there.
 *
 * `samples` must be oldest-first.
 */
export function bucketSamples(
  samples: Sample[],
  marks: number[],
): PriceHistoryPoint[] {
  let index = 0;
  let current: Sample | null = null;

  return marks.map((mark) => {
    while (index < samples.length && samples[index].at <= mark) {
      current = samples[index++];
    }
    return {
      t: new Date(mark).toISOString(),
      price:
        current && mark - current.at <= PRICE_STALE_AFTER_MS
          ? current.price
          : null,
    };
  });
}

/** The last hour as five-minute steps. */
export async function readPriceHistory(
  now: number = Date.now(),
): Promise<PriceHistoryPoint[]> {
  const marks = historyMarks(now);

  // A reading from just before the window still sets the price at its first
  // mark, so the query reaches back one staleness window further.
  const { data, error } = await getServiceClient()
    .from("price_samples")
    .select("price, observed_at")
    .gte("observed_at", new Date(marks[0] - PRICE_STALE_AFTER_MS).toISOString())
    .lte("observed_at", new Date(now).toISOString())
    .order("observed_at", { ascending: false })
    .limit(HISTORY_MAX_SAMPLES)
    .returns<{ price: number; observed_at: string }[]>();

  if (error) throw new Error(`failed to read price history: ${error.message}`);

  const samples = (data ?? [])
    .map((row) => ({
      price: Number(row.price),
      at: new Date(row.observed_at).getTime(),
    }))
    .reverse();

  return bucketSamples(samples, marks);
}
