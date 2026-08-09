/** Choices offered in the UI, and the only values the API will accept. */
export const INTERVAL_CHOICES = [1, 2, 5, 10, 15, 30] as const;
export const DURATION_CHOICES = [30, 60, 120] as const;

export type IntervalMinutes = (typeof INTERVAL_CHOICES)[number];
export type DurationMinutes = (typeof DURATION_CHOICES)[number];

export const DEFAULT_INTERVAL: IntervalMinutes = 5;
export const DEFAULT_DURATION: DurationMinutes = 60;

export function isValidInterval(value: unknown): value is IntervalMinutes {
  return INTERVAL_CHOICES.includes(value as IntervalMinutes);
}

export function isValidDuration(value: unknown): value is DurationMinutes {
  return DURATION_CHOICES.includes(value as DurationMinutes);
}

/* --- what a session is watching for --------------------------------------- */

/**
 * `target` and `drop` are watches: silent until the road does something worth
 * knowing about, then one notification and they're done. `interval` is the
 * original behaviour — a price every N minutes whether or not it moved.
 *
 * Order matters: it's the order the UI offers them, and `target` leads.
 */
export const ALERT_MODES = ["target", "drop", "interval"] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

export const DEFAULT_MODE: AlertMode = "target";

/** True for the modes that evaluate a condition rather than run on a clock. */
export function isWatchMode(mode: AlertMode): mode is "target" | "drop" {
  return mode === "target" || mode === "drop";
}

/**
 * How long a condition has to hold before we act on it. The whole point of a
 * price watch is to skip the blips: the price dipping under the threshold for
 * one reading and bouncing straight back isn't something you can act on, since
 * by the time you've read the notification it's over.
 */
export const STABILITY_CHOICES = [5, 10, 15] as const;
export type StabilityMinutes = (typeof STABILITY_CHOICES)[number];
export const DEFAULT_STABILITY: StabilityMinutes = 5;

/** Watches are evaluated on every tick, so they fire within a minute. */
export const WATCH_EVALUATION_MINUTES = 1;

/**
 * ₪20 is roughly the middle of the road's range and the number most people
 * seem to have in their head for "worth it" — a good place to start, and one
 * tap away from anything else.
 */
export const DEFAULT_TARGET_PRICE = 20;
export const MIN_TARGET_PRICE = 1;
export const MAX_TARGET_PRICE = 999;
export const TARGET_PRICE_STEP = 1;

export function isValidMode(value: unknown): value is AlertMode {
  return ALERT_MODES.includes(value as AlertMode);
}

export function isValidStability(value: unknown): value is StabilityMinutes {
  return STABILITY_CHOICES.includes(value as StabilityMinutes);
}

/**
 * A threshold the database and the UI can both live with, or null if it isn't
 * one. Prices come in whole shekels today, but a tenth costs nothing to allow
 * and saves a migration if that ever changes.
 */
export function normaliseTargetPrice(value: unknown): number | null {
  const price = Number(value);
  if (!Number.isFinite(price)) return null;

  const rounded = Math.round(price * 10) / 10;
  if (rounded < MIN_TARGET_PRICE || rounded > MAX_TARGET_PRICE) return null;
  return rounded;
}

/** How long the browser may reuse a price reading before we refetch. */
export const PRICE_CACHE_MS = 20_000;

/**
 * How old a reading may be before we treat it as no reading at all. Three
 * missed minutes means the fetcher is down, and showing a price from an hour
 * ago as if it were current would be worse than showing nothing.
 */
export const PRICE_STALE_AFTER_MS = 3 * 60_000;

/** Israel is the only place this road exists, so timestamps are shown there. */
export const DISPLAY_TIME_ZONE = "Asia/Jerusalem";
