#!/usr/bin/env bash
#
# Installs the once-a-minute price fetcher on a Linux box — a VPS in Israel, a
# Raspberry Pi on a home connection, anything systemd with Node 20+.
#
# Run scripts/check-upstream.sh on the machine FIRST. If it can't reach
# fastlane.co.il, nothing below will help.
#
#   sudo bash scripts/install-fetcher-linux.sh
#
# Idempotent: safe to re-run after a git pull.

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/fastlane-now}"
SERVICE_USER="${SERVICE_USER:-fastlane}"
ENV_FILE="/etc/fastlane-now.env"
UNIT_DIR="/etc/systemd/system"

[ "$(id -u)" -eq 0 ] || { echo "Run me with sudo."; exit 1; }

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "Node isn't installed. Install Node 20+ first."; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- the code ---------------------------------------------------------------
if [ "$here" != "$PROJECT_DIR" ]; then
  echo "Copying the project to $PROJECT_DIR"
  mkdir -p "$PROJECT_DIR"
  cp -r "$here/scripts" "$PROJECT_DIR/"
fi

# --- the user ---------------------------------------------------------------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  echo "Creating the $SERVICE_USER service account"
  nologin_shell=/usr/sbin/nologin
  [ -x "$nologin_shell" ] || nologin_shell=/sbin/nologin
  [ -x "$nologin_shell" ] || nologin_shell=/bin/false
  useradd --system --no-create-home --shell "$nologin_shell" "$SERVICE_USER"
fi
chown -R root:root "$PROJECT_DIR"

# --- the secrets ------------------------------------------------------------
# Kept out of the checkout so a git pull can't touch them, and readable only by
# the service account — CRON_SECRET is what stops anyone posting fake prices.
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# Where the fetcher posts readings, and the secret that authorises it.
# Both must match the deployed app's environment variables.
INGEST_URL=https://your-app.vercel.app/api/price/ingest
CRON_SECRET=
EOF
  echo "Wrote $ENV_FILE — fill in INGEST_URL and CRON_SECRET before starting."
fi
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# --- the units --------------------------------------------------------------
sed -e "s|/opt/fastlane-now|$PROJECT_DIR|g" \
    -e "s|/usr/bin/node|$NODE_BIN|g" \
    -e "s|^User=.*|User=$SERVICE_USER|" \
    "$PROJECT_DIR/scripts/fastlane-fetcher.service" > "$UNIT_DIR/fastlane-fetcher.service"
cp "$PROJECT_DIR/scripts/fastlane-fetcher.timer" "$UNIT_DIR/fastlane-fetcher.timer"

systemctl daemon-reload
systemctl enable --now fastlane-fetcher.timer

echo
echo "Installed. One run right now, to prove it end to end:"
echo "  sudo systemctl start fastlane-fetcher.service"
echo "  journalctl -u fastlane-fetcher.service -n 20 --no-pager"
echo
echo "Expect a line like: {\"level\":\"info\",\"message\":\"posted\",\"price\":8}"
