import { db } from '../agent/_supabase.js'
import { sealSecret, openSecret } from '../email/_secrets.js'
import { msConfig } from '../email/_graph.js'
import { checkMail } from './_mail.js'

// ─── The lead agent's real IO, in one place ────────────────────────────────
// Used by api/leads/[action].js and, for the two things that must live in
// the Email route (Microsoft's sign-in callback, whose address is the one
// registered in Entra, and the daily cron), by api/email/[action].js.

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
// A deployment-wide key, used when a company has not saved its own.
const ENV_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || ''

/** The company's own key if it saved one, else the deployment's. */
export async function openRouterKey(workspaceId) {
  const [row] = await db(`lead_agent_secrets?workspace_id=eq.${workspaceId}&select=openrouter_key`) || []
  if (row?.openrouter_key) {
    try { return openSecret(row.openrouter_key, SERVICE_KEY) } catch { /* sealed with an old service key: fall back */ }
  }
  return ENV_OPENROUTER_KEY
}

export const hasDeploymentKey = Boolean(ENV_OPENROUTER_KEY)

async function callOpenRouter(body, workspaceId) {
  const key = await openRouterKey(workspaceId)
  // Said plainly; how to fix it is in docs/LEADS-SETUP.md.
  if (!key) return { error: 'No OpenRouter key is saved for the lead agent.' }
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Arak lead agent' },
      body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) return { error: j.error?.message || `OpenRouter answered ${r.status}`, usage: j.usage }
    return { text: j.choices?.[0]?.message?.content || '', usage: j.usage || {} }
  } catch (err) {
    return { error: `Could not reach OpenRouter: ${err.message}` }
  }
}

export function leadDeps() {
  const deps = {
    db,
    model: callOpenRouter,
    now: () => new Date(),
    fetch: (...args) => fetch(...args),
    ms: msConfig(),
    seal: (plain) => sealSecret(plain, SERVICE_KEY),
    open: (sealed) => openSecret(sealed, SERVICE_KEY),
  }
  deps.checkMail = (args) => checkMail(deps, args)
  return deps
}
