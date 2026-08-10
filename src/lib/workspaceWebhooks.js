import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Workspace webhooks ─────────────────────────────────────────────────────
// The n8n webhook URLs (Settings → Workflow Webhooks) stored per workspace in
// Supabase — table: workspace_webhooks, one row per workspace, the whole map
// as jsonb — instead of only in this browser's localStorage. Same auth model
// as brandBrain.js: `apikey` is the fixed anon key, `Authorization` carries
// the signed-in user's session token so RLS scopes the row to workspaces
// they're actually a member of.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

export async function fetchWorkspaceWebhooks(workspaceId, accessToken) {
  if (!workspaceId) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workspace_webhooks?workspace_id=eq.${workspaceId}&select=webhooks`, {
      headers: authHeaders(accessToken),
    })
    if (!res.ok) return null
    const rows = await res.json()
    return rows?.[0]?.webhooks || null
  } catch {
    return null
  }
}

export async function saveWorkspaceWebhooks(workspaceId, accessToken, webhooks) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workspace_webhooks?on_conflict=workspace_id`, {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({ workspace_id: workspaceId, webhooks, updated_at: new Date().toISOString() }),
    })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    // Same fallback as saveBrandProfile: a successful write with no
    // representation (missing SELECT policy, proxy stripping Prefer)
    // shouldn't report back an empty map and blank the form.
    let row = null
    try { const rows = await res.json(); row = Array.isArray(rows) ? rows[0] : rows } catch { /* empty body */ }
    return { ok: true, webhooks: row?.webhooks || webhooks }
  } catch (e) {
    return { error: String(e) }
  }
}
