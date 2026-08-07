#!/usr/bin/env bash
#
# Answers the only question that matters about a candidate machine: will
# fastlane.co.il serve it?
#
# The filter looks geographic — everything refused so far was outside Israel
# (see the README table) — but every refused source was also a cloud provider,
# and no Israeli datacenter IP has been tested. Run this on a VPS you're
# evaluating before you pay for a month of it.
#
#   curl -fsSL https://raw.githubusercontent.com/miranido/fastlane-now/main/scripts/check-upstream.sh | bash
#
# 200 with a price → that machine can host the fetcher.
# 403             → it's being filtered; try a different provider or region.

set -uo pipefail

ENDPOINT="https://fastlane.co.il/PageMethodsService.asmx/GetCurrentPrice"
AGENT="Mozilla/5.0 (compatible; FastLaneNow/1.0; +https://github.com/miranido/fastlane-now)"

echo "This machine looks like:"
curl -fsS --max-time 10 https://ipinfo.io/json 2>/dev/null \
  | tr -d '{},"' | sed -E 's/^[[:space:]]+//' \
  | grep -Ei '^(ip|country|org|region):' | sed 's/^/  /' \
  || echo "  (couldn't reach ipinfo.io)"

echo
echo "Asking fastlane.co.il for the price..."

body=$(mktemp)
status=$(curl -sS -o "$body" -w '%{http_code}' --max-time 15 \
  -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json; charset=UTF-8' \
  -H 'Accept: application/json, text/javascript, */*; q=0.01' \
  -H 'Accept-Language: he-IL,he;q=0.9,en;q=0.8' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Referer: https://fastlane.co.il/' \
  -H "User-Agent: $AGENT" \
  -d '')

echo "  HTTP $status"

case "$status" in
  200)
    echo "  $(head -c 200 "$body")"
    echo
    echo "PASS — this machine can run the fetcher."
    rm -f "$body"; exit 0 ;;
  403)
    echo
    echo "BLOCKED — Cloudflare is filtering this IP. If this machine IS in"
    echo "Israel, the rule isn't purely geographic: try another Israeli"
    echo "provider, or run the fetcher on an ordinary Israeli connection."
    rm -f "$body"; exit 1 ;;
  *)
    echo "  $(head -c 200 "$body")"
    echo
    echo "UNEXPECTED — neither the served nor the blocked answer. Retry before"
    echo "concluding anything; the site itself may be down."
    rm -f "$body"; exit 1 ;;
esac
