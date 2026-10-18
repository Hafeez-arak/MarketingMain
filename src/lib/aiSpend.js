import { supabase } from './supabaseClient'

// ─── AI spending, for the Settings card ────────────────────────────────────
// 2026-10-18, PR 3 of docs/CEO-ASSISTANT-PLAN.md. Reads agent_usage (members
// may read it; only the server writes it) and changes the limit through
// set_agent_cap(), which refuses anyone but an admin of the company and
// notifies the other admins.

/** agent_usage.surface, in words. Anything unlisted shows under its own name. */
export const SURFACE_LABEL = {
  run: 'Weekly research run',
  chat: 'Assistant chat',
  review: 'Assistant reviews',
  lead_qualifier: 'Lead agent',
  lead_qualifier_shadow: 'Lead agent (second opinion)',
  lead_qualifier_test: 'Lead agent (tests)',
  lead_phones: 'Lead agent (phone numbers)',
  composer: 'Post composer',
  discover: 'Finding rivals',
  resolve: 'Research follow-ups',
}

export const surfaceLabel = s => SURFACE_LABEL[s] || String(s || 'Other').replace(/_/g, ' ')

/** First instant of this month and of last month, UTC. */
export function monthStarts(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  return { thisMonth: new Date(Date.UTC(y, m, 1)).toISOString(), lastMonth: new Date(Date.UTC(y, m - 1, 1)).toISOString() }
}

/**
 * Rows -> { total, lastTotal, bySurface: [{ surface, label, cost }] } for the
 * current month, largest first. `rows` may include last month's too.
 */
export function spendBreakdown(rows = [], now = new Date()) {
  const { thisMonth, lastMonth } = monthStarts(now)
  const cur = rows.filter(r => r.created_at >= thisMonth)
  const prev = rows.filter(r => r.created_at >= lastMonth && r.created_at < thisMonth)
  const sum = list => Math.round(list.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0) * 100) / 100
  const by = new Map()
  for (const r of cur) by.set(r.surface || 'other', (by.get(r.surface || 'other') || 0) + (Number(r.cost_usd) || 0))
  return {
    total: sum(cur),
    lastTotal: sum(prev),
    bySurface: [...by.entries()]
      .map(([surface, cost]) => ({ surface, label: surfaceLabel(surface), cost: Math.round(cost * 100) / 100 }))
      .filter(s => s.cost > 0)
      .sort((a, b) => b.cost - a.cost),
  }
}

/** A sensible ceiling for the month: what is spent so far, run on at the same daily rate. */
export function projectedMonth(total, now = new Date()) {
  const day = now.getUTCDate()
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  return day ? Math.round((total / day) * days * 100) / 100 : total
}

export async function fetchSpend(workspaceId, now = new Date()) {
  const { lastMonth } = monthStarts(now)
  const [usage, ws, log] = await Promise.all([
    supabase.from('agent_usage').select('surface,cost_usd,created_at')
      .eq('workspace_id', workspaceId).gte('created_at', lastMonth).limit(20000),
    supabase.from('workspaces').select('agent_monthly_cap_usd').eq('id', workspaceId).maybeSingle(),
    supabase.from('agent_cap_log').select('old_cap,new_cap,changed_by,created_at')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
  ])
  if (usage.error || ws.error) return { error: (usage.error || ws.error).message }
  const cap = ws.data?.agent_monthly_cap_usd
  return {
    error: null,
    cap: cap === null || cap === undefined ? null : Number(cap),
    ...spendBreakdown(usage.data || [], now),
    changes: log.data || [],
  }
}

export async function setCap(workspaceId, cap) {
  const { data, error } = await supabase.rpc('set_agent_cap', { ws: workspaceId, cap: Number(cap) })
  return error ? { error: error.message } : { cap: Number(data), error: null }
}
