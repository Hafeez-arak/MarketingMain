import { supabase } from '../supabaseClient'
import { OPPORTUNITY_STATUSES, EVENT_DECISIONS } from '../agent/intel'
import { ACCOUNT_STATUSES } from './icp'

// ─── Sales → Targets: the browser's data layer ─────────────────────────────
// Straight to Supabase with the admin's own session. sales_icp and
// sales_accounts are admin-only by RLS (they carry client names and order
// values); the research tracker is readable by members and is filtered here
// like everywhere else. Every query carries its own workspace_id filter: RLS
// is membership, not isolation.
//
// The agent never writes a status, an owner or a note. Those are the team's,
// and this file is the only place they are set.

const OPP_COLUMNS = 'id,type,name,headline,client,contractor,consultant,location,scope,stage,deadline,timing,' +
  'relevance,suggested_action,source_url,status,owner_note,first_seen_at,last_seen_at,times_seen,last_change,line,' +
  'segment,buyer,value_sar,track,why_fit,red_flags,contact'

const EVENT_COLUMNS = 'id,name,start_date,end_date,venue,city,organizer,url,exhibitor_deadline,competitors_exhibiting,' +
  'relevance,recommendation,status,decision,takeaway,last_seen_at'

/**
 * Everything the page shows, in one go.
 *
 * Each part fails on its own: a missing table reads as "could not load", never
 * as "none" — an empty list is a claim about the market, and a failed read is
 * not one.
 */
export async function fetchTargets(ws) {
  const part = async (q) => {
    const { data, error } = await q
    return error ? { rows: [], error: error.message } : { rows: data || [], error: '' }
  }
  const [icp, accounts, opportunities, events, lastRun] = await Promise.all([
    part(supabase.from('sales_icp').select('config,updated_at').eq('workspace_id', ws).limit(1)),
    part(supabase.from('sales_accounts').select('*').eq('workspace_id', ws)
      .order('priority', { ascending: true }).order('value_sar', { ascending: false, nullsFirst: false })),
    part(supabase.from('research_opportunities').select(OPP_COLUMNS).eq('workspace_id', ws)
      .order('last_seen_at', { ascending: false }).limit(300)),
    part(supabase.from('research_events').select(EVENT_COLUMNS).eq('workspace_id', ws)
      .order('start_date', { ascending: true, nullsFirst: false }).limit(150)),
    part(supabase.from('research_runs').select('started_at,status').eq('workspace_id', ws)
      .eq('status', 'complete').order('started_at', { ascending: false }).limit(1)),
  ])
  return {
    icp: icp.rows[0]?.config || null,
    icpUpdatedAt: icp.rows[0]?.updated_at || null,
    accounts: accounts.rows,
    opportunities: opportunities.rows,
    events: events.rows,
    lastRunAt: lastRun.rows[0]?.started_at || null,
    errors: {
      icp: icp.error, accounts: accounts.error, opportunities: opportunities.error, events: events.error,
    },
  }
}

/** The two battle cards, { outbound, inbound }. Admin only by RLS. */
export async function fetchBattleCards(ws) {
  const { data, error } = await supabase.from('sales_icp').select('battle_cards').eq('workspace_id', ws).limit(1)
  if (error) return { error: error.message }
  return { cards: data?.[0]?.battle_cards || {} }
}

export async function saveIcp(ws, config) {
  const { data: { user } = {} } = await supabase.auth.getUser()
  const { error } = await supabase.from('sales_icp').upsert({
    workspace_id: ws, config, updated_by: user?.id || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

const ACCOUNT_STATUS_KEYS = ACCOUNT_STATUSES.map(([k]) => k)

/** Status, owner, note and next-step date. Everything else came from the analysis. */
export async function updateAccount(ws, id, { status, owner, owner_note, next_step_on } = {}) {
  const body = { updated_at: new Date().toISOString() }
  if (status !== undefined) {
    if (!ACCOUNT_STATUS_KEYS.includes(status)) return { ok: false, error: 'Unknown status.' }
    body.status = status
  }
  if (owner !== undefined) body.owner = String(owner).slice(0, 120)
  if (owner_note !== undefined) body.owner_note = String(owner_note).slice(0, 2000)
  if (next_step_on !== undefined) body.next_step_on = next_step_on || null
  const { error } = await supabase.from('sales_accounts').update(body).eq('id', id).eq('workspace_id', ws)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function updateTarget(ws, id, { status, owner_note } = {}) {
  const body = { updated_at: new Date().toISOString() }
  if (status !== undefined) {
    if (!OPPORTUNITY_STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' }
    body.status = status
  }
  if (owner_note !== undefined) body.owner_note = String(owner_note).slice(0, 2000)
  const { error } = await supabase.from('research_opportunities').update(body).eq('id', id).eq('workspace_id', ws)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function updateEvent(ws, id, decision) {
  if (!EVENT_DECISIONS.includes(decision)) return { ok: false, error: 'Unknown decision.' }
  const { error } = await supabase.from('research_events')
    .update({ decision, updated_at: new Date().toISOString() }).eq('id', id).eq('workspace_id', ws)
  return error ? { ok: false, error: error.message } : { ok: true }
}
