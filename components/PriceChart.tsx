"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  HISTORY_RANGES,
  HISTORY_RANGE_CHOICES,
  type HistoryRange,
} from "@/lib/config";
import type { Locale } from "@/i18n/routing";
import { clockFormatter } from "@/lib/time";
import type { HistoryPoint, PriceHistory } from "./use-price-history";

/* Geometry in the SVG's own units — it scales to whatever width the card is. */
const WIDTH = 320;
const HEIGHT = 140;
const PAD = { top: 12, right: 10, bottom: 28, left: 28 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;

const HOUR_MS = 60 * 60_000;

type Vertex = { x: number; y: number };
type KnownPoint = { t: string; price: number };

function round(value: number) {
  return Math.round(value * 10) / 10;
}

/** Whole shekels stay whole; averaged buckets get one decimal, not four. */
function formatPrice(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A staircase: a toll holds at one price until the operator changes it, so
 * each segment runs flat to the next mark and then steps.
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

/**
 * The smooth alternative, as a monotone cubic (Fritsch–Carlson).
 *
 * An ordinary spline through these points would overshoot at every step and
 * draw prices below the cheapest reading and above the dearest — inventing
 * numbers the road never charged. A monotone fit can't: between two marks it
 * stays within the values of those marks. It still implies the price slid from
 * one to the other, which is why the steps view is one tap away.
 */
function smoothPath(run: Vertex[]) {
  const n = run.length;
  if (n < 3) return stepPathless(run);

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = run[i + 1].x - run[i].x;
    slope[i] = (run[i + 1].y - run[i].y) / dx[i];
  }

  // Tangent at each point, flattened wherever the direction changes so the
  // curve turns at the reading rather than sailing past it.
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M${round(run[0].x)} ${round(run[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    d +=
      `C${round(run[i].x + third)} ${round(run[i].y + m[i] * third)}` +
      ` ${round(run[i + 1].x - third)} ${round(run[i + 1].y - m[i + 1] * third)}` +
      ` ${round(run[i + 1].x)} ${round(run[i + 1].y)}`;
  }
  return d;
}

/** Two points can only be a straight line, whichever mode is on. */
function stepPathless(run: Vertex[]) {
  return run
    .map((v, i) => `${i === 0 ? "M" : "L"}${round(v.x)} ${round(v.y)}`)
    .join("");
}

function closeToBaseline(d: string, run: Vertex[]) {
  return `${d}L${round(run[run.length - 1].x)} ${BASELINE}L${round(run[0].x)} ${BASELINE}Z`;
}

export function PriceChart({
  history,
  locale,
  range,
  onRangeChange,
  compare,
  onCompareChange,
}: {
  history: PriceHistory;
  locale: Locale;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  compare: boolean;
  onCompareChange: (compare: boolean) => void;
}) {
  const t = useTranslations("chart");
  // Smoothed by default; the staircase is what the price literally did, and
  // it's one tap away for anyone who wants it.
  const [smooth, setSmooth] = useState(true);

  const chart = buildChart(history, range, locale, smooth, compare);

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-navy">{t("heading")}</h2>
          <p className="mt-0.5 text-xs text-faint">{t(`resolution.${range}`)}</p>
        </div>
        <PillGroup
          label={t("rangeLabel")}
          options={HISTORY_RANGE_CHOICES.map((key) => ({
            value: key,
            label: t(`range.${key}`),
          }))}
          value={range}
          onChange={onRangeChange}
        />
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
              aria-label={[
                chart.flat
                  ? t("summaryFlat", { price: formatPrice(chart.low) })
                  : t("summary", {
                      low: formatPrice(chart.low),
                      high: formatPrice(chart.high),
                      current: formatPrice(chart.current),
                    }),
                chart.past
                  ? t("summaryCompare", {
                      low: formatPrice(chart.past.low),
                      high: formatPrice(chart.past.high),
                    })
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
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

              {/* Each whole hour gets a line of its own, so the shape of the
                  graph is pinned to the clock at a glance. */}
              {chart.ticks
                .filter((tick) => tick.hour)
                .map((tick) => (
                  <line
                    key={`hour-${tick.x}`}
                    x1={tick.at}
                    x2={tick.at}
                    y1={PAD.top}
                    y2={BASELINE + 3}
                    className="stroke-line"
                    strokeWidth={1}
                  />
                ))}

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

              {/* Last week first, so this week's line sits on top of it. */}
              {chart.past?.runs.map((run, index) =>
                run.length > 1 ? (
                  <path
                    key={`past-${index}`}
                    d={chart.draw(run)}
                    fill="none"
                    className="stroke-navy-soft"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.75}
                  />
                ) : null,
              )}

              {chart.runs.map((run, index) =>
                run.length > 1 ? (
                  <g key={index}>
                    <path
                      d={closeToBaseline(chart.draw(run), run)}
                      fill="url(#price-fade)"
                    />
                    <path
                      d={chart.draw(run)}
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
                  key={`label-${tick.x}`}
                  x={tick.x}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  fontSize={tick.hour ? 10 : 9}
                  fontWeight={tick.hour ? 700 : 400}
                  className={tick.hour ? "numeric fill-navy" : "numeric fill-faint"}
                >
                  {tick.label}
                </text>
              ))}
            </svg>
          </div>

          {chart.past ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-4 rounded bg-tangerine"
                />
                {t("legendNow")}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-0 w-4 border-t-2 border-dashed border-navy-soft"
                />
                {t("legendLastWeek")}
              </span>
            </p>
          ) : null}

          {chart.hasGaps ? (
            <p className="mt-2 text-xs text-faint">{t("gapNote")}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">{t("empty")}</p>
      )}

      {chart && compare && !chart.past ? (
        <p className="mt-2 text-xs text-faint">{t("noComparison")}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <PillGroup
          label={t("curve.label")}
          options={[
            { value: "smooth", label: t("curve.smooth") },
            { value: "steps", label: t("curve.steps") },
          ]}
          value={smooth ? "smooth" : "steps"}
          onChange={(value) => setSmooth(value === "smooth")}
        />
        <button
          type="button"
          aria-pressed={compare}
          onClick={() => onCompareChange(!compare)}
          className={[
            "rounded-full border px-3 py-1 text-xs font-medium transition",
            compare
              ? "border-navy-soft bg-navy-soft/15 text-navy"
              : "border-line bg-paper text-muted hover:border-line-strong",
          ].join(" ")}
        >
          {t("compare")}
        </button>
      </div>
    </section>
  );
}

/** A compact row of exclusive choices, sized for a card header. */
function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 gap-1 rounded-full border border-line bg-paper p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={[
              "rounded-full px-2.5 py-1 text-xs font-medium transition",
              selected
                ? "bg-navy text-white shadow-sm"
                : "text-muted hover:text-navy",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Splits a series into runs of consecutive marks that have a price. */
function toRuns(
  points: HistoryPoint[],
  x: (ms: number) => number,
  y: (value: number) => number,
) {
  const runs: Vertex[][] = [];
  let run: Vertex[] = [];

  points.forEach((point) => {
    if (point.price === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: x(Date.parse(point.t)), y: y(point.price) });
  });
  if (run.length) runs.push(run);

  return runs;
}

function known(points: HistoryPoint[]): KnownPoint[] {
  return points.filter((point): point is KnownPoint => point.price !== null);
}

/** Everything the SVG needs, worked out in one pass over the marks. */
function buildChart(
  history: PriceHistory,
  range: HistoryRange,
  locale: Locale,
  smooth: boolean,
  compare: boolean,
) {
  const { points } = history;
  const here = known(points);
  if (here.length < 2) return null;

  // Only overlay last week if there's enough of it to draw a line with.
  const comparison =
    compare && history.comparison && known(history.comparison).length >= 2
      ? history.comparison
      : null;
  const there = comparison ? known(comparison) : [];

  const times = points.map((point) => Date.parse(point.t));
  const first = times[0];
  const span = Math.max(times[times.length - 1] - first, 1);
  const x = (ms: number) => PAD.left + ((ms - first) / span) * PLOT_W;

  // Both series share one scale, or the overlay would flatter whichever week
  // happened to be cheaper.
  const values = [...here, ...there].map((point) => point.price);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // An hour at one price is the common case, and it should read as a steady
  // line through the middle rather than a division by zero.
  const headroom = high === low ? 1 : (high - low) * 0.35;
  const y = (value: number) =>
    PAD.top + (1 - (value - (low - headroom)) / (2 * headroom + high - low)) * PLOT_H;

  const draw = smooth ? smoothPath : stepPath;
  const runs = toRuns(points, x, y);

  const { labelEveryMinutes } = HISTORY_RANGES[range];
  const labelEveryMs = labelEveryMinutes * 60_000;
  const clock = clockFormatter(locale);
  const ticks = times
    .filter((ms) => ms % labelEveryMs === 0)
    .map((ms) => ({
      at: x(ms),
      // Keep the outermost labels inside the box rather than half off it.
      x: Math.min(Math.max(x(ms), 14), WIDTH - 14),
      label: clock.format(new Date(ms)),
      hour: ms % HOUR_MS === 0,
    }));

  const hereValues = here.map((point) => point.price);
  const thereValues = there.map((point) => point.price);

  return {
    draw,
    runs,
    ticks,
    head: runs[runs.length - 1].at(-1)!,
    rules: Array.from(new Set([high, low])).map((value) => ({
      value,
      y: y(value),
      label: formatPrice(value),
    })),
    low: Math.min(...hereValues),
    high: Math.max(...hereValues),
    current: here[here.length - 1].price,
    flat:
      Math.min(...hereValues) === Math.max(...hereValues) &&
      here.length === points.length,
    hasGaps: here.length !== points.length,
    past: comparison
      ? {
          runs: toRuns(comparison, x, y),
          low: Math.min(...thereValues),
          high: Math.max(...thereValues),
        }
      : null,
  };
}
