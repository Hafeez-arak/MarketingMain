import { supabase } from '../supabaseClient'
import { PAGE_SIZE, pageRange, verdictFilter, leadFilters } from './view'

// ─── Lead Agent: the browser's data layer ──────────────────────────────────
// Reads go straight to Supabase with the admin's own session (RLS lets only
// the access admin see leads). Anything that spends, changes settings or
// needs a secret goes through /api/leads/<action>, which checks again.
// Every query carries its own workspace_id filter: RLS is membership, not
// isolation.

const LEAD_COLUMNS = 'id,source,received_at,name,company,email,phone,subject,message,language,verdict,category,confidence,reason,summary,details,ask_next,duplicate_of,model,cost_usd,error,human_verdict,reviewed_at,created_at,mailbox,link,sender_type,sender_evidence,source_check,source_evidence,project_type,project_evidence,request_type,philips,rule,website,folder,email_kind,criteria_version,phones,human_reason,approved_at,crm_status,crm_url,crm_error,human_project_type,project_final,assigned_to,assigned_at,forward_status,forward_to,forward_error,forwarded_at,channel,stage,stage_at,lost_reason,lost_to,next_step,follow_up,added_by'

/**
 * One page of the list, filtered in the database (see leadFilters), with the
 * filtered total. `tab` is the older verdict-only filter. Ties on
 * received_at are broken by id so no lead appears on two pages or on none.
 */
export async function fetchLeadsPage(ws, { tab = null, filters = null, page = 0, pageSize = PAGE_SIZE, me = '' } = {}) {
  const { from, to } = pageRange(page, pageSize)
  let q = supabase.from('leads').select(LEAD_COLUMNS, { count: 'exact' })
    .eq('workspace_id', ws)
  const { ors, eqs } = filters ? leadFilters(filters, { me }) : { ors: [verdictFilter(tab || 'all')].filter(Boolean), eqs: [] }
  for (const o of ors) q = q.or(o)
  for (const [col, val] of eqs) q = q.eq(col, val)
  const { data, error, count } = await q
    .order('received_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, to)
  if (error) throw new Error(error.message)
  return { rows: data || [], total: count ?? 0 }
}

/**
 * The Pipeline (2026-10-18): every lead with a stage (approved, or added by
 * hand), whoever's they are — RLS keeps a salesperson to their own. Small
 * enough to read whole: the page groups it by stage.
 */
export async function fetchPipeline(ws, { owner = '', me = '' } = {}) {
  let q = supabase.from('leads').select(LEAD_COLUMNS).eq('workspace_id', ws).not('stage', 'is', null)
  if (owner === 'me' && me) q = q.eq('assigned_to', me)
  else if (owner === 'none') q = q.is('assigned_to', null)
  else if (owner && owner !== 'me') q = q.eq('assigned_to', owner)
  const { data, error } = await q.order('stage_at', { ascending: false, nullsFirst: false }).limit(1000)
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Every lead that touches this month (arrived in it, or was paid for in it),
 * for the month's counts. Only the columns monthStats reads.
 */
export async function fetchMonthLeads(ws, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data, error } = await supabase.from('leads').select('id,received_at,created_at,verdict,human_verdict,cost_usd')
    .eq('workspace_id', ws)
    .or(`received_at.gte.${start},created_at.gte.${start}`)
  if (error) throw new Error(error.message)
  return data || []
}

export async function leadsApi(action, workspaceId, payload = {}) {
  try {
    const res = await fetch(`/api/leads/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, workspace_id: workspaceId }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { error: `The server returned ${res.status} with nothing in it.` }
    if (data.ok === false || !res.ok) return { error: data.error || `Request failed (${res.status}).`, ...data }
    return data
  } catch (err) {
    return { error: `Could not reach the server: ${err.message}` }
  }
}

/**
 * The company's sales team by name (sales_team, 20261018): for the Owner
 * column and the Assign choice. Readable by the team and the admin.
 */
export async function fetchSalesTeam(ws) {
  const { data, error } = await supabase.rpc('sales_team', { ws_id: ws })
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Read and unread (2026-10-19, 20261027_lead_reads) ─────────────────────

/** Which of these leads this person has opened, as a Set of ids. */
export async function fetchReads(ws, ids = []) {
  if (!ids.length) return new Set()
  const { data, error } = await supabase.from('lead_reads').select('lead_id').eq('workspace_id', ws).in('lead_id', ids)
  if (error) throw new Error(error.message)
  return new Set((data || []).map((r) => r.lead_id))
}

/** When everything before counts as read for this company, or null. */
export async function fetchReadBefore(ws) {
  const { data, error } = await supabase.rpc('lead_read_before', { ws })
  if (error) throw new Error(error.message)
  return data || null
}

/** Mark one lead read (or unread) for the signed-in person. */
export async function setLeadRead(ws, leadId, userId, read = true) {
  const q = supabase.from('lead_reads')
  const { error } = read
    ? await q.upsert({ lead_id: leadId, user_id: userId, workspace_id: ws }, { onConflict: 'lead_id,user_id', ignoreDuplicates: true })
    : await q.delete().eq('lead_id', leadId).eq('user_id', userId)
  return error?.message || null
}
