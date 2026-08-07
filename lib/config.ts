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

/** How long the browser may reuse a price reading before we refetch. */
export const PRICE_CACHE_MS = 20_000;

/** Israel is the only place this road exists, so timestamps are shown there. */
export const DISPLAY_TIME_ZONE = "Asia/Jerusalem";
