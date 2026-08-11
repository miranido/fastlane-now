import "server-only";
import {
  DEFAULT_HISTORY_RANGE,
  DISPLAY_TIME_ZONE,
  HISTORY_RANGES,
  type HistoryRange,
} from "./config";
import type { PriceSnapshot } from "./price";
import { getServiceClient } from "./supabase";
import { sameClockTimeLastWeek } from "./time";

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
 * What the graph is drawn from. */

/**
 * Enough rows for the longest window at once-a-minute readings several times
 * over. The query orders newest first, so hitting this ceiling drops the
 * oldest readings rather than the ones the head of the graph is drawn from.
 */
const HISTORY_MAX_SAMPLES = 800;

/**
 * How far past a bucket boundary the present has to be before the graph adds
 * a mark for it. Without a floor, a poll landing a second after the
 * boundary appends a mark a second wide, which the curve has to climb almost
 * vertically for no information at all.
 */
const HEAD_MARK_MIN_GAP_MS = 30_000;

export type PriceHistoryPoint = {
  /** The instant this point describes, ISO. */
  t: string;
  /** The price then, or null if no reading vouches for that moment. */
  price: number | null;
};

export type PriceHistory = {
  points: PriceHistoryPoint[];
  /**
   * The same marks a week earlier, or null if not asked for. Timestamps are
   * the *current* marks, so the two series line up on one axis; each value
   * comes from the same clock time seven days back.
   */
  comparison: PriceHistoryPoint[] | null;
};

type Sample = { price: number; at: number };

/** The instants a range is drawn from: its own bucket boundaries, then now. */
export function historyMarks(range: HistoryRange, now: number): number[] {
  const { windowMinutes, bucketMinutes } = HISTORY_RANGES[range];
  const bucketMs = bucketMinutes * 60_000;

  // Marks sit on wall-clock boundaries so the axis labels hold still between
  // polls rather than sliding a few seconds left on every refresh.
  const end = Math.floor(now / bucketMs) * bucketMs;

  const marks: number[] = [];
  for (let mark = end - windowMinutes * 60_000; mark <= end; mark += bucketMs) {
    marks.push(mark);
  }
  // Finish on the present, so the head of the graph is the reading the big
  // number above it shows rather than one up to a whole bucket behind.
  if (now - end >= HEAD_MARK_MIN_GAP_MS) marks.push(now);
  return marks;
}

/**
 * `sample`: a price holds until the next reading changes it, so each mark
 * takes the last reading at or before it — the graph is a staircase, which is
 * what a toll actually does. The carry-forward stops at PRICE_STALE_AFTER_MS
 * for the same reason the live display goes blank: past that the fetcher was
 * down, so we know nothing about those minutes rather than knowing the price
 * stayed put.
 *
 * `average`: the mean of the readings inside the window behind each mark. A
 * quarter-hour bucket can span two price changes, and no single reading in it
 * is more the truth than the others.
 *
 * Either way a mark with nothing behind it comes back null and breaks the line.
 *
 * `samples` must be oldest-first.
 */
export function bucketSamples(
  samples: Sample[],
  marks: number[],
  range: HistoryRange,
): PriceHistoryPoint[] {
  const { mode, bucketMinutes } = HISTORY_RANGES[range];
  const windowMs = bucketMinutes * 60_000;

  if (mode === "average") {
    return marks.map((mark) => {
      const inWindow = samples.filter(
        (sample) => sample.at > mark - windowMs && sample.at <= mark,
      );
      if (!inWindow.length) return { t: new Date(mark).toISOString(), price: null };
      const mean =
        inWindow.reduce((sum, sample) => sum + sample.price, 0) / inWindow.length;
      return {
        t: new Date(mark).toISOString(),
        // Two decimals: an average of shekel prices is rarely a whole one, and
        // more digits than this is precision the readings don't have.
        price: Math.round(mean * 100) / 100,
      };
    });
  }

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

/** How far before the first mark a reading can still matter to it. */
function lookbackMs(range: HistoryRange): number {
  const { mode, bucketMinutes } = HISTORY_RANGES[range];
  return mode === "average" ? bucketMinutes * 60_000 : PRICE_STALE_AFTER_MS;
}

/** The readings covering a set of marks, oldest first. */
async function readSamples(
  marks: number[],
  range: HistoryRange,
): Promise<Sample[]> {
  const from = marks[0] - lookbackMs(range);
  const to = marks[marks.length - 1];

  const { data, error } = await getServiceClient()
    .from("price_samples")
    .select("price, observed_at")
    .gte("observed_at", new Date(from).toISOString())
    .lte("observed_at", new Date(to).toISOString())
    .order("observed_at", { ascending: false })
    .limit(HISTORY_MAX_SAMPLES)
    .returns<{ price: number; observed_at: string }[]>();

  if (error) throw new Error(`failed to read price history: ${error.message}`);

  return (data ?? [])
    .map((row) => ({
      price: Number(row.price),
      at: new Date(row.observed_at).getTime(),
    }))
    .reverse();
}

/**
 * The graph's data: one series for the chosen range, and optionally the same
 * span of last week's matching weekday laid over it.
 */
export async function readPriceHistory({
  range = DEFAULT_HISTORY_RANGE,
  compare = false,
  now = Date.now(),
}: {
  range?: HistoryRange;
  compare?: boolean;
  now?: number;
} = {}): Promise<PriceHistory> {
  const marks = historyMarks(range, now);
  const points = bucketSamples(await readSamples(marks, range), marks, range);

  if (!compare) return { points, comparison: null };

  // Same clock time a week back, which is the same weekday — a Monday rush
  // hour is only worth comparing against another Monday rush hour.
  const shift = now - sameClockTimeLastWeek(now);
  const pastMarks = marks.map((mark) => mark - shift);
  const past = bucketSamples(
    await readSamples(pastMarks, range),
    pastMarks,
    range,
  );

  return {
    points,
    // Re-stamped onto this week's marks so both series share one axis.
    comparison: past.map((point, index) => ({
      t: points[index].t,
      price: point.price,
    })),
  };
}
