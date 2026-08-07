import { DISPLAY_TIME_ZONE } from "./config";

/**
 * The Fast Lane site is ASP.NET WebForms. Its own homepage polls this page
 * method every 20 seconds to refresh the price, so we call exactly the same
 * thing — no scraping, no headless browser.
 *
 * It answers with a JSON envelope whose single field is itself a JSON string:
 *   {"d":"{\"Price\":\"8\",\"PriceDateTime\":\"\\/Date(1786112069880)\\/\",...}"}
 */
const PRICE_ENDPOINT =
  "https://fastlane.co.il/PageMethodsService.asmx/GetCurrentPrice";

const REQUEST_TIMEOUT_MS = 10_000;

export type PriceSnapshot = {
  /** Numeric price in shekels, for comparisons. */
  price: number;
  /** Exactly what the site returned, for display. */
  raw: string;
  /** When the operator says this price was set. */
  observedAt: string;
  /** The operator's own "HH:mm", already in Israel time. */
  timeStr: string;
  dateStr: string;
};

export class PriceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PriceUnavailableError";
  }
}

type RawPricePayload = {
  Price?: string;
  PriceDateTime?: string;
  PriceDateStr?: string;
  PriceTimeStr?: string;
};

/** Parses the .NET serialiser's `/Date(1786112069880)/` form. */
function parseDotNetDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatInIsrael(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: DISPLAY_TIME_ZONE,
    ...options,
  }).format(date);
}

export async function fetchCurrentPrice(): Promise<PriceSnapshot> {
  let response: Response;
  try {
    response = await fetch(PRICE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: "https://fastlane.co.il/",
        "User-Agent":
          "Mozilla/5.0 (compatible; FastLaneNow/1.0; +https://github.com/)",
      },
      body: "",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new PriceUnavailableError("Price endpoint unreachable", { cause });
  }

  if (!response.ok) {
    throw new PriceUnavailableError(
      `Price endpoint returned HTTP ${response.status}`,
    );
  }

  let payload: RawPricePayload;
  try {
    const envelope = (await response.json()) as { d?: unknown };
    payload =
      typeof envelope.d === "string"
        ? (JSON.parse(envelope.d) as RawPricePayload)
        : (envelope.d as RawPricePayload);
  } catch (cause) {
    throw new PriceUnavailableError("Price response was not valid JSON", {
      cause,
    });
  }

  const raw = (payload?.Price ?? "").trim();
  const price = Number(raw.replace(/[^\d.-]/g, ""));
  if (!raw || !Number.isFinite(price)) {
    throw new PriceUnavailableError(`Price response had no usable price`);
  }

  const observed = parseDotNetDate(payload.PriceDateTime) ?? new Date();

  return {
    price,
    raw,
    observedAt: observed.toISOString(),
    // Prefer the operator's own strings; fall back to formatting ourselves.
    timeStr:
      payload.PriceTimeStr?.trim() ||
      formatInIsrael(observed, { hour: "2-digit", minute: "2-digit" }),
    dateStr:
      payload.PriceDateStr?.trim() ||
      formatInIsrael(observed, { dateStyle: "long" }),
  };
}
