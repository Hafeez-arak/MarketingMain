// ─── Starting and watching a research run ──────────────────────────────────
// The browser never holds a fetch across a run. It gets a run id back and
// polls research_runs — which is why every terminal path on the server writes
// a status: the spinner this opens can only be closed by a row changing.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { defaultWebhookUrl, describeWebhookFailure } from './n8nWebhooks'

/**
 * Ask for a research run.
 *
 * `already_running` is a success, not a failure: a second press attaches to
 * the run already going rather than starting a second agent on the same period
 * and doubling the bill.
 */
export async function startResearchRun({ workspaceId, accessToken, periodDays = 7 }) {
  try {
    // Through n8n, which drives the whole run on the agent container next to
    // it — the same workflow the Monday run uses. Calling /api/agent/run here
    // used to start a run nothing would finish: the lenses were only ever
    // driven by n8n, so an app-started run sat at "lenses" forever.
    //
    // The token goes in the body as well as the header. The proxy checks the
    // header and forwards only the body; n8n hands this token to the agent,
    // which uses it to prove the caller belongs to this workspace.
    const res = await fetch(defaultWebhookUrl('agentRun'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        workspace_id: workspaceId, trigger: 'manual', period_days: periodDays, access_token: accessToken,
      }),
    })
    if (!res.ok) return { ok: false, error: await describeWebhookFailure(res) }
    const body = await res.json().catch(() => ({}))
    if (!body || typeof body !== 'object') return { ok: false, error: 'The run did not answer.' }
    if (!body.ok && !body.already_running) return { ok: false, error: body.error || 'The run failed to start.' }
    return body
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

/** The most recent runs for a workspace, newest first. */
export async function fetchRuns(workspaceId, accessToken, limit = 5, { throwOnError = false } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/research_runs?workspace_id=eq.${workspaceId}` +
    `&order=started_at.desc&limit=${limit}` +
    `&select=id,status,stage,started_at,finished_at,report,error,cost_estimate`
  let failure
  try {
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` },
    })
    if (res.ok) return await res.json()
    failure = new Error(`The research runs could not be read (${res.status})`)
  } catch (err) {
    failure = err
  }
  // A page that says "no research has run yet" must know the list really is
  // empty: with throwOnError a failed read is an error, not an empty list.
  if (throwOnError) throw failure
  return []
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

/**
 * This month's agent spend and the workspace's cap, for the Run research
 * confirmation. Null when either cannot be read: the dialog then says less
 * rather than showing a zero it does not know.
 */
export async function fetchAgentSpend(workspaceId, accessToken, now = new Date()) {
  if (!workspaceId || !accessToken) return null
  const since = `${now.toISOString().slice(0, 7)}-01T00:00:00Z`
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
  try {
    const [usage, ws] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/agent_usage?workspace_id=eq.${workspaceId}&created_at=gte.${since}&select=cost_usd&limit=10000`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=agent_monthly_cap_usd`, { headers }),
    ])
    if (!usage.ok || !ws.ok) return null
    const rows = await usage.json()
    const cap = (await ws.json())?.[0]?.agent_monthly_cap_usd
    return {
      spent: rows.reduce((t, r) => t + (Number(r.cost_usd) || 0), 0),
      cap: cap === null || cap === undefined ? null : Number(cap),
    }
  } catch {
    return null
  }
}
