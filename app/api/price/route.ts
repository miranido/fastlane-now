import { NextResponse } from "next/server";
import { readLatestPrice } from "@/lib/price-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads whatever the fetcher last posted. The server never calls fastlane.co.il
 * itself — see /api/price/ingest and the README for why it can't.
 */
export async function GET() {
  let latest;
  try {
    latest = await readLatestPrice();
  } catch (error) {
    console.error("price: read failed", error);
    return NextResponse.json(
      { error: "price_unavailable", reason: "storage_error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Better to say nothing than to present an old price as the current one.
  if (!latest || latest.stale) {
    return NextResponse.json(
      {
        error: "price_unavailable",
        reason: latest ? "stale" : "no_readings",
        ageMs: latest?.ageMs,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ageMs/stale are internal bookkeeping; the client just wants the reading.
  return NextResponse.json(
    {
      price: latest.price,
      raw: latest.raw,
      observedAt: latest.observedAt,
      timeStr: latest.timeStr,
      dateStr: latest.dateStr,
    },
    {
      // Short window: readings arrive once a minute.
      headers: {
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
      },
    },
  );
}
