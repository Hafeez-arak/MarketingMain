// ─── Server-side Supabase access for the agent ─────────────────────────────
// Two clients, and the difference between them is the whole security model.
//
//   • The CALLER's token is used to answer "may this person touch this
//     workspace". RLS does that job honestly — asking with the caller's own
//     credentials is the same question the database already knows how to
//     answer, and it cannot be fooled by a workspace_id in a request body.
//
//   • The SERVICE key is used only after that check has passed, to read and
//     write rows the agent needs (the ledger, the agenda, snapshots). It
//     bypasses RLS by design, which is exactly why nothing reaches it before
//     membership has been proven.
//
// AGENT.md §2: isolation lives here, not in the prompt. Every tool gets its
// workspace_id from the verified session — never from anything a model wrote.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

export function bearerFrom(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/**
 * Who is calling. Returns the user id, or '' if the token is missing or bad.
 * Fails closed on an unreachable Supabase: everything past this point spends
 * money, so "we could not check" must mean no.
 */
export async function callerId(req) {
  const token = bearerFrom(req)
  const apiKey = ANON_KEY || SERVICE_KEY
  if (!token || !SUPABASE_URL || !apiKey) return ''
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return ''
    const user = await res.json()
    return user?.id || ''
  } catch {
    return ''
  }
}

/**
 * May this caller act in this workspace?
 *
 * Asked WITH THE CALLER'S OWN TOKEN so RLS answers it. A service-key query
 * would return the row for any workspace id on earth, which would turn the
 * workspace_id in a request body into an access-control bypass — the exact
 * shape of bug this app has already decided RLS alone will not be trusted to
 * catch.
 */
export async function callerMayUseWorkspace(req, workspaceId) {
  const token = bearerFrom(req)
  const apiKey = ANON_KEY || SERVICE_KEY
  if (!token || !workspaceId || !SUPABASE_URL || !apiKey) return false
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=id`,
      { headers: { apikey: apiKey, Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return false
    const rows = await res.json()
    return Array.isArray(rows) && rows.length === 1
  } catch {
    return false
  }
}

// ─── Retrying, and the one case where retrying is wrong ────────────────────
// A research run makes dozens of round trips and a single transient blip
// should not cost the whole thing. Observed live: a read timed out with
// ETIMEDOUT partway through a smoke test that had already written rows.
//
// But a blind retry on every method is a bug factory. The distinction that
// matters is whether the server may have already ACTED on the request:
//
//   • No HTTP response at all (DNS failure, connection reset, timeout) — the
//     request almost certainly never completed. Safe to retry any method.
//   • An HTTP 5xx or 429 — the server answered, which means it received the
//     request and may well have processed it. Retrying a POST here is how one
//     proposed rule becomes three. So only reads are retried on a status.
//
// The alternative — retrying writes on 5xx and deduplicating afterwards — is
// what the unique indexes on competitor_snapshots and research_runs already do
// for the cases that matter, and it is not worth extending to every table.

const RETRY_ATTEMPTS = 3
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'])

/** Did this throw because the request never reached the server? */
function isConnectionError(err) {
  const code = err?.cause?.code || err?.code || ''
  if (RETRYABLE_CODES.has(code)) return true
  return /fetch failed|network|socket hang up|timeout/i.test(String(err?.message || ''))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** PostgREST with the service key. Only reachable after a membership check. */
export async function db(path, { method = 'GET', body, prefer } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Supabase is not configured on this deployment (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  }
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer

  // GET and DELETE are idempotent; PATCH here always sets absolute values
  // rather than incrementing, so repeating one lands the same row twice with
  // the same result. POST is the only one that creates.
  const isRead = method === 'GET'

  let lastError = null
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt) await sleep(250 * 2 ** (attempt - 1))
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      if (res.ok) return text ? JSON.parse(text) : null

      // A 4xx is our fault and will fail identically next time — retrying it
      // just delays a clear error. 429 is the exception: it is a rate limit,
      // not a bad request.
      const worthRetrying = isRead && (res.status >= 500 || res.status === 429)
      lastError = new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`)
      if (!worthRetrying) throw lastError
    } catch (err) {
      lastError = err
      // Rethrow immediately unless this is a connection failure — in which
      // case the server never saw it and any method is safe to repeat.
      if (!isConnectionError(err)) throw err
    }
  }
  throw lastError
}

export const isConfigured = Boolean(SUPABASE_URL && SERVICE_KEY)
