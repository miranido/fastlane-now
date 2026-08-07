import { NextResponse } from "next/server";
import { loadSubscription, readCredentials, toSessionView } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets a returning device confirm whether its tracking session is still live. */
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
  if (!row) {
    // Unknown or already purged — the client should just clear its local state.
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({ found: true, session: toSessionView(row) });
}
