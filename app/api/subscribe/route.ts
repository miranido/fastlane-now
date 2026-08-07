import { NextResponse } from "next/server";
import {
  isValidDuration,
  isValidInterval,
  type DurationMinutes,
  type IntervalMinutes,
} from "@/lib/config";
import { buildStartNotification, deliver } from "@/lib/notify";
import { fetchCurrentPrice } from "@/lib/price";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { getServiceClient, type SubscriptionRow } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  subscription?: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  intervalMinutes?: unknown;
  durationMinutes?: unknown;
  onlyOnChange?: unknown;
  locale?: unknown;
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
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

  const intervalMinutes = Number(body.intervalMinutes);
  const durationMinutes = Number(body.durationMinutes);
  if (!isValidInterval(intervalMinutes)) return badRequest("invalid_interval");
  if (!isValidDuration(durationMinutes)) return badRequest("invalid_duration");
  if (intervalMinutes > durationMinutes) return badRequest("interval_too_long");

  const locale = body.locale === "en" ? "en" : "he";
  const onlyOnChange = body.onlyOnChange === true;

  // The confirmation doubles as proof that notifications actually work, so
  // fetch the price up front — but don't fail the subscription over it.
  let snapshot = null;
  try {
    snapshot = await fetchCurrentPrice();
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
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }

  if (snapshot) {
    const outcome = await deliver(
      data,
      buildStartNotification({
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
    intervalMinutes,
    durationMinutes: durationMinutes as DurationMinutes,
    onlyOnChange,
    startedAt: data.started_at,
    expiresAt: data.expires_at,
    nextRunAt: data.next_run_at,
    price: snapshot,
  });
}
