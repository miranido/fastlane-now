"use client";

import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { clockFormatter } from "@/lib/time";

/** One five-minute mark. `price` is null when no reading vouches for it. */
export type HistoryPoint = { t: string; price: number | null };

/* Geometry in the SVG's own units — it scales to whatever width the card is. */
const WIDTH = 320;
const HEIGHT = 132;
const PAD = { top: 12, right: 10, bottom: 20, left: 28 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;

/** Time labels go on the quarter hours. Israel's offset is whole hours, so a
 * quarter hour in UTC is a quarter hour on the clock people are reading. */
const LABEL_EVERY_MS = 15 * 60_000;

type Vertex = { x: number; y: number };
type KnownPoint = { t: string; price: number };

function round(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * A staircase, not a slope: a toll holds at one price until the operator
 * changes it, so each segment runs flat to the next mark and then steps.
 */
function stepPath(run: Vertex[]) {
  return run
    .map((vertex, index) =>
      index === 0
        ? `M${round(vertex.x)} ${round(vertex.y)}`
        : `L${round(vertex.x)} ${round(run[index - 1].y)}L${round(vertex.x)} ${round(vertex.y)}`,
    )
    .join("");
}

export function PriceChart({
  points,
  locale,
}: {
  points: HistoryPoint[];
  locale: Locale;
}) {
  const t = useTranslations("chart");

  const known = points.filter(
    (point): point is KnownPoint => point.price !== null,
  );

  const chart = known.length >= 2 ? buildChart(points, known, locale) : null;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-navy">{t("heading")}</h2>
        <p className="text-xs text-faint">{t("hint")}</p>
      </div>

      {chart ? (
        <>
          {/* Time runs left to right in both languages: the axis is a number
              line, and mirroring it would only make the graph harder to read. */}
          <div dir="ltr" className="mt-3">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto w-full overflow-visible"
              role="img"
              aria-label={
                chart.flat
                  ? t("summaryFlat", { price: chart.low })
                  : t("summary", {
                      low: chart.low,
                      high: chart.high,
                      current: chart.current,
                    })
              }
            >
              <defs>
                <linearGradient id="price-fade" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-tangerine)"
                    stopOpacity="0.22"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-tangerine)"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>

              {/* The prices the graph actually reached, as dashed rules. */}
              {chart.rules.map((rule) => (
                <g key={rule.value}>
                  <line
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={rule.y}
                    y2={rule.y}
                    className="stroke-line"
                    strokeWidth={1}
                    strokeDasharray="3 4"
                  />
                  <text
                    x={PAD.left - 6}
                    y={rule.y + 3}
                    textAnchor="end"
                    fontSize={9}
                    className="numeric fill-faint"
                  >
                    {rule.label}
                  </text>
                </g>
              ))}

              {chart.runs.map((run, index) =>
                run.length > 1 ? (
                  <g key={index}>
                    <path
                      d={`${stepPath(run)}L${round(run[run.length - 1].x)} ${BASELINE}L${round(run[0].x)} ${BASELINE}Z`}
                      fill="url(#price-fade)"
                    />
                    <path
                      d={stepPath(run)}
                      fill="none"
                      className="stroke-tangerine"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                ) : (
                  // A lone reading between two outages: nothing to draw a line
                  // to, but it still happened.
                  <circle
                    key={index}
                    cx={round(run[0].x)}
                    cy={round(run[0].y)}
                    r={2}
                    className="fill-tangerine"
                  />
                ),
              )}

              {/* Where the graph meets the big number above it. */}
              <circle
                cx={round(chart.head.x)}
                cy={round(chart.head.y)}
                r={3.5}
                className="fill-tangerine stroke-card"
                strokeWidth={2}
              />

              {chart.ticks.map((tick) => (
                <text
                  key={tick.label + tick.x}
                  x={tick.x}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  fontSize={9}
                  className="numeric fill-faint"
                >
                  {tick.label}
                </text>
              ))}
            </svg>
          </div>

          {chart.hasGaps ? (
            <p className="mt-2 text-xs text-faint">{t("gapNote")}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">{t("empty")}</p>
      )}
    </section>
  );
}

/** Everything the SVG needs, worked out in one pass over the marks. */
function buildChart(
  points: HistoryPoint[],
  known: KnownPoint[],
  locale: Locale,
) {
  const times = points.map((point) => new Date(point.t).getTime());
  const first = times[0];
  const span = Math.max(times[times.length - 1] - first, 1);
  const x = (ms: number) => PAD.left + ((ms - first) / span) * PLOT_W;

  const values = known.map((point) => point.price);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // An hour at one price is the common case, and it should read as a steady
  // line through the middle rather than a division by zero.
  const headroom = high === low ? 1 : (high - low) * 0.35;
  const domainLow = low - headroom;
  const domainHigh = high + headroom;
  const y = (value: number) =>
    PAD.top + (1 - (value - domainLow) / (domainHigh - domainLow)) * PLOT_H;

  const runs: Vertex[][] = [];
  let run: Vertex[] = [];
  points.forEach((point, index) => {
    if (point.price === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: x(times[index]), y: y(point.price) });
  });
  if (run.length) runs.push(run);

  const clock = clockFormatter(locale);
  const ticks = times
    .filter((ms) => ms % LABEL_EVERY_MS === 0)
    .map((ms) => ({
      // Keep the outermost labels inside the box rather than half off it.
      x: Math.min(Math.max(x(ms), 12), WIDTH - 12),
      label: clock.format(new Date(ms)),
    }));

  const head = runs[runs.length - 1].at(-1)!;

  return {
    runs,
    ticks,
    head,
    rules: Array.from(new Set([high, low])).map((value) => ({
      value,
      y: y(value),
      label: String(value),
    })),
    low,
    high,
    current: known[known.length - 1].price,
    flat: high === low && known.length === points.length,
    hasGaps: known.length !== points.length,
  };
}
