import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import he from "@/messages/he.json";
import { DISPLAY_TIME_ZONE } from "@/lib/config";
import type { PriceSnapshot } from "@/lib/price";
import type { NotificationPayload } from "./types";

type Locale = "he" | "en";

const messagesByLocale = { he, en } as const;

function translator(locale: Locale) {
  return createTranslator({
    locale,
    messages: messagesByLocale[locale],
  });
}

function timeInIsrael(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function intervalLabel(locale: Locale, minutes: number) {
  return translator(locale)("form.minutes", { count: minutes });
}

function appUrl(locale: Locale) {
  return locale === "he" ? "/" : "/en";
}

/** The confirmation sent the moment someone turns tracking on. */
export function buildStartNotification(options: {
  locale: Locale;
  snapshot: PriceSnapshot;
  intervalMinutes: number;
  expiresAt: string;
}): NotificationPayload {
  const { locale, snapshot, intervalMinutes, expiresAt } = options;
  const t = translator(locale);

  return {
    title: t("notify.startTitle", { price: snapshot.raw }),
    body: t("notify.startBody", {
      interval: intervalLabel(locale, intervalMinutes),
      until: timeInIsrael(expiresAt, locale),
    }),
    url: appUrl(locale),
    tag: "fastlane-price",
    locale,
  };
}

/** A regular interval update. */
export function buildPriceNotification(options: {
  locale: Locale;
  snapshot: PriceSnapshot;
  previousPrice: number | null;
  isFinal: boolean;
}): NotificationPayload {
  const { locale, snapshot, previousPrice, isFinal } = options;
  const t = translator(locale);
  const time = snapshot.timeStr || timeInIsrael(snapshot.observedAt, locale);

  const changed = previousPrice !== null && previousPrice !== snapshot.price;

  const body = isFinal
    ? t("notify.finalBody", { time })
    : changed
      ? t("notify.bodyChanged", { time, previous: String(previousPrice) })
      : t("notify.body", { time });

  return {
    title: t("notify.title", { price: snapshot.raw }),
    body,
    url: appUrl(locale),
    tag: "fastlane-price",
    locale,
  };
}
