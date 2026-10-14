import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Workspace webhooks ─────────────────────────────────────────────────────
// Per-workspace n8n webhook overrides stored in Supabase — table:
// workspace_webhooks, one row per workspace, the whole map as jsonb. Read-only
// from the app since the Integrations page (which edited them) was removed:
// every slot defaults to /api/n8n/<slot>, and an override can still be set
// in the table directly for testing against another n8n. Same auth model
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
