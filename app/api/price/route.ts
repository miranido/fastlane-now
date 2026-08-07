import { NextResponse } from "next/server";
import { PRICE_CACHE_MS } from "@/lib/config";
import { fetchCurrentPrice, type PriceSnapshot } from "@/lib/price";

export const dynamic = "force-dynamic";

/**
 * Per-instance memo so a burst of clients doesn't turn into a burst of
 * requests to the operator. The CDN header below does the heavier lifting.
 */
let cached: { at: number; snapshot: PriceSnapshot } | null = null;

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.at < PRICE_CACHE_MS) {
    return NextResponse.json(cached.snapshot, {
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" },
    });
  }

  try {
    const snapshot = await fetchCurrentPrice();
    cached = { at: now, snapshot };
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" },
    });
  } catch {
    // Serving a slightly stale price beats showing an error.
    if (cached) {
      return NextResponse.json(
        { ...cached.snapshot, stale: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "price_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
