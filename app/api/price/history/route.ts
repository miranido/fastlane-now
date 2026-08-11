import { NextResponse } from "next/server";
import { HISTORY_BUCKET_MINUTES, HISTORY_WINDOW_MINUTES } from "@/lib/config";
import { readPriceHistory } from "@/lib/price-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The last hour of stored readings, as five-minute steps, for the graph.
 *
 * Marks with no fresh reading behind them come back null rather than carrying
 * an old price forward — the same honesty the live display keeps, drawn as a
 * break in the line instead of an invented flat stretch.
 */
export async function GET() {
  let points;
  try {
    points = await readPriceHistory();
  } catch (error) {
    console.error("price history: read failed", error);
    return NextResponse.json(
      { error: "history_unavailable", reason: "storage_error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      windowMinutes: HISTORY_WINDOW_MINUTES,
      bucketMinutes: HISTORY_BUCKET_MINUTES,
      points,
    },
    {
      // Same short window as /api/price: readings arrive once a minute.
      headers: {
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
      },
    },
  );
}
