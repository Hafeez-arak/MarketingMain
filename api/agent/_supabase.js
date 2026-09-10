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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

export const isConfigured = Boolean(SUPABASE_URL && SERVICE_KEY)
