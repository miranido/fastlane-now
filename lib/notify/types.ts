import type { SubscriptionRow } from "@/lib/supabase";

export type ChannelId = "webpush" | "telegram";

export type NotificationPayload = {
  title: string;
  body: string;
  /** Where a tap should take the user. */
  url: string;
  /** Collapse key — a new price replaces the previous notification. */
  tag: string;
  locale: "he" | "en";
};

export type DeliveryOutcome =
  /** Delivered to the push service. */
  | { status: "sent" }
  /** The recipient is permanently gone — deactivate the subscription. */
  | { status: "gone"; reason: string }
  /** Transient problem — keep the subscription, count the failure. */
  | { status: "failed"; reason: string };

export interface NotificationChannel {
  readonly id: ChannelId;
  /** False when the required env vars are missing, so we skip rather than throw. */
  isConfigured(): boolean;
  send(
    subscription: SubscriptionRow,
    payload: NotificationPayload,
  ): Promise<DeliveryOutcome>;
}
