import { COMPARISON_DAYS_BACK, DISPLAY_TIME_ZONE } from "./config";
import type { Locale } from "@/i18n/routing";

/**
 * Clocks are always Israel time: it's where the road is, and it matches the
 * times the operator itself prints.
 */
const formatters = new Map<Locale, Intl.DateTimeFormat>();

export function clockFormatter(locale: Locale): Intl.DateTimeFormat {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
      timeZone: DISPLAY_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(locale, formatter);
  }
  return formatter;
}

export function formatClock(iso: string, locale: Locale): string {
  return clockFormatter(locale).format(new Date(iso));
}

const DAY_MS = 24 * 60 * 60_000;

const offsetParts = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far ahead of UTC Israel's clock is at a given instant. */
export function israelOffsetMs(at: number): number {
  const parts = offsetParts.formatToParts(new Date(at));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  // Both sides are whole seconds, so the instant's own milliseconds cancel.
  return asIfUtc - (at - (at % 1000));
}

/**
 * The instant a week earlier that reads the same on an Israeli clock.
 *
 * Not simply seven times 24 hours: the two Fridays around a daylight-saving
 * change are 167 or 169 hours apart, and comparing 17:00 against last week's
 * 16:00 would quietly misreport the evening rush by an hour.
 */
export function sameClockTimeLastWeek(at: number): number {
  const naive = at - COMPARISON_DAYS_BACK * DAY_MS;
  return naive + israelOffsetMs(at) - israelOffsetMs(naive);
}
