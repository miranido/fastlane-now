import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Every table in this project is service-role only — RLS is on with no
 * policies, so the anon key can't read or write anything. All access goes
 * through server routes.
 */
let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables",
    );
  }

  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "fastlane-now" } },
  });
  return client;
}

export type SubscriptionRow = {
  id: string;
  channel: "webpush" | "telegram";
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  telegram_chat_id: string | null;
  locale: "he" | "en";
  interval_minutes: number;
  only_on_change: boolean;
  active: boolean;
  started_at: string;
  expires_at: string;
  next_run_at: string;
  last_price: number | null;
  last_notified_at: string | null;
  notifications_sent: number;
  failure_count: number;
  stop_token: string;
};
