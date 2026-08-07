import "server-only";
import type { SubscriptionRow } from "@/lib/supabase";
import type {
  DeliveryOutcome,
  NotificationChannel,
  NotificationPayload,
} from "./types";

/**
 * Delivery is fully implemented; what's still missing for a public Telegram
 * option is the linking flow (a bot that answers /start and creates a
 * subscription row from the chat id). Set TELEGRAM_BOT_TOKEN and this channel
 * starts working — the tick loop already routes by `channel`.
 */
function botToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN || undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const telegramChannel: NotificationChannel = {
  id: "telegram",

  isConfigured() {
    return Boolean(botToken());
  },

  async send(
    subscription: SubscriptionRow,
    payload: NotificationPayload,
  ): Promise<DeliveryOutcome> {
    const token = botToken();
    if (!token) {
      return { status: "failed", reason: "TELEGRAM_BOT_TOKEN is not set" };
    }
    if (!subscription.telegram_chat_id) {
      return { status: "gone", reason: "subscription is missing a chat id" };
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: subscription.telegram_chat_id,
            text: `<b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.body)}`,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (response.ok) return { status: "sent" };

      // 403 = user blocked the bot, 400 = chat no longer exists.
      if (response.status === 403 || response.status === 400) {
        return {
          status: "gone",
          reason: `telegram rejected the chat (${response.status})`,
        };
      }
      return {
        status: "failed",
        reason: `telegram returned HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : "telegram request failed",
      };
    }
  },
};
