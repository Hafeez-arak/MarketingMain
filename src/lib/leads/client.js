import { supabase } from '../supabaseClient'

// ─── Lead Agent: the browser's data layer ──────────────────────────────────
// Reads go straight to Supabase with the admin's own session (RLS lets only
// the access admin see leads). Anything that spends, changes settings or
// needs a secret goes through /api/leads/<action>, which checks again.
// Every query carries its own workspace_id filter: RLS is membership, not
// isolation.

const LEAD_COLUMNS = 'id,source,received_at,name,company,email,phone,subject,message,language,verdict,category,confidence,reason,summary,details,ask_next,duplicate_of,model,cost_usd,error,human_verdict,reviewed_at,created_at,mailbox,link'

export async function fetchLeads(ws, { limit = 500 } = {}) {
  const { data, error } = await supabase.from('leads').select(LEAD_COLUMNS)
    .eq('workspace_id', ws)
    .order('received_at', { ascending: false, nullsFirst: false })
    .limit(limit)
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
