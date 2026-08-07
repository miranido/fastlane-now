#!/usr/bin/env node
/**
 * Reads the Fast Lane price and posts it to the app.
 *
 * This exists because fastlane.co.il sits behind Cloudflare, which answers 403
 * to cloud providers — Vercel, Supabase's Postgres egress and Cloudflare
 * Workers were all refused, while an ordinary Israeli connection is served
 * normally. So the one request that has to originate from Israel does, and
 * everything else stays serverless.
 *
 * Deliberately dumb: it forwards the untouched upstream envelope and lets the
 * server parse it, so a change to the payload shape never means redeploying
 * whatever machine this runs on.
 *
 * Run once:   node scripts/fetch-price.mjs
 * Every min:  see scripts/com.fastlane-now.fetcher.plist
 *
 * Needs INGEST_URL and CRON_SECRET in the environment, or a .env.local
 * alongside the project root.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PRICE_ENDPOINT =
  "https://fastlane.co.il/PageMethodsService.asmx/GetCurrentPrice";

/**
 * Honest identification with a link back to the project. This exact agent is
 * served normally, so there is nothing to gain from impersonating a browser.
 */
const UPSTREAM_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://fastlane.co.il/",
  "User-Agent":
    "Mozilla/5.0 (compatible; FastLaneNow/1.0; +https://github.com/miranido/fastlane-now)",
};

const TIMEOUT_MS = 15_000;

/** Reads .env.local so the launchd job doesn't need its own copy of secrets. */
function loadEnvFile() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const text = readFileSync(join(here, "..", ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // Not there — rely on the real environment.
  }
}

function log(level, message, extra) {
  const line = { at: new Date().toISOString(), level, message, ...extra };
  console[level === "error" ? "error" : "log"](JSON.stringify(line));
}

async function main() {
  loadEnvFile();

  const ingestUrl =
    process.env.INGEST_URL ??
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/price/ingest`
      : null);
  const secret = process.env.CRON_SECRET;

  if (!ingestUrl || !secret) {
    log("error", "missing INGEST_URL or CRON_SECRET");
    process.exit(1);
  }

  let envelope;
  try {
    const response = await fetch(PRICE_ENDPOINT, {
      method: "POST",
      headers: UPSTREAM_HEADERS,
      body: "",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // 403 here means this machine is being blocked too — check it's on an
      // ordinary Israeli connection and not a VPN exiting somewhere else.
      log("error", "upstream refused", { status: response.status });
      process.exit(1);
    }
    envelope = await response.json();
  } catch (error) {
    log("error", "upstream unreachable", { reason: String(error) });
    process.exit(1);
  }

  try {
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      log("error", "ingest rejected", { status: response.status, body });
      process.exit(1);
    }
    log("info", "posted", { price: body.price, observedAt: body.observedAt });
  } catch (error) {
    log("error", "ingest unreachable", { reason: String(error) });
    process.exit(1);
  }
}

await main();
