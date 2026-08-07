import "server-only";
import type { SubscriptionRow } from "@/lib/supabase";
import { telegramChannel } from "./telegram";
import type {
  ChannelId,
  DeliveryOutcome,
  NotificationChannel,
  NotificationPayload,
} from "./types";
import { webPushChannel } from "./webpush";

const channels: Record<ChannelId, NotificationChannel> = {
  webpush: webPushChannel,
  telegram: telegramChannel,
};

export function getChannel(id: ChannelId): NotificationChannel {
  return channels[id];
}

/** Routes a payload to whichever channel the subscription was created with. */
export async function deliver(
  subscription: SubscriptionRow,
  payload: NotificationPayload,
): Promise<DeliveryOutcome> {
  const channel = channels[subscription.channel];
  if (!channel) {
    return { status: "gone", reason: `unknown channel ${subscription.channel}` };
  }
  if (!channel.isConfigured()) {
    return { status: "failed", reason: `${channel.id} is not configured` };
  }
  return channel.send(subscription, payload);
}

export { buildPriceNotification, buildStartNotification } from "./compose";
export type { DeliveryOutcome, NotificationPayload } from "./types";
