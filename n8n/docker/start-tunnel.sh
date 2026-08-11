#!/usr/bin/env bash
# Cloudflare Tunnel launcher for the ARAK Content Studio n8n instance.
#
# This is the "make it live for testing" button described in
# n8n/docker/README.md#going-live-for-testing-cloudflare-tunnel. It exposes
# this Mac's local n8n container (localhost:5680) to a public URL via a
# Cloudflare quick tunnel — no Cloudflare account, no domain, nothing to
# sign up for. Trade-off: the URL is random and changes every time this
# script restarts, and there is no login wall in front of it (see the
# security note in the README before running this against real traffic).
#
# Usage: ./start-tunnel.sh
# Stop with Ctrl+C — this runs in the foreground on purpose, so the tunnel
# dies with the terminal instead of lingering unnoticed in the background.

set -euo pipefail

if ! docker ps --filter "name=arak-marketing-n8n" --filter "status=running" --format '{{.Names}}' | grep -q arak-marketing-n8n; then
  echo "arak-marketing-n8n container isn't running. Start it first:" >&2
  echo "  cd n8n/docker && docker compose up -d" >&2
  exit 1
fi

echo "Starting Cloudflare quick tunnel -> http://localhost:5680"
echo "Watch below for the https://*.trycloudflare.com URL Cloudflare assigns."
echo
echo "Once you have it, every webhook URL in this app's Settings > Workflow"
echo "Webhooks needs its host swapped to that URL, keeping the same /webhook/<path>"
echo "suffix (e.g. https://<tunnel>.trycloudflare.com/webhook/arak-creative-generate)."
echo "There are ~19 of them — see src/pages/settings/index.jsx for the full list."
echo

exec cloudflared tunnel --url http://localhost:5680
