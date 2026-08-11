import { NextResponse } from "next/server";
import {
  DEFAULT_HISTORY_RANGE,
  HISTORY_RANGES,
  isValidHistoryRange,
} from "@/lib/config";
import { readPriceHistory } from "@/lib/price-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The stored readings behind the graph.
 *
 *   ?range=30m|1h|2h   how far back, and how finely (see HISTORY_RANGES)
 *   ?compare=1         also return the same clock hours seven days earlier
 *
 * Marks with no reading behind them come back null rather than carrying an old
 * price forward — the same honesty the live display keeps, drawn as a break in
 * the line instead of an invented flat stretch.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const asked = params.get("range");
  // An unknown range is a stale client or a typed URL, not a reason to 400.
  const range = isValidHistoryRange(asked) ? asked : DEFAULT_HISTORY_RANGE;
  const compare = params.get("compare") === "1";

  let history;
  try {
    history = await readPriceHistory({ range, compare });
  } catch (error) {
    console.error("price history: read failed", error);
    return NextResponse.json(
      { error: "history_unavailable", reason: "storage_error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { range, ...HISTORY_RANGES[range], ...history },
    {
      // Same short window as /api/price: readings arrive once a minute. Each
      // range and compare setting is its own URL, so each caches separately.
      headers: {
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
      },
    },
  );
}
