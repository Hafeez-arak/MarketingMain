import { supabase } from './supabaseClient'

// ─── The CEO page's data ───────────────────────────────────────────────────
// 2026-10-18. The latest brief (ceo_briefs, admins only by RLS), writing a
// fresh one (POST /api/agent/chat with mode 'ceo_brief'; the chat endpoint
// carries it because the project is at Vercel Hobby's 12-function limit),
// and turning a brief item into a request.

export async function fetchLatestBrief(workspaceId) {
  if (!workspaceId) return { brief: null, error: null }
  const { data, error } = await supabase
    .from('ceo_briefs')
    .select('id,period_start,period_end,kpis,brief,trigger,created_at,cost_usd')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { brief: null, error: error.message }
  return { brief: data?.[0] || null, error: null }
}

/** About a minute: the facts are gathered and one model call writes both languages. */
export async function writeBrief(workspaceId, accessToken) {
  try {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ workspace_id: workspaceId, mode: 'ceo_brief' }),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) return { error: out.error || `The brief could not be written (${res.status}).` }
    return { brief: out.brief, error: null }
  } catch (err) {
    return { error: err?.message || 'The brief could not be written.' }
  }
}

/** A brief item becomes a request on the board, asked by whoever pressed the button. */
export async function requestFrom(workspaceId, userId, { title, body, kind = 'task' }) {
  const { data, error } = await supabase
    .from('requests')
    .insert({
      workspace_id: workspaceId, created_by: userId, updated_by: userId,
      title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 4000), kind, page: '/ceo',
    })
    .select('id')
    .single()
  return error ? { error: error.message } : { id: data.id, error: null }
}
