import { NextResponse } from "next/server";
import { loadSubscription, readCredentials } from "@/lib/session";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const credentials = readCredentials(body);
  if (!credentials) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
  }

  const row = await loadSubscription(credentials);
  // Stopping something that's already gone is a success from the user's view.
  if (!row) return NextResponse.json({ stopped: true });

  const { error } = await getServiceClient()
    .from("subscriptions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  if (error) {
    console.error("unsubscribe: update failed", error);
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }

  return NextResponse.json({ stopped: true });
}
