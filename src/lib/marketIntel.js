import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { OPPORTUNITY_STATUSES, EVENT_DECISIONS } from './agent/intel'

// ─── The market-intelligence store, browser half ───────────────────────────
// Reads the tracker the research run writes, and lets a person work it: mark a
// lead assigned, pursued, won, lost or dropped; record whether we are
// exhibiting at an event. Plain PostgREST with the user's own token, so RLS
// applies — and every query still carries its own workspace_id, because RLS
// here is membership, not isolation.
//
// The agent never writes `status`, `owner_note` or `decision` after a row is
// created. Those are the team's, and this is the only place they are set.

const headers = accessToken => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
})

async function get(path, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers(accessToken) })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

/**
 * Everything the report needs from the store.
 *
 * `available: false` when the tables cannot be read — the migration not yet
 * applied, or a network failure. The report then falls back to this run's
 * findings rather than stating "no leads", which would be a claim about the
 * market made from a missing table.
 */
export async function fetchIntel(workspaceId, accessToken) {
  if (!workspaceId) return { signals: [], opportunities: [], events: [], available: false }
  const ws = encodeURIComponent(workspaceId)
  try {
    const [opportunities, events, signals] = await Promise.all([
      get(`research_opportunities?workspace_id=eq.${ws}&order=last_seen_at.desc&limit=200&select=*`, accessToken),
      get(`research_events?workspace_id=eq.${ws}&order=start_date.asc.nullslast&limit=150&select=*`, accessToken),
      get(`research_signals?workspace_id=eq.${ws}&order=last_seen_at.desc&limit=300` +
        '&select=id,competitor,category,channel,summary,relevance,source_url,first_seen_at,last_seen_at,times_seen', accessToken),
    ])
    return { opportunities, events, signals, available: true }
  } catch {
    return { signals: [], opportunities: [], events: [], available: false }
  }
}

async function patch(table, workspaceId, accessToken, id, body) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { method: 'PATCH', headers: { ...headers(accessToken), Prefer: 'return=minimal' }, body: JSON.stringify(body) },
    )
    return res.ok ? { ok: true } : { ok: false, error: `${res.status}: ${(await res.text()).slice(0, 160)}` }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

/** Set a lead's status or note. Anything else on the row belongs to the agent. */
export function updateOpportunity(workspaceId, accessToken, id, { status, owner_note } = {}) {
  const body = { updated_at: new Date().toISOString() }
  if (status !== undefined) {
    if (!OPPORTUNITY_STATUSES.includes(status)) return Promise.resolve({ ok: false, error: 'Unknown status.' })
    body.status = status
  }
  if (owner_note !== undefined) body.owner_note = String(owner_note).slice(0, 2000)
  return patch('research_opportunities', workspaceId, accessToken, id, body)
}

/** Record what we are doing about an event. */
export function updateEventDecision(workspaceId, accessToken, id, decision) {
  if (!EVENT_DECISIONS.includes(decision)) return Promise.resolve({ ok: false, error: 'Unknown decision.' })
  return patch('research_events', workspaceId, accessToken, id, { decision, updated_at: new Date().toISOString() })
}
