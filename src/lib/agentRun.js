// ─── Starting and watching a research run ──────────────────────────────────
// The browser never holds a fetch across a run. It gets a run id back and
// polls research_runs — which is why every terminal path on the server writes
// a status: the spinner this opens can only be closed by a row changing.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

/**
 * Ask for a research run.
 *
 * `already_running` is a success, not a failure: a second press attaches to
 * the run already going rather than starting a second agent on the same period
 * and doubling the bill.
 */
export async function startResearchRun({ workspaceId, accessToken, periodDays = 7 }) {
  try {
    const res = await fetch('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ workspace_id: workspaceId, trigger: 'manual', period_days: periodDays }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `The run returned ${res.status}.` }
    return body
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

/** The most recent runs for a workspace, newest first. */
export async function fetchRuns(workspaceId, accessToken, limit = 5) {
  const url = `${SUPABASE_URL}/rest/v1/research_runs?workspace_id=eq.${workspaceId}` +
    `&order=started_at.desc&limit=${limit}` +
    `&select=id,status,stage,started_at,finished_at,report,error`
  try {
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

/**
 * The per-lens results for one run, so a person can watch it happen.
 *
 * Read straight from Postgres rather than from n8n. Every lens upserts its row
 * the moment it finishes — duration, cost, findings, error — so the run
 * already narrates itself where the browser can see it. n8n is only the thing
 * pressing the buttons.
 */
export async function fetchLensResults(workspaceId, runId, accessToken) {
  if (!workspaceId || !runId) return []
  const url = `${SUPABASE_URL}/rest/v1/research_lens_results?workspace_id=eq.${workspaceId}` +
    `&run_id=eq.${runId}&select=lens,status,findings,duration_ms,cost_usd,timed_out,error,note`
  try {
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}
