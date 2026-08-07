import "server-only";
import { getServiceClient, type SubscriptionRow } from "@/lib/supabase";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SessionCredentials = { id: string; stopToken: string };

export function readCredentials(body: unknown): SessionCredentials | null {
  if (typeof body !== "object" || body === null) return null;
  const { id, stopToken } = body as Record<string, unknown>;
  if (typeof id !== "string" || typeof stopToken !== "string") return null;
  if (!UUID_RE.test(id) || !UUID_RE.test(stopToken)) return null;
  return { id, stopToken };
}

/**
 * Both the id and the stop token must match, so an id leaking on its own
 * doesn't let anyone else stop or inspect someone's session.
 */
export async function loadSubscription(
  credentials: SessionCredentials,
): Promise<SubscriptionRow | null> {
  const { data } = await getServiceClient()
    .from("subscriptions")
    .select("*")
    .eq("id", credentials.id)
    .eq("stop_token", credentials.stopToken)
    .maybeSingle<SubscriptionRow>();

  return data ?? null;
}

/** The shape the client needs to render an active session. */
export function toSessionView(row: SubscriptionRow) {
  const expired = new Date(row.expires_at).getTime() <= Date.now();
  return {
    id: row.id,
    active: row.active && !expired,
    intervalMinutes: row.interval_minutes,
    onlyOnChange: row.only_on_change,
    locale: row.locale,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    nextRunAt: row.next_run_at,
    notificationsSent: row.notifications_sent,
  };
}
