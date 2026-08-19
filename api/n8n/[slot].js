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
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
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

// ─── Who is calling ────────────────────────────────────────────────────────
// Until the deployment was made public, Vercel Authentication was the only
// thing in front of this endpoint — reaching it at all required an account on
// the Vercel team. That is no longer true, and everything past this point
// spends money, so the caller has to prove it is a signed-in user of the app.
//
// The token is checked against Supabase rather than decoded locally: verifying
// the signature here would mean holding the JWT secret in another place, and
// asking Supabase is the same answer without the extra copy. It costs one
// request against a workflow that runs for seconds to minutes.
//
// A rejected caller gets 401 and nothing is forwarded, so an unauthenticated
// request cannot cost anything.
async function callerIsSignedIn(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  // The apikey only identifies the project — the Bearer token is what is
  // actually being verified. Falling back to the service key matters because
  // the anon key is normally a build-time VITE_ variable: if it is not also
  // present in the function's environment, an anon-key-only check would
  // reject every caller and take the whole app down rather than just this
  // endpoint. The service key is already required here for readBaseUrl.
  const apiKey = ANON_KEY || SERVICE_KEY
  if (!token || !SUPABASE_URL || !apiKey) return false
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return false
    const user = await res.json()
    return Boolean(user?.id)
  } catch {
    // Supabase unreachable. Fail closed: the alternative is letting an
    // unverified call through to a workflow that bills real money.
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only' })
  }

  if (!(await callerIsSignedIn(req))) {
    return res.status(401).json({
      error: 'Sign in to run this. If you are signed in, your session expired — reload the page.',
    })
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

  // Every workflow now runs a Webhook Secret Guard first, so forwarding an
  // unsigned call is not "unauthenticated but maybe fine" — it is a request
  // that WILL die inside that guard and report success. Refuse here instead,
  // where the reason can be named. Found 2026-08-19: this variable was never
  // added to the Vercel project, so every AI feature in production had been
  // silently returning nothing since the guard shipped, while the same calls
  // worked locally (the dev proxy reads the secret from n8n/docker/.env).
  if (!WEBHOOK_SECRET) {
    return res.status(503).json({
      error: 'N8N_WEBHOOK_SECRET is not set on this deployment, so n8n would ' +
             'reject the call. Set it to the same value as n8n/docker/.env on ' +
             'the box and redeploy.',
    })
  }

  try {
    const upstream = await fetch(`${base}/webhook/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
      // req.body is already parsed by Vercel when the content-type is JSON.
      body: JSON.stringify(req.body ?? {}),
    })

    // Pass the body through untouched — callers parse n8n's own JSON shape,
    // and several of them surface the raw text on failure.
    const text = await upstream.text()

    // n8n has no built-in error response for a workflow that dies before its
    // Respond node: the caller gets HTTP 200 with an EMPTY BODY (verified live,
    // see the PR #17 docs correction). A wrong secret therefore arrives here
    // looking exactly like success, res.json() throws on the empty string, and
    // every caller's catch swallows it — the symptom is a spinner that never
    // resolves and no error anywhere. Name it instead. No workflow answers with
    // an empty body on purpose; all of them end in a Respond node.
    if (upstream.ok && !text.trim()) {
      return res.status(502).json({
        error: 'n8n accepted the request but ran nothing — the workflow stopped ' +
               'at its Webhook Secret Guard. N8N_WEBHOOK_SECRET here does not ' +
               'match the one in n8n/docker/.env on the box.',
      })
    }

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
