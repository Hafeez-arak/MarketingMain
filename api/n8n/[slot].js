import { WEBHOOK_PATHS } from '../../src/lib/n8nWebhookPaths.js'

// ─── n8n webhook proxy ─────────────────────────────────────────────────────
// The browser used to POST straight to the n8n tunnel, which meant the tunnel
// hostname was inlined into the public JS bundle by Vite. Anyone who opened
// the deployed site could read it and fire the workflows themselves — and
// those workflows spend real money on fal, Replicate and Anthropic.
//
// Now the browser posts to /api/n8n/<slot> on its own origin and this function
// forwards it. Three things stay server-side and never reach a client:
//   • the n8n base URL          (Supabase app_config.n8n_base_url)
//   • the Supabase service key  (SUPABASE_SERVICE_ROLE_KEY)
//   • the shared secret         (N8N_WEBHOOK_SECRET, optional — see below)
//
// The base URL is read per request rather than from an env var on purpose:
// a Cloudflare quick tunnel mints a new hostname every restart, and reading it
// from the database makes that a one-row update instead of an env change and a
// full redeploy. n8n/docker/start-tunnel.sh writes the row automatically.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
// Optional. When set, it is sent as x-webhook-secret so n8n can reject calls
// that did not come through this proxy. Harmless until the workflows check it.
const WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || ''

// The base URL changes rarely (only when the tunnel restarts) but this
// function may run hot, so a short in-memory cache keeps us from querying
// Supabase on every single webhook call. Instances are recycled often enough
// that a stale entry cannot outlive the TTL by much.
const CACHE_TTL_MS = 30_000
let cached = { value: '', at: 0 }

async function readBaseUrl() {
  const now = Date.now()
  if (cached.value && now - cached.at < CACHE_TTL_MS) return cached.value
  if (!SUPABASE_URL || !SERVICE_KEY) return ''

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_config?key=eq.n8n_base_url&select=value`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  )
  if (!res.ok) return cached.value   // keep serving the last good value
  const rows = await res.json()
  const value = String(rows?.[0]?.value || '').trim().replace(/\/+$/, '')
  if (value) cached = { value, at: now }
  return value
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only' })
  }

  // Allowlist check FIRST. Without it this endpoint would forward to any path
  // an attacker put in the URL — an open proxy sitting on your own domain.
  // Only the slots this app actually ships can be reached.
  const { slot } = req.query
  const path = WEBHOOK_PATHS[slot]
  if (!path) return res.status(404).json({ error: `Unknown webhook slot: ${slot}` })

  const base = await readBaseUrl()
  if (!base) {
    return res.status(503).json({
      error: 'n8n is not reachable: no base URL is configured. Start the tunnel ' +
             '(n8n/docker/start-tunnel.sh) or set app_config.n8n_base_url.',
    })
  }

  try {
    const upstream = await fetch(`${base}/webhook/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WEBHOOK_SECRET ? { 'x-webhook-secret': WEBHOOK_SECRET } : {}),
      },
      // req.body is already parsed by Vercel when the content-type is JSON.
      body: JSON.stringify(req.body ?? {}),
    })

    // Pass the body through untouched — callers parse n8n's own JSON shape,
    // and several of them surface the raw text on failure.
    const text = await upstream.text()
    const type = upstream.headers.get('content-type') || 'application/json'
    res.status(upstream.status)
    res.setHeader('Content-Type', type)
    return res.send(text)
  } catch (err) {
    // A dead tunnel looks like a fetch failure here. Say so in the terms the
    // person reading it can act on, rather than leaking the hostname.
    return res.status(502).json({
      error: `Could not reach n8n. The tunnel may have restarted or stopped. (${err.message})`,
    })
  }
}
