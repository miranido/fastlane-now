import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parsePriceEnvelope } from "@/lib/price";
import { recordPrice } from "@/lib/price-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the price actually enters the system.
 *
 * fastlane.co.il's Cloudflare returns 403 to every cloud provider we tried, so
 * the fetch has to happen on an ordinary Israeli connection. scripts/
 * fetch-price.mjs runs there once a minute and posts the untouched upstream
 * envelope here; parsing stays server-side so the fetcher never needs updating
 * when the payload shape changes.
 */
function isAuthorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided = request.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let envelope: unknown;
  try {
    envelope = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let snapshot;
  try {
    snapshot = parsePriceEnvelope(envelope);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unparseable";
    return NextResponse.json({ error: "invalid_payload", reason }, { status: 400 });
  }

  try {
    await recordPrice(snapshot);
  } catch (error) {
    console.error("ingest: failed to store price", error);
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    price: snapshot.price,
    observedAt: snapshot.observedAt,
  });
}
