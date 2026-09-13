import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── The steering wheel ────────────────────────────────────────────────────
// AGENT.md §5b: "everything it watches, asks and believes is editable by a
// person, in the place they are already looking." This is the browser half —
// plain Supabase writes with the user's own token, so RLS applies and no
// service key is anywhere near the bundle.
//
// research_agenda holds BOTH standing questions and the competitor watchlist,
// which is why one module covers both.

const headers = accessToken => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
})

async function call(url, accessToken, init = {}) {
  try {
    const res = await fetch(url, { headers: headers(accessToken), ...init })
    if (!res.ok) return { error: `${res.status}: ${(await res.text()).slice(0, 200)}` }
    const text = await res.text()
    return { data: text ? JSON.parse(text) : null }
  } catch (err) {
    return { error: String(err?.message || err) }
  }
}

/** Everything on the agenda for one workspace — questions and competitors. */
export async function fetchAgenda(workspaceId, accessToken) {
  const { data } = await call(
    `${SUPABASE_URL}/rest/v1/research_agenda?workspace_id=eq.${workspaceId}` +
    `&order=kind.asc,subject.asc&select=*`,
    accessToken,
  )
  const rows = data || []
  return {
    questions: rows.filter(r => r.kind === 'question'),
    competitors: rows.filter(r => r.kind === 'competitor'),
  }
}

/**
 * Correct a competitor's Instagram handle by hand.
 *
 * Sets ig_status = 'human_set', which the whole downstream pipeline treats as
 * at least as trustworthy as a verified match and NEVER re-resolves over
 * (AGENT.md §5b). That is the point: the resolver stores weak candidates
 * deliberately so there is something to accept or fix, and a person's
 * correction must not be overwritten by the next discovery pass.
 *
 * ig_verified_at is stamped too, because the gather stage filters on
 * `ig_status in (resolved, human_set)` and a human-set handle should be
 * measured from the very next run.
 */
export function setHandleByHand(accessToken, id, handle) {
  const clean = String(handle || '').trim().replace(/^@/, '').replace(/^.*instagram\.com\//, '').replace(/\/.*$/, '')
  return call(
    `${SUPABASE_URL}/rest/v1/research_agenda?id=eq.${id}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(
        clean
          ? { ig_handle: clean, ig_status: 'human_set', ig_confidence: 1, ig_verified_at: new Date().toISOString() }
          // Clearing it is also a decision a person is allowed to make: back to
          // unresolved, so the next resolver pass may try again.
          : { ig_handle: '', ig_status: 'unresolved', ig_confidence: null, ig_verified_at: null },
      ),
    },
  )
}

/** Accept, pause or retire any agenda row. */
export function setAgendaStatus(accessToken, id, status) {
  return call(
    `${SUPABASE_URL}/rest/v1/research_agenda?id=eq.${id}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify({ status, reviewed_at: new Date().toISOString() }) },
  )
}

/** Add a standing question, or a competitor to watch. */
export function addAgendaRow(workspaceId, accessToken, { kind, subject, why = '' }) {
  return call(
    `${SUPABASE_URL}/rest/v1/research_agenda`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: workspaceId, kind,
        subject: String(subject || '').trim(),
        why,
        // A person typing it means it is active immediately. Only the agent's
        // suggestions arrive as 'proposed'.
        status: 'active',
        created_by: 'human',
      }),
    },
  )
}

export function deleteAgendaRow(accessToken, id) {
  return call(`${SUPABASE_URL}/rest/v1/research_agenda?id=eq.${id}`, accessToken, { method: 'DELETE' })
}

/**
 * How ready this workspace is to be researched, in one line.
 *
 * Worth computing rather than leaving to the reader: "2 of 6 competitors can
 * actually be measured" is the single most important fact about a run's output
 * and it is invisible unless something says it.
 */
export function watchlistReadiness(competitors) {
  const rows = (competitors || []).filter(c => c?.status !== 'retired')
  // TWO gates, not one, and the summary has to honour both or it promises a
  // number the run will not produce.
  //
  //   status    — has a person accepted watching this company at all?
  //   ig_status — do we have an account we are willing to attribute to them?
  //
  // Counting a `proposed` rival as measurable because its handle resolved was
  // the bug this filter exists to prevent: gather requires status=active, so
  // the board would silently be one company short of what this line claimed.
  const accepted = rows.filter(c => c.status === 'active')
  const pending = rows.filter(c => c.status === 'proposed')
  const measurable = accepted.filter(c => c.ig_status === 'resolved' || c.ig_status === 'human_set')

  const pendingNote = pending.length
    ? ` ${pending.length} suggested rival${pending.length === 1 ? '' : 's'} awaiting your accept — not watched until then.`
    : ''

  return {
    total: rows.length,
    accepted: accepted.length,
    pending: pending.length,
    measurable: measurable.length,
    unresolved: accepted.filter(c => c.ig_status === 'unresolved' && c.ig_handle).length,
    notFound: accepted.filter(c => c.ig_status === 'not_found' || (!c.ig_handle && c.ig_status !== 'human_set')).length,
    note: (rows.length === 0
      ? 'No competitors are being watched yet.'
      : accepted.length === 0
        ? 'No competitor has been accepted onto the watchlist yet.'
        : measurable.length === 0
          ? 'No accepted competitor has a usable handle, so a run can only produce web findings.'
          : `${measurable.length} of ${accepted.length} can be measured on Instagram. The rest appear on web evidence only.`
    ) + pendingNote,
  }
}

/**
 * Ask the agent to go and find the handles it does not have.
 *
 * Never touches a hand-set handle — `human_set` exists precisely so a person's
 * correction survives every later discovery pass.
 */
export async function resolveHandles({ workspaceId, accessToken, force = false }) {
  try {
    const res = await fetch('/api/agent/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ workspace_id: workspaceId, force }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `Resolve returned ${res.status}.` }
    return body
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

/**
 * Ask the agent to find rivals nobody has listed.
 *
 * Distinct from resolveHandles and the order matters: this finds WHO to watch,
 * that finds their Instagram account. Running the second on a watchlist nobody
 * has accepted yet would attach a week of numbers to companies we may not want
 * to track, so everything this proposes waits for a person first.
 */
export async function discoverCompetitors({ workspaceId, accessToken }) {
  try {
    const res = await fetch('/api/agent/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `Discover returned ${res.status}.` }
    return body
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}
