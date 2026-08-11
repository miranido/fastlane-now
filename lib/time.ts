import { DISPLAY_TIME_ZONE } from "./config";
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
