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
echo "Once you have it, point the app at it by setting ONE value — the host,"
echo "with no /webhook suffix and no trailing slash:"
echo
echo "  VITE_N8N_BASE_URL=https://<tunnel>.trycloudflare.com"
echo
echo "in .env for local dev, and in the deployed app's environment variables"
echo "(then redeploy - Vite inlines this at build time). The 23 /webhook/<path> suffixes are"
echo "baked into the build from src/lib/n8nWebhooks.js and never change, so"
echo "nothing in Supabase and nothing in Settings needs touching — not even"
echo "after this tunnel restarts with a different hostname."
echo

# --protocol http2 instead of the default QUIC. cloudflared prefers QUIC
# (UDP/7844) and only falls back on its own after several slow retries; on
# this network that dial times out indefinitely ("failed to dial to edge
# with quic: timeout: no recent network activity"), and the symptom is not
# an obvious network error — the tunnel prints a perfectly normal
# *.trycloudflare.com URL that then serves HTTP 530 to every request,
# because the edge has a hostname with no origin behind it. http2 rides
# TCP/443 like ordinary HTTPS and connects immediately. Drop this flag if
# you ever want QUIC's lower latency on a network that allows outbound UDP.
exec cloudflared tunnel --protocol http2 --url http://localhost:5680
