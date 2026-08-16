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
echo "The new URL is published to Supabase (app_config.n8n_base_url) automatically,"
echo "and the deployed app reads it per request through /api/n8n/<slot>."
echo "That means NO Vercel env change and NO redeploy after a restart — the"
echo "testing team keeps working within seconds."
echo
echo "Local dev is the exception: Vite's dev proxy reads VITE_N8N_BASE_URL from"
echo ".env, so update that line too if you're running the app locally."
echo

# ── Publish the URL the moment Cloudflare assigns it ───────────────────────
# Runs in the background, watching the tunnel's own output for the hostname.
# Writing it to app_config is what makes a restart a non-event for the
# deployed app; before this, every restart meant editing a Vercel env var and
# waiting on a rebuild while the team sat blocked.
#
# The service-role key is read from this directory's .env — the same key n8n
# already uses. It never leaves this machine.
publish_url() {
  local url="$1"
  local env_file="$(dirname "$0")/.env"
  local sb_url sb_key
  sb_url=$(grep -E '^SUPABASE_URL=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  sb_key=$(grep -E '^SUPABASE_KEY=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -z "$sb_url" ] || [ -z "$sb_key" ]; then
    echo "!! Could not read SUPABASE_URL/SUPABASE_KEY from $env_file." >&2
    echo "!! Set app_config.n8n_base_url to $url by hand, or the app will 503." >&2
    return
  fi
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
    "$sb_url/rest/v1/app_config?key=eq.n8n_base_url" \
    -H "apikey: $sb_key" -H "Authorization: Bearer $sb_key" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d "{\"value\":\"$url\",\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}")
  if [ "$code" = "204" ] || [ "$code" = "200" ]; then
    echo
    echo "✓ Published $url — the deployed app is now pointing here. No redeploy needed."
    echo
  else
    echo
    echo "!! Publishing to Supabase failed (HTTP $code). The tunnel is up, but the" >&2
    echo "!! deployed app will keep using the previous URL until this is fixed." >&2
    echo
  fi
}

# --protocol http2 instead of the default QUIC. cloudflared prefers QUIC
# (UDP/7844) and only falls back on its own after several slow retries; on
# this network that dial times out indefinitely ("failed to dial to edge
# with quic: timeout: no recent network activity"), and the symptom is not
# an obvious network error — the tunnel prints a perfectly normal
# *.trycloudflare.com URL that then serves HTTP 530 to every request,
# because the edge has a hostname with no origin behind it. http2 rides
# TCP/443 like ordinary HTTPS and connects immediately. Drop this flag if
# you ever want QUIC's lower latency on a network that allows outbound UDP.
#
# Piped rather than exec'd so the hostname can be caught as it scrolls past
# and published to Supabase. cloudflared still runs in the foreground and
# still dies with the terminal — the tunnel cannot outlive this window.
cloudflared tunnel --protocol http2 --url http://localhost:5680 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [ -z "${published:-}" ]; then
    url=$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true)
    if [ -n "$url" ]; then
      publish_url "$url"
      published=1
    fi
  fi
done
