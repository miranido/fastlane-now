import "server-only";
import webpush from "web-push";
import type { SubscriptionRow } from "@/lib/supabase";
import type {
  DeliveryOutcome,
  NotificationChannel,
  NotificationPayload,
} from "./types";

let configured: boolean | null = null;

function ensureVapid(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@example.com";

  if (!publicKey || !privateKey) {
    configured = false;
    return configured;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return configured;
}

/**
 * A push service returns 404 or 410 once a subscription is permanently dead
 * (app uninstalled, permission revoked, browser data cleared). Anything else
 * — rate limits, 5xx, network blips — is worth retrying on the next tick.
 */
function classify(error: unknown): DeliveryOutcome {
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : undefined;

  const reason =
    error instanceof Error ? error.message : `web push error (${statusCode})`;

  if (statusCode === 404 || statusCode === 410) {
    return { status: "gone", reason: `push subscription expired (${statusCode})` };
  }
  return { status: "failed", reason };
}

export const webPushChannel: NotificationChannel = {
  id: "webpush",

  isConfigured: ensureVapid,

  async send(
    subscription: SubscriptionRow,
    payload: NotificationPayload,
  ): Promise<DeliveryOutcome> {
    if (!ensureVapid()) {
      return { status: "failed", reason: "VAPID keys are not configured" };
    }
    if (!subscription.endpoint || !subscription.p256dh || !subscription.auth) {
      return { status: "gone", reason: "subscription is missing push keys" };
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        {
          TTL: 60 * 10,
          urgency: "high",
        },
      );
      return { status: "sent" };
    } catch (error) {
      return classify(error);
    }
  },
};
