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

/**
 * Watch alerts get their own collapse key. A price update replacing an earlier
 * price update is helpful; a price update quietly replacing "it dropped to
 * ₪18" — the one notification the user was waiting for — is not.
 */
const WATCH_TAG = "fastlane-alert";

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

/** The confirmation sent when a price watch is armed. */
export function buildWatchStartNotification(options: {
  locale: Locale;
  snapshot: PriceSnapshot;
  mode: "target" | "drop";
  targetPrice: number | null;
  stabilityMinutes: number;
  expiresAt: string;
}): NotificationPayload {
  const { locale, snapshot, mode, targetPrice, stabilityMinutes, expiresAt } =
    options;
  const t = translator(locale);
  const window = intervalLabel(locale, stabilityMinutes);
  const until = timeInIsrael(expiresAt, locale);

  return {
    title: t("notify.watchStartTitle", { price: snapshot.raw }),
    body:
      mode === "target"
        ? t("notify.watchStartTargetBody", {
            target: String(targetPrice),
            window,
            until,
          })
        : t("notify.watchStartDropBody", { window, until }),
    url: appUrl(locale),
    tag: WATCH_TAG,
    locale,
  };
}

/** The one that matters: the condition the user was waiting for has held. */
export function buildWatchHitNotification(options: {
  locale: Locale;
  snapshot: PriceSnapshot;
  mode: "target" | "drop";
  targetPrice: number | null;
  /** Where the price fell from, for the drop watch. */
  fromPrice: number | null;
  stabilityMinutes: number;
}): NotificationPayload {
  const { locale, snapshot, mode, targetPrice, fromPrice, stabilityMinutes } =
    options;
  const t = translator(locale);
  const window = intervalLabel(locale, stabilityMinutes);

  return {
    title:
      mode === "target"
        ? t("notify.targetHitTitle", { price: snapshot.raw })
        : t("notify.dropHitTitle", { price: snapshot.raw }),
    body:
      mode === "target"
        ? t("notify.targetHitBody", { target: String(targetPrice), window })
        : t("notify.dropHitBody", {
            previous: String(fromPrice ?? snapshot.price),
            window,
          }),
    url: appUrl(locale),
    tag: WATCH_TAG,
    locale,
  };
}

/**
 * The watch ran its course without firing. Worth saying: silence is otherwise
 * indistinguishable from a watch that's still running, and someone waiting on
 * a price deserves to know nobody is watching for them any more.
 */
export function buildWatchEndedNotification(options: {
  locale: Locale;
  snapshot: PriceSnapshot;
  mode: "target" | "drop";
  targetPrice: number | null;
}): NotificationPayload {
  const { locale, snapshot, mode, targetPrice } = options;
  const t = translator(locale);

  return {
    title: t("notify.watchEndedTitle", { price: snapshot.raw }),
    body:
      mode === "target"
        ? t("notify.watchEndedTargetBody", { target: String(targetPrice) })
        : t("notify.watchEndedDropBody"),
    url: appUrl(locale),
    tag: WATCH_TAG,
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
