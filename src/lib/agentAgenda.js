import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { defaultWebhookUrl } from './n8nWebhooks'

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
  const { data, error } = await call(
    `${SUPABASE_URL}/rest/v1/research_agenda?workspace_id=eq.${workspaceId}` +
    `&order=kind.asc,subject.asc&select=*`,
    accessToken,
  )
  const rows = data || []
  return {
    questions: rows.filter(r => r.kind === 'question'),
    competitors: rows.filter(r => r.kind === 'competitor'),
    // The "Where to look" list (2026-10-17): sites, accounts, hashtags and
    // phrases the project lenses read before searching openly.
    sources: rows.filter(r => r.kind === 'source'),
    // Set when the read failed, so "nothing is being watched" is only ever
    // said about an agenda that was actually read.
    error: error || '',
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

/** Add a standing question, a competitor to watch, or a source to read. */
export function addAgendaRow(workspaceId, accessToken, { kind, subject, why = '', source_type, tier }) {
  return call(
    `${SUPABASE_URL}/rest/v1/research_agenda`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: workspaceId, kind,
        subject: kind === 'source' ? cleanSource(subject, source_type) : String(subject || '').trim(),
        why: String(why || '').trim(),
        ...(kind === 'source' ? { source_type: SOURCE_TYPES.some(([k]) => k === source_type) ? source_type : 'website' } : {}),
        ...(tier ? { tier: Math.min(3, Math.max(1, Number(tier) || 2)) } : {}),
        // A person typing it means it is active immediately. Only the agent's
        // suggestions arrive as 'proposed'.
        status: 'active',
        created_by: 'human',
      }),
    },
  )
}

/** Change what a row says — a source's type, tier or note. */
export function updateAgendaRow(accessToken, id, patch = {}) {
  const body = {}
  if ('why' in patch) body.why = String(patch.why || '').trim()
  if ('tier' in patch) body.tier = patch.tier ? Math.min(3, Math.max(1, Number(patch.tier) || 2)) : null
  if ('source_type' in patch && SOURCE_TYPES.some(([k]) => k === patch.source_type)) body.source_type = patch.source_type
  if ('subject' in patch) body.subject = String(patch.subject || '').trim()
  return call(`${SUPABASE_URL}/rest/v1/research_agenda?id=eq.${id}`, accessToken, { method: 'PATCH', body: JSON.stringify(body) })
}

/**
 * The kinds of source the lenses know how to read, in the order the panel
 * offers them. Mirrors research_agenda_source_type_check.
 */
export const SOURCE_TYPES = [
  ['website', 'Website'],
  ['news', 'News site'],
  ['tender_portal', 'Tender portal'],
  ['exchange', 'Stock exchange'],
  ['government', 'Government'],
  ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X'],
  ['hashtag', 'Hashtag'],
  ['keyword', 'Search phrase'],
]
export const sourceTypeLabel = key => SOURCE_TYPES.find(([k]) => k === key)?.[1] || 'Source'

/**
 * A source as people paste it, tidied to what the lens searches with.
 *
 * "https://www.argaam.com/en/..." → "argaam.com/en/..." for a site, a full
 * Instagram URL → "@handle", "saudi projects" as a hashtag → "#saudi_projects".
 * Pure, so the panel and the tests agree on it.
 */
export function cleanSource(subject, type) {
  let v = String(subject || '').trim()
  if (!v) return ''
  if (type === 'instagram' || type === 'x') {
    v = v.replace(/^https?:\/\/(www\.)?(instagram\.com|x\.com|twitter\.com)\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '')
    return v ? `@${v.toLowerCase()}` : ''
  }
  if (type === 'hashtag') return `#${v.replace(/^#+/, '').replace(/\s+/g, '_')}`
  if (type === 'keyword') return v
  return v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
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

/**
 * Ask Sonnet to reword one post idea. Returns the new wording and saves
 * nothing — the caller shows it and the person decides.
 */
export async function reviseIdea({ workspaceId, accessToken, idea, instruction }) {
  try {
    // Through the n8n composer gateway, not a Vercel function: api/ is at the
    // Hobby plan's 12-function ceiling. `access_token` rides in the body
    // because n8n forwards it to the private agent container, which is the
    // authority on workspace membership; the header is what api/n8n checks.
    const res = await fetch(defaultWebhookUrl('agentComposer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        action: 'reviseIdea', access_token: accessToken,
        workspace_id: workspaceId, idea, instruction,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.ok === false) return { ok: false, error: body?.error || `The rewrite returned ${res.status}.` }
    return body
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}
