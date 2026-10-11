import { supabase } from '../supabaseClient'
import { PAGE_SIZE, pageRange, verdictFilter } from './view'

// ─── Lead Agent: the browser's data layer ──────────────────────────────────
// Reads go straight to Supabase with the admin's own session (RLS lets only
// the access admin see leads). Anything that spends, changes settings or
// needs a secret goes through /api/leads/<action>, which checks again.
// Every query carries its own workspace_id filter: RLS is membership, not
// isolation.

const LEAD_COLUMNS = 'id,source,received_at,name,company,email,phone,subject,message,language,verdict,category,confidence,reason,summary,details,ask_next,duplicate_of,model,cost_usd,error,human_verdict,reviewed_at,created_at,mailbox,link,sender_type,sender_evidence,source_check,source_evidence,project_type,project_evidence,request_type,philips,rule,website,folder,email_kind,criteria_version'

/**
 * One page of the list, filtered by tab in the database, with the tab's
 * total. Ties on received_at are broken by id so no lead appears on two
 * pages or on none.
 */
export async function fetchLeadsPage(ws, { tab = 'all', page = 0, pageSize = PAGE_SIZE } = {}) {
  const { from, to } = pageRange(page, pageSize)
  let q = supabase.from('leads').select(LEAD_COLUMNS, { count: 'exact' })
    .eq('workspace_id', ws)
  const filter = verdictFilter(tab)
  if (filter) q = q.or(filter)
  const { data, error, count } = await q
    .order('received_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, to)
  if (error) throw new Error(error.message)
  return { rows: data || [], total: count ?? 0 }
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
 * Download a lead's original email (.eml, attachments included). Opened, it
 * lands in the computer's mail app: Outlook when Outlook is the default.
 * Returns { ok } or { error }.
 */
export async function downloadEmailFile(workspaceId, lead) {
  try {
    const res = await fetch('/api/leads/email_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, lead_id: lead.id }),
    })
    if (!res.ok || /json/.test(res.headers.get('content-type') || '')) {
      const data = await res.json().catch(() => null)
      return { error: data?.error || `The email could not be fetched (${res.status}).` }
    }
    const blob = await res.blob()
    const name = decodeURIComponent((res.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'email.eml')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { ok: true }
  } catch (err) {
    return { error: `Could not reach the server: ${err.message}` }
  }
}
