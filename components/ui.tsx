"use client";

import type { ReactNode } from "react";

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
