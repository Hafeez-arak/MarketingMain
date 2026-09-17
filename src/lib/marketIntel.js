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

/**
 * What the business view needs, and nothing else.
 *
 * Separate from fetchIntel because it reads three tables that page uses and
 * the weekly report does not — the watchlist with its new identity columns,
 * the distribution rights, and the contested bids. `available: false` when they
 * cannot be read, so an unapplied migration reads as "cannot say" rather than
 * as "no rivals", which would be a claim about the market made from a missing
 * table.
 */
export async function fetchCompetitorIntel(workspaceId, accessToken) {
  const empty = { watchlist: [], brands: [], deals: [], available: false }
  if (!workspaceId) return empty
  const ws = encodeURIComponent(workspaceId)
  try {
    const [watchlist, brands, deals] = await Promise.all([
      get(`research_agenda?workspace_id=eq.${ws}&kind=eq.competitor&status=eq.active` +
        '&select=id,subject,why,domain,lines,kinds,city,tier,source,resolution' +
        '&order=tier.asc.nullslast,created_at.asc', accessToken),
      get(`competitor_brands?workspace_id=eq.${ws}&limit=300` +
        '&select=competitor,brand,relationship,line,source_url,observed_at', accessToken),
      get(`deal_outcomes?workspace_id=eq.${ws}&limit=500` +
        '&select=project,competitor,line,outcome,decided_by,price_delta_pct,value_sar,client,consultant,decided_on', accessToken),
    ])
    return { watchlist, brands, deals, available: true }
  } catch {
    return empty
  }
}

export const DECIDED_BY = [
  ['price', 'Price'],
  ['lead_time', 'Lead time'],
  ['spec_lock_in', 'Already written into the spec'],
  ['agency_rights', 'They had the agency we did not'],
  ['relationship', 'Relationship'],
  ['compliance', 'Compliance or certification'],
  ['scope', 'Scope we could not cover'],
  ['other', 'Something else'],
  ['unknown', "Don't know"],
]

/**
 * Record a bid we contested.
 *
 * The only table in the research store a model never writes to. Where we lose,
 * and why, is not on any website — only the team who bid knows it — and until
 * this existed the business view's first block could never fill.
 *
 * Kept to the fields someone will actually complete standing in a corridor.
 * `price_delta_pct` is meant to be rough: a log that waits for exact numbers is
 * one that stops being filled in by the third month.
 */
export async function recordDealOutcome(workspaceId, accessToken, deal) {
  if (!workspaceId) return { ok: false, error: 'No workspace.' }
  const project = String(deal?.project || '').trim()
  if (!project) return { ok: false, error: 'A project name is needed.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/deal_outcomes`, {
      method: 'POST',
      headers: { ...headers(accessToken), Prefer: 'return=minimal' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project,
        competitor: String(deal.competitor || '').trim(),
        line: String(deal.line || '').trim(),
        outcome: ['lost', 'won', 'open', 'no_bid'].includes(deal.outcome) ? deal.outcome : 'lost',
        decided_by: DECIDED_BY.some(([k]) => k === deal.decided_by) ? deal.decided_by : 'unknown',
        price_delta_pct: Number.isFinite(Number(deal.price_delta_pct)) && String(deal.price_delta_pct).trim() !== ''
          ? Number(deal.price_delta_pct) : null,
        value_sar: Number.isFinite(Number(deal.value_sar)) && String(deal.value_sar).trim() !== ''
          ? Number(deal.value_sar) : null,
        client: String(deal.client || '').trim(),
        consultant: String(deal.consultant || '').trim(),
        contractor: String(deal.contractor || '').trim(),
        decided_on: String(deal.decided_on || '').trim() || null,
        note: String(deal.note || '').trim(),
      }),
    })
    if (!res.ok) return { ok: false, error: `${res.status}: ${(await res.text()).slice(0, 160)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
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
