"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  DEFAULT_DURATION,
  DEFAULT_INTERVAL,
  DURATION_CHOICES,
  INTERVAL_CHOICES,
  type DurationMinutes,
  type IntervalMinutes,
} from "@/lib/config";
import {
  detectCapability,
  registerServiceWorker,
  subscribeToPush,
  type PushCapability,
} from "@/lib/push-client";
import { formatClock } from "@/lib/time";
import { PriceChart } from "./PriceChart";
import { RoadBackdrop } from "./RoadBackdrop";
import { Notice, Segmented, Toggle, type NoticeTone } from "./ui";
import { usePriceHistory } from "./use-price-history";
import { usePullToRefresh } from "./use-pull-to-refresh";

const STORAGE_KEY = "fastlane-now.session";
const PRICE_POLL_MS = 30_000;
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type PriceState = {
  price: number;
  raw: string;
  observedAt: string;
  timeStr: string;
  dateStr: string;
  stale?: boolean;
};

type SessionView = {
  id: string;
  active: boolean;
  intervalMinutes: number;
  onlyOnChange: boolean;
  startedAt: string;
  expiresAt: string;
  nextRunAt: string;
  notificationsSent: number;
};

type StoredCredentials = { id: string; stopToken: string };

type NoticeState = {
  tone: NoticeTone;
  title?: string;
  body?: string;
  /** Technical cause, shown verbatim under an error. */
  detail?: string;
} | null;

type SubscribeResponse = {
  id: string;
  stopToken: string;
  intervalMinutes: number;
  onlyOnChange: boolean;
  startedAt: string;
  expiresAt: string;
  nextRunAt: string;
};

/**
 * "We couldn't enable notifications" on its own is unactionable — for the user
 * and for us. Every failure carries a short technical cause alongside it.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.name !== "Error"
      ? `${error.name}: ${error.message}`
      : error.message;
  }
  return String(error);
}

/** The `error` code of a failed API response, and whatever caused it. */
async function readApiError(
  response: Response,
): Promise<{ code: string | null; cause: string | null }> {
  try {
    const body = (await response.json()) as { error?: unknown; cause?: unknown };
    return {
      code: typeof body.error === "string" ? body.error : null,
      cause: typeof body.cause === "string" ? body.cause : null,
    };
  } catch {
    return { code: null, cause: null };
  }
}

/* --- push capability, as an external store ---------------------------------
 * It depends on browser APIs, so it can't be computed during SSR — and it can
 * change while the page is open, the moment someone installs the PWA and
 * launches it from the home screen. */
let capabilityCache: PushCapability | null = null;

function capabilitySnapshot(): PushCapability {
  if (capabilityCache === null) {
    capabilityCache = VAPID_PUBLIC_KEY ? detectCapability() : "unsupported";
  }
  return capabilityCache;
}

function capabilityServerSnapshot(): PushCapability {
  return "checking";
}

function subscribeToCapability(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  const handler = () => {
    capabilityCache = null;
    onChange();
  };
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}

function readStored(): StoredCredentials | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (!parsed.id || !parsed.stopToken) return null;
    return { id: parsed.id, stopToken: parsed.stopToken };
  } catch {
    return null;
  }
}

function clearStored() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode — nothing to clean up */
  }
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function fetchSession(
  credentials: StoredCredentials,
): Promise<SessionView | null> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const data = (await response.json()) as {
    found: boolean;
    session?: SessionView;
  };
  return data.found && data.session?.active ? data.session : null;
}

export function PriceApp({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const pathname = usePathname();
  const otherLocale: Locale = locale === "he" ? "en" : "he";

  const capability = useSyncExternalStore(
    subscribeToCapability,
    capabilitySnapshot,
    capabilityServerSnapshot,
  );

  const [price, setPrice] = useState<PriceState | null>(null);
  const [priceFailed, setPriceFailed] = useState(false);

  const {
    range,
    setRange,
    compare,
    setCompare,
    history,
    load: loadHistory,
  } = usePriceHistory();

  const [interval, setIntervalMinutes] =
    useState<IntervalMinutes>(DEFAULT_INTERVAL);
  const [duration, setDuration] = useState<DurationMinutes>(DEFAULT_DURATION);
  const [onlyOnChange, setOnlyOnChange] = useState(false);

  const [session, setSession] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  /** Client clock for the countdown; 0 until the first tick lands. */
  const [now, setNow] = useState(0);

  const lastSessionRefresh = useRef(0);

  // --- price --------------------------------------------------------------
  const loadPrice = useCallback(() => {
    return fetch("/api/price", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PriceState>;
      })
      .then((snapshot) => {
        setPrice(snapshot);
        setPriceFailed(false);
      })
      .catch(() => setPriceFailed(true));
  }, []);

  // Changing the range or turning the comparison on hands back a new
  // loadHistory, which re-runs the effect below: one fetch, no extra plumbing.
  const loadEverything = useCallback(() => {
    return Promise.all([loadPrice(), loadHistory()]);
  }, [loadPrice, loadHistory]);

  useEffect(() => {
    void loadEverything();
    const timer = window.setInterval(() => void loadEverything(), PRICE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadEverything();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadEverything]);

  // --- restore a session left running on this device ----------------------
  useEffect(() => {
    const stored = readStored();
    if (!stored) return;

    let cancelled = false;
    fetchSession(stored)
      .then((restored) => {
        if (cancelled) return;
        if (restored) {
          setSession(restored);
          setNow(Date.now());
        } else {
          clearStored();
        }
      })
      .catch(() => {
        /* offline — keep the form as-is */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSession = useCallback(async () => {
    const stored = readStored();
    if (!stored) return;
    lastSessionRefresh.current = Date.now();
    try {
      const refreshed = await fetchSession(stored);
      if (refreshed) {
        setSession(refreshed);
      } else {
        clearStored();
        setSession(null);
        setNotice({ tone: "info", body: t("session.expired") });
      }
    } catch {
      /* keep showing what we have */
    }
  }, [t]);

  // --- the once-a-second clock that drives the countdown ------------------
  useEffect(() => {
    if (!session?.active) return;

    const due = new Date(session.nextRunAt).getTime();
    const ends = new Date(session.expiresAt).getTime();

    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);

      // The scheduled moment has passed — ask the server for the next one.
      if (tick > ends) {
        void refreshSession();
      } else if (
        tick > due + 3_000 &&
        tick - lastSessionRefresh.current > 15_000
      ) {
        void refreshSession();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [session, refreshSession]);

  // --- actions ------------------------------------------------------------
  function failed(detail: string, error?: unknown) {
    // On a phone the console is the only place this can be read back, so log
    // it too rather than only rendering the summary.
    console.error("[fastlane] notifications:", detail, error);
    setNotice({
      tone: "error",
      title: t("push.errorTitle"),
      body: t("push.errorBody"),
      detail,
    });
  }

  /**
   * One attempt at the subscribe handshake. Separated out so a rejected push
   * endpoint can be retried with a freshly minted one.
   */
  async function requestSession(
    registration: ServiceWorkerRegistration,
    fresh: boolean,
  ): Promise<
    | { ok: true; data: SubscribeResponse }
    | { ok: false; detail: string; endpointDead: boolean }
  > {
    let subscription: PushSubscriptionJSON;
    try {
      subscription = await subscribeToPush(registration, VAPID_PUBLIC_KEY, {
        fresh,
      });
    } catch (error) {
      return {
        ok: false,
        detail: `push subscribe — ${describeError(error)}`,
        endpointDead: false,
      };
    }

    let response: Response;
    try {
      response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription,
          intervalMinutes: interval,
          durationMinutes: duration,
          onlyOnChange,
          locale,
        }),
      });
    } catch (error) {
      return {
        ok: false,
        detail: `network — ${describeError(error)}`,
        endpointDead: false,
      };
    }

    if (!response.ok) {
      const { code, cause } = await readApiError(response);
      return {
        ok: false,
        detail: `server ${response.status}${code ? ` ${code}` : ""}${
          cause ? ` (${cause})` : ""
        }`,
        // The push service refused the confirmation, so the endpoint the
        // browser handed us is already dead — worth one go with a new one.
        endpointDead: code === "push_rejected",
      };
    }

    return { ok: true, data: (await response.json()) as SubscribeResponse };
  }

  async function handleStart() {
    setNotice(null);

    if (capability === "unsupported") {
      setNotice({
        tone: "warn",
        title: t("push.unsupportedTitle"),
        body: t("push.unsupportedBody"),
      });
      return;
    }

    setBusy(true);
    try {
      let permission: NotificationPermission;
      try {
        permission = await Notification.requestPermission();
      } catch (error) {
        failed(`permission — ${describeError(error)}`, error);
        return;
      }

      if (permission !== "granted") {
        setNotice({
          tone: "warn",
          title: t("push.deniedTitle"),
          body: t("push.deniedBody"),
        });
        return;
      }

      let registration: ServiceWorkerRegistration;
      try {
        registration = await registerServiceWorker();
      } catch (error) {
        failed(`service worker — ${describeError(error)}`, error);
        return;
      }

      let outcome = await requestSession(registration, false);
      if (!outcome.ok && outcome.endpointDead) {
        outcome = await requestSession(registration, true);
      }
      if (!outcome.ok) {
        failed(outcome.detail);
        return;
      }
      const data = outcome.data;

      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ id: data.id, stopToken: data.stopToken }),
        );
      } catch {
        /* private mode: the session still runs, it just won't survive a reload */
      }

      setSession({
        id: data.id,
        active: true,
        intervalMinutes: data.intervalMinutes,
        onlyOnChange: data.onlyOnChange,
        startedAt: data.startedAt,
        expiresAt: data.expiresAt,
        nextRunAt: data.nextRunAt,
        notificationsSent: 1,
      });
      setNow(Date.now());
      setNotice({ tone: "success", body: t("push.enabledToast") });
    } catch (error) {
      failed(describeError(error), error);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    const stored = readStored();
    setBusy(true);
    try {
      if (stored) {
        await fetch("/api/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stored),
        });
      }
      clearStored();
      setSession(null);
      setNotice({ tone: "info", body: t("session.stopped") });
    } catch (error) {
      failed(describeError(error), error);
    } finally {
      setBusy(false);
    }
  }

  // --- pull to refresh ----------------------------------------------------
  // Installed to the home screen there's no browser reload button, so the
  // gesture people already reach for has to do something.
  const handleRefresh = useCallback(async () => {
    await Promise.all([loadEverything(), refreshSession()]);
  }, [loadEverything, refreshSession]);

  const { distance: pullDistance, phase: pullPhase } =
    usePullToRefresh(handleRefresh);

  const pullLabel =
    pullPhase === "refreshing"
      ? t("pull.refreshing")
      : pullPhase === "ready"
        ? t("pull.release")
        : t("pull.pull");

  // --- derived ------------------------------------------------------------
  const intervalLabel = (minutes: number) =>
    t("form.minutes", { count: minutes });
  const countdownMs =
    session && now ? new Date(session.nextRunAt).getTime() - now : 0;

  return (
    <>
      <RoadBackdrop />

      {/* Pull indicator. Rides down with the finger, then springs back. */}
      {/* Decorative: the gesture is inherently visual, and a live region that
          announced "pull to refresh" on every touch would be noise. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center"
        style={{
          transform: `translateY(${Math.max(pullDistance - 34, 0)}px)`,
          opacity: pullDistance > 4 ? 1 : 0,
          transition:
            pullPhase === "pulling" || pullPhase === "ready"
              ? "opacity 120ms ease"
              : "transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 200ms ease",
        }}
      >
        <span className="mt-3 flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-medium text-navy shadow-sm">
          <span
            className={`inline-block h-3 w-3 rounded-full border-2 border-tangerine ${
              pullPhase === "refreshing"
                ? "animate-spin border-t-transparent"
                : "border-t-transparent"
            }`}
            style={
              pullPhase === "refreshing"
                ? undefined
                : { transform: `rotate(${pullDistance * 3}deg)` }
            }
          />
          {pullLabel}
        </span>
      </div>

      <main
        className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-12 pt-6"
        style={{
          transform: pullDistance ? `translateY(${pullDistance}px)` : undefined,
          transition:
            pullPhase === "pulling" || pullPhase === "ready"
              ? undefined
              : "transform 260ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-navy">
            {t("app.name")}
          </h1>
          <p className="mt-0.5 text-sm text-muted">{t("app.tagline")}</p>
        </div>
        <Link
          href={pathname}
          locale={otherLocale}
          aria-label={t("language.label")}
          className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-muted transition hover:border-line-strong hover:text-navy"
        >
          {t("language.switch")}
        </Link>
      </header>

      {/* A lane divider, standing in for a horizontal rule. */}
      <div aria-hidden className="lane-rule -mt-1" />

      {/* Live price ------------------------------------------------------ */}
      <section className="card px-6 py-7 text-center">
        <p className="text-sm font-medium text-muted">{t("price.heading")}</p>

        {price ? (
          <>
            <p className="mt-3 flex items-baseline justify-center gap-2">
              <span className="numeric text-7xl font-bold leading-none text-navy">
                {price.raw}
              </span>
              <span className="text-3xl font-semibold text-tangerine">
                {t("price.currency")}
              </span>
            </p>
            <p className="mt-3 text-sm text-muted">
              {t("price.updated", { time: price.timeStr })}
            </p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-faint">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-tangerine" />
              {t("price.live")}
            </p>
          </>
        ) : priceFailed ? (
          <div className="mt-4">
            <p className="text-muted">{t("price.error")}</p>
            <button
              type="button"
              onClick={() => void loadEverything()}
              className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-medium text-navy transition hover:border-line-strong"
            >
              {t("price.retry")}
            </button>
          </div>
        ) : (
          <p className="mt-6 text-muted">{t("price.loading")}</p>
        )}
      </section>

      {/* The recent past, once there's a graph worth drawing -------------- */}
      {history ? (
        <PriceChart
          history={history}
          locale={locale}
          range={range}
          onRangeChange={setRange}
          compare={compare}
          onCompareChange={setCompare}
        />
      ) : null}

      {notice ? (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.body}
          {notice.detail ? (
            <p className="mt-2 text-xs opacity-70">
              {t("push.errorDetailLabel")}{" "}
              <span dir="ltr" className="break-all font-mono">
                {notice.detail}
              </span>
            </p>
          ) : null}
        </Notice>
      ) : null}

      {/* Either an active session, or the form to start one --------------- */}
      {session?.active ? (
        <section className="card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-tangerine" />
            <h2 className="text-lg font-semibold text-navy">
              {t("session.activeTitle")}
            </h2>
          </div>

          <p className="numeric text-3xl font-bold text-navy">
            {countdownMs > 0
              ? t("session.nextUpdate", {
                  countdown: formatCountdown(countdownMs),
                })
              : t("session.nextUpdateNow")}
          </p>

          <ul className="space-y-1 text-sm text-muted">
            <li>
              {t("session.everyInterval", {
                interval: intervalLabel(session.intervalMinutes),
              })}
            </li>
            <li>
              {t("session.endsAt", {
                time: formatClock(session.expiresAt, locale),
              })}
            </li>
            {session.onlyOnChange ? (
              <li className="text-tangerine">{t("session.onlyOnChangeOn")}</li>
            ) : null}
          </ul>

          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={busy}
            className="w-full rounded-2xl border border-danger/40 bg-danger/8 py-3.5 text-base font-semibold text-danger transition hover:bg-danger/15 disabled:opacity-50"
          >
            {busy ? t("session.stopping") : t("session.stop")}
          </button>
        </section>
      ) : capability === "ios-needs-install" ? (
        <section className="card space-y-3 p-5">
          <h2 className="text-lg font-semibold text-navy">{t("ios.title")}</h2>
          <p className="text-sm text-muted">{t("ios.body")}</p>
          <ol className="space-y-2 text-sm">
            {[t("ios.step1"), t("ios.step2"), t("ios.step3")].map(
              (step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="numeric flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tangerine/15 text-xs font-bold text-tangerine">
                    {index + 1}
                  </span>
                  <span className="text-ink/85">{step}</span>
                </li>
              ),
            )}
          </ol>
        </section>
      ) : (
        <section className="card space-y-5 p-5">
          <Segmented
            label={t("form.intervalLabel")}
            options={INTERVAL_CHOICES.map((value) => ({
              value,
              label: intervalLabel(value),
            }))}
            value={interval}
            onChange={setIntervalMinutes}
            disabled={busy}
          />

          <Segmented
            label={t("form.durationLabel")}
            options={DURATION_CHOICES.map((value) => ({
              value,
              label: t(`form.duration.${value}`),
            }))}
            value={duration}
            onChange={setDuration}
            disabled={busy}
          />

          <Toggle
            label={t("form.onlyOnChange.label")}
            hint={t("form.onlyOnChange.hint")}
            checked={onlyOnChange}
            onChange={setOnlyOnChange}
            disabled={busy}
          />

          <p className="text-sm text-muted">
            {t("form.summary", {
              interval: intervalLabel(interval),
              duration: t(`form.duration.${duration}`),
            })}
          </p>

          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={busy || capability === "checking"}
            className="w-full rounded-2xl bg-navy py-4 text-lg font-bold text-white shadow-sm transition hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? t("form.submitting") : t("form.submit")}
          </button>
        </section>
      )}

      <footer className="mt-auto space-y-2 pt-6 text-xs leading-relaxed text-faint">
        <div aria-hidden className="lane-rule mb-4" />
        <p>{t("footer.sourceNote")}</p>
        <p>{t("footer.disclaimer")}</p>
        <p className="font-medium text-tangerine">{t("footer.safety")}</p>
        <p>
          <a
            href="https://fastlane.co.il/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-navy"
          >
            {t("footer.officialSite")}
          </a>
        </p>
      </footer>
      </main>
    </>
  );
}
