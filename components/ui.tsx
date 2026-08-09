"use client";

import { useState, type ReactNode } from "react";

type Option<T> = { value: T; label: string };

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  columns = 3,
  disabled = false,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className={`grid gap-2 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={[
                "rounded-2xl border px-2 py-3 text-base font-medium transition",
                "disabled:opacity-40",
                selected
                  ? "border-navy bg-navy text-white shadow-sm"
                  : "border-line bg-paper text-navy hover:border-line-strong",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The same choice as `Segmented`, stacked, with room for a line of
 * explanation. Used where the options aren't interchangeable settings but
 * genuinely different things to ask for, and the first one is the one most
 * people want.
 */
export function OptionCards<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={[
                "flex items-start gap-3 rounded-2xl border px-4 py-3 text-start transition",
                "disabled:opacity-40",
                selected
                  ? "border-navy bg-navy/5 shadow-sm"
                  : "border-line bg-paper hover:border-line-strong",
              ].join(" ")}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                  selected ? "border-navy" : "border-line-strong"
                }`}
              >
                {selected ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-navy" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold text-navy">
                  {option.label}
                </span>
                <span className="block text-sm text-faint">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A price, typed or nudged. The steppers exist because the common edit is
 * "₪20 is close, make it ₪18" and nobody wants to summon a keyboard for that;
 * the field stays typable because the uncommon edit is "make it ₪45".
 *
 * While the field has focus it shows exactly what was typed, so a half-finished
 * number isn't yanked out from under the caret. On blur it snaps back to the
 * committed value.
 */
export function PriceField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  currency,
  decrementLabel,
  incrementLabel,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  currency: string;
  decrementLabel: string;
  incrementLabel: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const nudge = (by: number) => {
    setDraft(null);
    onChange(clamp(Math.round((value + by) * 10) / 10));
  };

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted">{label}</p>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => nudge(-step)}
          disabled={disabled || value <= min}
          aria-label={decrementLabel}
          className="w-14 shrink-0 rounded-2xl border border-line bg-paper text-2xl font-bold text-navy transition hover:border-line-strong disabled:opacity-40"
        >
          −
        </button>

        <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 rounded-2xl border border-line bg-paper px-3 py-3">
          <input
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={draft ?? String(value)}
            aria-label={label}
            disabled={disabled}
            onChange={(event) => {
              const raw = event.target.value;
              setDraft(raw);
              const parsed = Number(raw);
              if (raw.trim() !== "" && Number.isFinite(parsed)) {
                onChange(clamp(Math.round(parsed * 10) / 10));
              }
            }}
            onFocus={(event) => event.target.select()}
            onBlur={() => setDraft(null)}
            className="numeric w-full min-w-0 bg-transparent text-center text-3xl font-bold text-navy outline-none disabled:opacity-40"
          />
          <span aria-hidden className="text-xl font-semibold text-tangerine">
            {currency}
          </span>
        </div>

        <button
          type="button"
          onClick={() => nudge(step)}
          disabled={disabled || value >= max}
          aria-label={incrementLabel}
          className="w-14 shrink-0 rounded-2xl border border-line bg-paper text-2xl font-bold text-navy transition hover:border-line-strong disabled:opacity-40"
        >
          +
        </button>
      </div>
      {hint ? <p className="mt-2 text-sm text-faint">{hint}</p> : null}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-start transition hover:border-line-strong disabled:opacity-40"
    >
      <span
        aria-hidden
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-tangerine" : "bg-navy/20"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "start-[1.375rem]" : "start-0.5"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-medium text-navy">{label}</span>
        {hint ? <span className="block text-sm text-faint">{hint}</span> : null}
      </span>
    </button>
  );
}

const TONE_STYLES = {
  info: "border-navy/25 bg-navy/5 text-navy",
  success: "border-success/30 bg-success/10 text-success",
  warn: "border-tangerine/40 bg-tangerine/10 text-tangerine",
  error: "border-danger/30 bg-danger/8 text-danger",
} as const;

export type NoticeTone = keyof typeof TONE_STYLES;

export function Notice({
  tone,
  title,
  children,
  onDismiss,
  dismissLabel,
}: {
  tone: NoticeTone;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <div
      role="status"
      className={`rounded-2xl border px-4 py-3 ${TONE_STYLES[tone]}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? (
        <div className="text-sm leading-relaxed text-ink/75">{children}</div>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 text-sm font-medium underline underline-offset-4"
        >
          {dismissLabel}
        </button>
      ) : null}
    </div>
  );
}
