import { NextResponse } from "next/server";
import {
  DEFAULT_MODE,
  isValidDuration,
  isValidInterval,
  isValidMode,
  isValidStability,
  isWatchMode,
  normaliseTargetPrice,
  WATCH_EVALUATION_MINUTES,
  type AlertMode,
  type DurationMinutes,
  type IntervalMinutes,
} from "@/lib/config";
import {
  buildStartNotification,
  buildWatchStartNotification,
  deliver,
} from "@/lib/notify";
import { readFreshPrice } from "@/lib/price-store";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { getServiceClient, type SubscriptionRow } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  subscription?: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  mode?: unknown;
  targetPrice?: unknown;
  stabilityMinutes?: unknown;
  intervalMinutes?: unknown;
  durationMinutes?: unknown;
  onlyOnChange?: unknown;
  locale?: unknown;
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

type Settings = {
  mode: AlertMode;
  targetPrice: number | null;
  stabilityMinutes: number | null;
  intervalMinutes: number;
  onlyOnChange: boolean;
};

/**
 * Validates the half of the request that differs by mode. A watch has no
 * interval of its own — it's evaluated on every tick so it fires within a
 * minute of the condition being met — and interval alerts have no threshold.
 */
function readSettings(
  body: Body,
  durationMinutes: number,
): Settings | { error: string } {
  const mode: AlertMode = body.mode === undefined ? DEFAULT_MODE : (body.mode as AlertMode);
  if (!isValidMode(mode)) return { error: "invalid_mode" };

  if (!isWatchMode(mode)) {
    const intervalMinutes = Number(body.intervalMinutes);
    if (!isValidInterval(intervalMinutes)) return { error: "invalid_interval" };
    if (intervalMinutes > durationMinutes) return { error: "interval_too_long" };
    return {
      mode,
      targetPrice: null,
      stabilityMinutes: null,
      intervalMinutes,
      onlyOnChange: body.onlyOnChange === true,
    };
  }

  const stabilityMinutes = Number(body.stabilityMinutes);
  if (!isValidStability(stabilityMinutes)) return { error: "invalid_stability" };
  // A window longer than the watch itself could never come true.
  if (stabilityMinutes > durationMinutes) return { error: "stability_too_long" };

  let targetPrice: number | null = null;
  if (mode === "target") {
    targetPrice = normaliseTargetPrice(body.targetPrice);
    if (targetPrice === null) return { error: "invalid_target_price" };
  }

  return {
    mode,
    targetPrice,
    stabilityMinutes,
    intervalMinutes: WATCH_EVALUATION_MINUTES,
    onlyOnChange: false,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("invalid_json");
  }

  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;

  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    endpoint.length > 1024
  ) {
    return badRequest("invalid_subscription");
  }
  if (!isAllowedPushEndpoint(endpoint)) {
    return badRequest("unsupported_push_service");
  }

  const durationMinutes = Number(body.durationMinutes);
  if (!isValidDuration(durationMinutes)) return badRequest("invalid_duration");

  const settings = readSettings(body, durationMinutes);
  if ("error" in settings) return badRequest(settings.error);
  const { mode, targetPrice, stabilityMinutes, intervalMinutes, onlyOnChange } =
    settings;

  const locale = body.locale === "en" ? "en" : "he";

  // The confirmation doubles as proof that notifications actually work, so
  // read the price up front — but don't fail the subscription over it.
  let snapshot = null;
  try {
    snapshot = await readFreshPrice();
  } catch {
    snapshot = null;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  const nextRunAt = new Date(now.getTime() + intervalMinutes * 60_000);

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        channel: "webpush",
        endpoint,
        p256dh,
        auth,
        locale,
        mode,
        target_price: targetPrice,
        stability_minutes: stabilityMinutes,
        interval_minutes: intervalMinutes as IntervalMinutes,
        only_on_change: onlyOnChange,
        active: true,
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        next_run_at: nextRunAt.toISOString(),
        // Seed with the price shown in the confirmation, so "only on change"
        // compares against what the user was just told.
        last_price: snapshot?.price ?? null,
        last_notified_at: snapshot ? now.toISOString() : null,
        notifications_sent: snapshot ? 1 : 0,
        failure_count: 0,
        stop_token: crypto.randomUUID(),
        updated_at: now.toISOString(),
      },
      { onConflict: "endpoint" },
    )
    .select()
    .single<SubscriptionRow>();

  if (error || !data) {
    console.error("subscribe: upsert failed", error);
    return NextResponse.json(
      // Postgres' own five-character SQLSTATE, and nothing else: enough to tell
      // a missing table from a constraint violation without leaking row data
      // or schema details to whoever is calling.
      { error: "storage_failed", cause: error?.code ?? null },
      { status: 500 },
    );
  }

  if (snapshot) {
    const outcome = await deliver(
      data,
      isWatchMode(mode)
        ? buildWatchStartNotification({
            locale,
            snapshot,
            mode,
            targetPrice,
            stabilityMinutes: stabilityMinutes as number,
            expiresAt: expiresAt.toISOString(),
          })
        : buildStartNotification({
            locale,
            snapshot,
            intervalMinutes,
            expiresAt: expiresAt.toISOString(),
          }),
    );

    // If the very first push bounces, the subscription is worthless — tell the
    // client now rather than letting it think tracking is running.
    if (outcome.status === "gone") {
      await supabase
        .from("subscriptions")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      return NextResponse.json(
        { error: "push_rejected", reason: outcome.reason },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    id: data.id,
    stopToken: data.stop_token,
    mode,
    targetPrice,
    stabilityMinutes,
    intervalMinutes,
    durationMinutes: durationMinutes as DurationMinutes,
    onlyOnChange,
    startedAt: data.started_at,
    expiresAt: data.expires_at,
    nextRunAt: data.next_run_at,
    price: snapshot,
  });
}
