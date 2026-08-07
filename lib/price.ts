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
  /** Upstream HTTP status, when there was one. Absent for network errors. */
  readonly status?: number;

  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options);
    this.name = "PriceUnavailableError";
    this.status = options?.status;
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

/**
 * The site sits behind Cloudflare, which scores the whole header fingerprint,
 * not just the IP. A bare server-side fetch — no Accept-Language, no
 * sec-fetch-*, and a self-identifying bot User-Agent — looks nothing like the
 * XHR the homepage actually sends, and gets challenged when it arrives from a
 * datacenter range. These mirror the real request.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=UTF-8",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Origin: "https://fastlane.co.il",
  Referer: "https://fastlane.co.il/",
  "X-Requested-With": "XMLHttpRequest",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
};

function requestPrice(): Promise<Response> {
  return fetch(PRICE_ENDPOINT, {
    method: "POST",
    headers: BROWSER_HEADERS,
    body: "",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function fetchCurrentPrice(): Promise<PriceSnapshot> {
  let response: Response;
  try {
    response = await requestPrice();
    // A single retry: an edge that challenges a cold connection will often
    // wave through the one right behind it.
    if (!response.ok) response = await requestPrice();
  } catch (cause) {
    throw new PriceUnavailableError("Price endpoint unreachable", { cause });
  }

  if (!response.ok) {
    throw new PriceUnavailableError(
      `Price endpoint returned HTTP ${response.status}`,
      { status: response.status },
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
