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

/**
 * The spans the price graph can show, and how finely each is cut.
 *
 * `sample` marks take the last reading at or before them — the price actually
 * in effect at that moment. `average` marks take the mean of the readings in
 * the window behind them, which is the only thing a quarter-hour bucket can
 * honestly say when the price moved twice inside it.
 */
export const HISTORY_RANGES = {
  "30m": {
    windowMinutes: 30,
    bucketMinutes: 2,
    mode: "sample",
    labelEveryMinutes: 10,
  },
  "1h": {
    windowMinutes: 60,
    bucketMinutes: 5,
    mode: "sample",
    labelEveryMinutes: 15,
  },
  "2h": {
    windowMinutes: 120,
    bucketMinutes: 15,
    mode: "average",
    labelEveryMinutes: 30,
  },
} as const;

export type HistoryRange = keyof typeof HISTORY_RANGES;

export const HISTORY_RANGE_CHOICES = Object.keys(HISTORY_RANGES) as [
  HistoryRange,
  ...HistoryRange[],
];

export const DEFAULT_HISTORY_RANGE: HistoryRange = "1h";

export function isValidHistoryRange(value: unknown): value is HistoryRange {
  return typeof value === "string" && value in HISTORY_RANGES;
}

/** The overlay compares against the same clock time seven days earlier. */
export const COMPARISON_DAYS_BACK = 7;

/** Israel is the only place this road exists, so timestamps are shown there. */
export const DISPLAY_TIME_ZONE = "Asia/Jerusalem";
