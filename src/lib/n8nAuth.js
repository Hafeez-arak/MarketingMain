import { supabase } from './supabaseClient'

// ─── Signing the app's own webhook calls ───────────────────────────────────
// /api/n8n/<slot> forwards to workflows that spend real money on fal,
// Replicate and Anthropic. While the deployment sat behind Vercel
// Authentication that endpoint was unreachable from outside the team, so it
// never needed a caller check of its own. The moment the deployment went
// public, "anyone who knows the URL" became "anyone", and a plain curl could
// start a video render.
//
// So every call to these routes now carries the caller's Supabase access token
// and the function verifies it (see api/n8n/[slot].js and
// api/zernio/[action].js).
//
// This is installed as a fetch wrapper rather than added to each call site.
// There are nineteen of them across campaignPlanner, creativeStudio, zernio
// and quickCreate, and a check that has to be remembered nineteen times is a
// check that will eventually be forgotten in the twentieth — the next caller
// would silently ship unauthenticated. Wrapping the transport means a new
// call site is covered by existing code rather than by whoever writes it.
//
// Deliberately narrow: it only touches same-origin requests to this app's own
// authenticated API routes, and it never overwrites an Authorization header a
// caller set itself. Everything else — Supabase REST, storage, image loads —
// passes through untouched.
//
// /api/zernio/ is here for the same reason /api/n8n/ is, with one difference
// worth stating: those routes do not merely cost money, they connect and
// disconnect real social accounts. They verify the token AND check that the
// caller is a member of the workspace named in the body, so an unsigned call
// cannot reach another tenant's accounts.
const PREFIXES = ['/api/n8n/', '/api/zernio/']

function isProxyCall(input) {
  try {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : input?.url || ''
    if (!url) return false
    // Relative URLs are this app's own origin, which is the normal case since
    // defaultWebhookUrl() returns a bare path.
    if (PREFIXES.some(p => url.startsWith(p))) return true
    const parsed = new URL(url, window.location.origin)
    return parsed.origin === window.location.origin
      && PREFIXES.some(p => parsed.pathname.startsWith(p))
  } catch { return false }
}

export function installN8nAuth() {
  if (typeof window === 'undefined' || window.__n8nAuthInstalled) return
  window.__n8nAuthInstalled = true

  const original = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    if (!isProxyCall(input)) return original(input, init)

    // getSession() reads the cached session and refreshes it when it is close
    // to expiring, which matters here: these workflows are fired from screens
    // someone may have had open for a long time, and an hour-old token would
    // be rejected by the very check this exists to satisfy.
    let token = ''
    try {
      const { data } = await supabase.auth.getSession()
      token = data?.session?.access_token || ''
    } catch { /* fall through — the proxy answers 401 and the caller reports it */ }

    const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined) || {})
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)

    return original(input, { ...init, headers })
  }
}
