/**
 * Fast Lane Now — price relay.
 *
 * fastlane.co.il sits behind Cloudflare, which answers 403 to requests from
 * cloud providers: both Vercel (Frankfurt) and Supabase's Postgres egress are
 * refused, while a normal Israeli connection is served fine. This Worker is an
 * attempt to reach it from Cloudflare's own network instead.
 *
 * It is deliberately NOT an open proxy: the target URL is hard-coded and every
 * request must carry the shared secret. Without that, anyone finding the URL
 * could point traffic through it.
 *
 * Deploy: paste into the Cloudflare dashboard editor, or `wrangler deploy`.
 * Then set PROXY_SECRET as an encrypted variable.
 */

const PRICE_ENDPOINT =
  "https://fastlane.co.il/PageMethodsService.asmx/GetCurrentPrice";

/**
 * Honest identification with a link back to the project — no browser
 * impersonation. This exact User-Agent is accepted from a normal connection.
 */
const UPSTREAM_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://fastlane.co.il/",
  "User-Agent":
    "Mozilla/5.0 (compatible; FastLaneNow/1.0; +https://github.com/miranido/fastlane-now)",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const worker = {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    if (!env.PROXY_SECRET) {
      return json({ error: "proxy_not_configured" }, 500);
    }
    if (request.headers.get("x-proxy-secret") !== env.PROXY_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    let upstream;
    try {
      upstream = await fetch(PRICE_ENDPOINT, {
        method: "POST",
        headers: UPSTREAM_HEADERS,
        body: "",
      });
    } catch (error) {
      return json({ error: "upstream_unreachable", reason: String(error) }, 502);
    }

    const text = await upstream.text();

    // Pass the upstream status through untouched, so the caller can tell a
    // block (403) apart from a change to the endpoint (404) or an outage.
    if (!upstream.ok) {
      return json(
        {
          error: "upstream_error",
          upstream: upstream.status,
          // A snippet is enough to recognise a Cloudflare block page.
          body: text.slice(0, 200),
          colo: request.cf?.colo ?? null,
        },
        502,
      );
    }

    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        // Which Cloudflare edge served this — useful for confirming it went
        // out of Tel Aviv rather than somewhere the block applies.
        "x-cf-colo": request.cf?.colo ?? "unknown",
      },
    });
  },
};

export default worker;
