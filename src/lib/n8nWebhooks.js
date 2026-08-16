import { WEBHOOK_PATHS } from './n8nWebhookPaths'

// ─── n8n webhook URLs: one base URL, fixed paths ────────────────────────────
// Every webhook this app calls is the SAME n8n instance with a different
// path. The paths never change — they're baked into the workflow JSON in
// n8n/workflows/ and survive any redeploy of n8n itself. Only the host in
// front of them moves, and it moves often: the marketing team reaches n8n
// through a Cloudflare quick tunnel, which mints a brand-new random
// `*.trycloudflare.com` hostname every time it restarts.
//
// So the host is build config (VITE_N8N_BASE_URL, set in Vercel) and the
// paths are code. Pointing the whole app at a new tunnel is one env var and
// a redeploy — not 27 URLs re-pasted by hand, per workspace, by every user.
//
// Before this, Settings → Workflow Webhooks stored 27 fully-qualified URLs
// per workspace in Supabase (workspace_webhooks.webhooks). That made a new
// tunnel URL a 27-field data-entry job that every workspace had to redo,
// and until they did, every button in the app failed against a dead host.

// The slot → path map moved to ./n8nWebhookPaths.js so the serverless proxy
// can share it: this module reads import.meta.env, which does not exist in
// the Node runtime the proxy runs in. Re-exported so existing importers of
// WEBHOOK_PATHS from here keep working.
export { WEBHOOK_PATHS }

// There is deliberately no N8N_BASE_URL export any more. Reading
// VITE_N8N_BASE_URL here inlined the tunnel hostname into the bundle, and the
// Settings screen then printed it on the page — so the host was published to
// every visitor even after the proxy was in place. The only remaining use of
// that variable is the Vite dev proxy (see vite.config.js), which runs in
// Node and never ships.

// Every call goes to this app's own origin, and api/n8n/[slot].js forwards it
// to n8n. The n8n hostname is therefore absent from the shipped bundle.
//
// It used to be `${N8N_BASE_URL}/webhook/${path}` with the host inlined by
// Vite at build time, which published the tunnel URL to anyone who opened the
// site and made every tunnel restart a redeploy. Both problems belong to the
// build-time env var, not to n8n, so the env var stopped being the source of
// truth — see api/n8n/[slot].js and app_config.n8n_base_url.
//
// Unlike before, this is never empty: the proxy answers with a clear 503 when
// no base URL is configured, which is a better failure than the silent
// "not configured" branch a blank string used to trigger in every caller.
export function defaultWebhookUrl(slot) {
  const path = WEBHOOK_PATHS[slot]
  if (!path) return ''
  return `/api/n8n/${slot}`
}

// ─── Turning a failed webhook response into something a human can act on ───
// Since calls go through /api/n8n/<slot>, three failures are now possible that
// a direct browser call could never produce, and all three look like an
// opaque error string unless they're named:
//
//   504 — the serverless function hit its 60s ceiling. Crucially this does NOT
//         mean the work failed: n8n keeps running and still writes its result.
//         Telling the user to retry would run an expensive job a second time,
//         so the message says to wait and refresh instead.
//   503 — no base URL configured (tunnel never started).
//   502 — the tunnel restarted or died mid-flight.
//
// Callers pass the Response; this reads the body once and returns a string.
export async function describeWebhookFailure(res) {
  const text = await res.text().catch(() => '')
  // The proxy sends {"error": "..."} for the cases it detects itself.
  let fromProxy = ''
  try { fromProxy = JSON.parse(text)?.error || '' } catch { /* not JSON */ }

  if (res.status === 504 || /FUNCTION_INVOCATION_TIMEOUT|task timed out/i.test(text)) {
    return 'This took longer than the 60-second request limit, but it has NOT been ' +
           'cancelled — the workflow is still running and will save its result. ' +
           'Wait a moment and refresh rather than running it again, so it does not ' +
           'generate (and bill) twice.'
  }
  if (res.status === 503) {
    return fromProxy || 'n8n is not reachable: no instance is configured right now. ' +
           'Whoever runs the tunnel needs to start it.'
  }
  if (res.status === 502) {
    return fromProxy || 'Could not reach n8n — the tunnel may have restarted or stopped.'
  }
  return fromProxy || text || `The workflow returned ${res.status}.`
}

export function defaultWebhooks(slots) {
  const out = {}
  for (const slot of slots) out[slot] = defaultWebhookUrl(slot)
  return out
}

// Is this URL one of ours, just on a stale host? True when the path matches
// the slot's own webhook path regardless of what host precedes it.
//
// This is what makes an old tunnel URL self-healing. Rows written into
// workspace_webhooks before this change hold hostnames that are now dead
// (http://localhost:5680/..., or a previous trycloudflare hostname). Left
// alone they'd shadow the build's correct default forever — a stored value
// is non-empty, so a naive merge prefers it. Recognising them as OUR
// workflow on the WRONG host lets us drop them for the current default,
// with no migration and no write-back, and it keeps working across every
// future tunnel restart.
function isStaleOurs(slot, url) {
  const path = WEBHOOK_PATHS[slot]
  if (!path) return false
  return new RegExp(`/webhook(-test)?/${path}/?$`).test(url)
}

// Merge a stored webhook map over the build's defaults.
//
// Per slot, in order: a blank stored value means "unset", not "blank the
// default"; a stored value that's our path on a stale host is rebased onto
// the current base URL; anything else is a deliberate override (someone
// pointed a slot at a genuinely different endpoint) and is kept as-is.
// Keys outside `slots` are dropped rather than carried through: a slot that
// gets renamed or removed would otherwise live on in every stored blob
// forever, and the whole point of a single schema list is that the
// in-memory map is exactly these keys no matter how old the data is.
export function mergeWebhooks(slots, saved) {
  const out = defaultWebhooks(slots)
  for (const [slot, value] of Object.entries(saved || {})) {
    if (typeof value !== 'string' || !(slot in out)) continue
    const url = value.trim()
    if (!url) continue
    if (isStaleOurs(slot, url) && out[slot]) continue
    out[slot] = url
  }
  return out
}
