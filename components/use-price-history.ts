"use client";

import { useCallback, useState } from "react";
import { DEFAULT_HISTORY_RANGE, type HistoryRange } from "@/lib/config";

/** One mark on the graph. `price` is null when no reading vouches for it. */
export type HistoryPoint = { t: string; price: number | null };

export type PriceHistory = {
  points: HistoryPoint[];
  /** Last week's matching hours, aligned onto this week's marks. */
  comparison: HistoryPoint[] | null;
};

/**
 * The graph's data and the two controls that change what the server sends.
 *
 * Fetching deliberately stays out of here: the page already polls on a timer
 * and on the pull-to-refresh gesture, so it drives `load` instead, and a
 * changed range simply gives it a new function to call.
 */
export function usePriceHistory() {
  const [range, setRange] = useState<HistoryRange>(DEFAULT_HISTORY_RANGE);
  const [compare, setCompare] = useState(false);
  const [history, setHistory] = useState<PriceHistory | null>(null);

  const load = useCallback(() => {
    const query = `range=${range}${compare ? "&compare=1" : ""}`;
    return fetch(`/api/price/history?${query}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PriceHistory>;
      })
      .then((data) =>
        setHistory({ points: data.points, comparison: data.comparison }),
      )
      .catch(() => setHistory(null));
  }, [range, compare]);

  return { range, setRange, compare, setCompare, history, load };
}
