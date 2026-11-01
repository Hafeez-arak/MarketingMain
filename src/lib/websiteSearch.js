import { defaultWebhookUrl } from './n8nWebhooks'
import { supabase } from './supabaseClient'

// ─── The website's side of the dashboard ───────────────────────────────────
// One call to /api/agent/search, which reads Google Search Console for this
// workspace's property. The service-account key stays on the server, exactly
// like every other provider in this project.
//
// The route answers three states and they are deliberately not collapsed:
//
//   configured: false   nobody has set it up — the card shows the steps
//   ok: false           set up and FAILING — the card shows the error
//   ok: true            a real answer, even when it holds no rows
//
// A dead credential that reads as "nobody is searching for us" is the silent
// failure this project has already paid for twice, so the middle state is
// never folded into the third.

export async function fetchWebsiteSearch(workspaceId, accessToken) {
  if (!workspaceId) return { ok: false, configured: false, error: 'No workspace selected.' }
  if (!accessToken) return { ok: false, configured: false, error: 'Sign in to read website analytics.' }
  try {
    const res = await fetch('/api/agent/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { ok: false, configured: true, error: `The server returned ${res.status} with nothing in it.` }
    return data
  } catch (err) {
    return { ok: false, configured: true, error: `Could not reach the server: ${err.message}` }
  }
}

/**
 * Everything the Analytics page's Website tab draws.
 *
 * A second call rather than a parameter on the one above, mirroring the two
 * routes: the dashboard card must stay three Search Console calls because it
 * paints on every visit to the home page, and this one makes twenty-eight
 * requests across two Google products. See the header of api/agent/website.js.
 *
 * The two halves of the answer — `search` and `ga4` — each carry their own
 * configured/ok/error, and the page renders whichever it has. GA4 being
 * unconfigured is the normal state until somebody installs a tag on the site,
 * and it must never hide working Search Console numbers behind it.
 */
/** @param {object|number} range A `{ days }` preset or a `{ from, to }` window. */
export async function fetchWebsiteAnalytics(workspaceId, accessToken, range = 28) {
  if (!workspaceId) return { ok: false, error: 'No workspace selected.' }
  if (!accessToken) return { ok: false, error: 'Sign in to read website analytics.' }
  // Preset and fixed windows stay apart across the wire — see src/lib/dateRange.js.
  const window = typeof range === 'number'
    ? { days: range }
    : (range?.from && range?.to
      ? { from: range.from, to: range.to }
      : { days: Number(range?.days) || 28 })
  try {
    const res = await fetch('/api/agent/website', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId, ...window }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { ok: false, error: `The server returned ${res.status} with nothing in it.` }
    return data
  } catch (err) {
    return { ok: false, error: `Could not reach the server: ${err.message}` }
  }
}

/**
 * Page-by-page index status, from the URL Inspection API.
 *
 * A third route, and a slow one — it inspects up to 120 URLs at one Google
 * call each and takes about forty seconds. It is never called on mount for
 * exactly that reason; a person presses a button, and the panel says how long
 * it will take before they press it.
 */
export async function fetchIndexHealth(workspaceId, accessToken) {
  if (!workspaceId) return { ok: false, error: 'No workspace selected.' }
  if (!accessToken) return { ok: false, error: 'Sign in to read website analytics.' }
  try {
    const res = await fetch(defaultWebhookUrl('agentWebsite'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      // api/n8n authenticates this header, then n8n passes the same token to
      // the private agent service so the handler still checks workspace
      // membership before spending Search Console quota.
      body: JSON.stringify({ action: 'indexHealth', workspace_id: workspaceId, access_token: accessToken }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { ok: false, error: `The server returned ${res.status} with nothing in it.` }
    return data
  } catch (err) {
    return { ok: false, error: `Could not reach the server: ${err.message}` }
  }
}

/**
 * Three sentences explaining the numbers, written by a model.
 *
 * The ONLY call from this page that costs money, which is why it takes the
 * facts as an argument rather than fetching them: the screen has already
 * computed every figure, and a second read would risk a sentence that
 * disagrees with the tile above it. See api/agent/websiteExplain.js.
 */
export async function fetchWebsiteExplanation(workspaceId, accessToken, facts, audience = 'analytics') {
  if (!workspaceId) return { ok: false, points: [], error: 'No workspace selected.' }
  if (!accessToken) return { ok: false, points: [], error: 'Sign in to read website analytics.' }
  try {
    const res = await fetch(defaultWebhookUrl('agentWebsite'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action: 'websiteExplain', workspace_id: workspaceId, facts, audience, access_token: accessToken }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { ok: false, points: [], error: `The server returned ${res.status} with nothing in it.` }
    return data
  } catch (err) {
    return { ok: false, points: [], error: `Could not reach the server: ${err.message}` }
  }
}

/**
 * Ask the brand's buyer questions through an AI assistant with web search and
 * record whether the company was named. Paid: about five to ten cents a
 * question, on the workspace's monthly cap. See server/agentHandlers/aiAnswers.js.
 */
export async function runAiAnswersCheck(workspaceId, accessToken) {
  if (!workspaceId) return { ok: false, error: 'No workspace selected.' }
  if (!accessToken) return { ok: false, error: 'Sign in to read website analytics.' }
  try {
    const res = await fetch(defaultWebhookUrl('agentWebsite'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action: 'aiAnswers', workspace_id: workspaceId, access_token: accessToken }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { ok: false, error: `The server returned ${res.status} with nothing in it.` }
    return data
  } catch (err) {
    return { ok: false, error: `Could not reach the server: ${err.message}` }
  }
}

/**
 * Past AI-answer checks, newest first. Free: a read of what earlier checks
 * stored, so the panel shows where things stood without asking again.
 * Filtered by workspace explicitly, not left to RLS — a member of two
 * companies can read both.
 */
export async function loadAiAnswerChecks(workspaceId) {
  if (!workspaceId) return { ok: false, rows: [], error: 'No workspace selected.' }
  try {
    const { data } = await supabase.from('ai_answer_checks')
      .select('run_id,checked_at,engine,question,answer,named,rank,cited,competitors,sources,cost_usd,error')
      .eq('workspace_id', workspaceId)
      .order('checked_at', { ascending: false })
      .limit(200)
      .throwOnError()
    return { ok: true, rows: data || [] }
  } catch (err) {
    return { ok: false, rows: [], error: String(err?.message || err) }
  }
}

