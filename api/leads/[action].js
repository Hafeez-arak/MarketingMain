import crypto from 'node:crypto'
import { db, isConfigured } from '../agent/_supabase.js'
import { sealSecret, openSecret } from '../email/_secrets.js'
import { intakeWebsite, tryIt, QUALIFIER_MODEL } from './_intake.js'

// ─── /api/leads/<action> ───────────────────────────────────────────────────
// One Vercel function for the lead agent: the last of the twelve the Hobby
// plan builds (api/_vercelFunctionBudget.test.js). Everything the agent will
// ever need, the info@ mailbox included, goes behind this one dynamic route.
//
//   the website Sheet   POST /website with the Sheet's intake key, every five
//                       minutes from its own Apps Script timer. The key is the
//                       only proof, and all it can do is have that company's
//                       rows read and get two cells back for each.
//   the admin           POST /<action>, Bearer token, workspace_id in the body.
//                       Signed in, a member of that workspace (asked with the
//                       caller's own token, so RLS answers) and the access
//                       admin. Only then does the service key touch anything.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
// A deployment-wide key, used when a company has not saved its own.
const ENV_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || ''

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))

function bearerOf(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  try { for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)) } catch { /* no stream */ }
  const raw = chunks.length ? Buffer.concat(chunks).toString('utf8') : (typeof req.body === 'string' ? req.body : '')
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

// ─── OpenRouter ────────────────────────────────────────────────────────────

/** The company's own key if it saved one, else the deployment's. */
async function openRouterKey(workspaceId) {
  const [row] = await db(`lead_agent_secrets?workspace_id=eq.${workspaceId}&select=openrouter_key`) || []
  if (row?.openrouter_key) {
    try { return openSecret(row.openrouter_key, SERVICE_KEY) } catch { /* sealed with an old service key: fall back */ }
  }
  return ENV_OPENROUTER_KEY
}

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

/** What OpenRouter says about a key: valid, its label, credit left. Free. */
async function describeKey(key) {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.data) return { valid: false }
    return { valid: true, label: j.data.label || '', limitRemaining: j.data.limit_remaining ?? null, usage: j.data.usage ?? null }
  } catch { return { valid: false } }
}

const deps = () => ({ db, model: callOpenRouter, now: () => new Date() })

// ─── Who is calling ────────────────────────────────────────────────────────

async function authenticate(token) {
  if (!token) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    const user = await r.json()
    return user?.id ? user : null
  } catch { return null }
}

// Both asked WITH THE CALLER'S TOKEN: RLS answers membership, and the
// database's own is_access_admin() answers admin. A service-key read would
// say yes to anyone.
async function isMember(workspaceId, token) {
  if (!isUuid(workspaceId)) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=id`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    const rows = r.ok ? await r.json() : []
    return Array.isArray(rows) && rows.length === 1
  } catch { return false }
}

async function isAdmin(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_access_admin`, {
      method: 'POST',
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    return r.ok && (await r.json()) === true
  } catch { return false }
}

/** The company's settings row, made on first sight. */
async function settingsFor(workspaceId) {
  let [row] = await db(`lead_agent_settings?workspace_id=eq.${workspaceId}&select=*`) || []
  if (!row) {
    ;[row] = await db('lead_agent_settings?on_conflict=workspace_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: { workspace_id: workspaceId },
    }) || []
  }
  return row
}

const fail = (status, error) => ({ __fail: true, status, error })

// ─── Admin actions ─────────────────────────────────────────────────────────

const actions = {
  /** Everything the Lead Agent page shows that RLS cannot: the key and the model. */
  async status({ workspaceId }) {
    const settings = await settingsFor(workspaceId)
    const [secret] = await db(`lead_agent_secrets?workspace_id=eq.${workspaceId}&select=updated_at`) || []
    const key = await openRouterKey(workspaceId)
    return {
      settings,
      model: QUALIFIER_MODEL,
      key: { saved: Boolean(secret), savedAt: secret?.updated_at || null, fromDeployment: !secret && Boolean(ENV_OPENROUTER_KEY), ...(key ? await describeKey(key) : { valid: false }) },
    }
  },

  async set_enabled({ workspaceId, body }) {
    await settingsFor(workspaceId)
    const [row] = await db(`lead_agent_settings?workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation', body: { enabled: Boolean(body.enabled), updated_at: new Date().toISOString() },
    }) || []
    return { settings: row }
  },

  async rotate_intake_key({ workspaceId }) {
    await settingsFor(workspaceId)
    const [row] = await db(`lead_agent_settings?workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation', body: { intake_key: crypto.randomUUID(), updated_at: new Date().toISOString() },
    }) || []
    return { settings: row }
  },

  /** Save (or replace) the OpenRouter key, sealed. Checked with OpenRouter first. */
  async save_key({ workspaceId, body }) {
    const key = String(body.openrouter_key || '').trim()
    if (!/^sk-or-[\w-]{20,}$/.test(key)) return fail(400, 'That does not look like an OpenRouter key (it starts with sk-or-).')
    const info = await describeKey(key)
    if (!info.valid) return fail(400, 'OpenRouter did not accept that key.')
    await db('lead_agent_secrets?on_conflict=workspace_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { workspace_id: workspaceId, openrouter_key: sealSecret(key, SERVICE_KEY), updated_at: new Date().toISOString() },
    })
    return { key: { saved: true, ...info } }
  },

  /** Check any pasted enquiry or email. Nothing is stored. */
  async try({ workspaceId, body }) {
    const out = await tryIt(deps(), { workspaceId, input: body })
    if (out.error) return fail(out.status, out.error)
    return { verdict: out.verdict, cost: out.cost, model: out.model }
  },

  /** A person corrects (or confirms) a verdict. The agent never overwrites it. */
  async review({ workspaceId, body, user }) {
    if (!isUuid(body.lead_id)) return fail(400, 'lead_id is required.')
    const verdict = body.verdict === null ? null : String(body.verdict || '')
    if (verdict !== null && !['qualified', 'unqualified', 'needs_review'].includes(verdict)) return fail(400, 'Unknown verdict.')
    const [row] = await db(`leads?id=eq.${body.lead_id}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { human_verdict: verdict, reviewed_by: verdict ? user.id : null, reviewed_at: verdict ? new Date().toISOString() : null },
    }) || []
    if (!row) return fail(404, 'That lead is not in this company.')
    return { lead: row }
  },
}

// ─── Entry ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = String(req.query?.action || '')
  if (!SUPABASE_URL || !SERVICE_KEY || !isConfigured) {
    return res.status(503).json({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.' })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'POST only' })
  }
  const body = await readJson(req)

  if (action === 'website') {
    try {
      const out = await intakeWebsite(deps(), { key: body.key, rows: body.rows })
      if (out.error) return res.status(out.status).json({ ok: false, error: out.error })
      return res.status(200).json({ ok: true, off: Boolean(out.off), results: out.results })
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
    }
  }

  if (!Object.prototype.hasOwnProperty.call(actions, action)) return res.status(404).json({ ok: false, error: `Unknown action: ${action || '(none)'}` })
  const workspaceId = String(body.workspace_id || '').trim()
  const token = bearerOf(req)
  const user = await authenticate(token)
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in to do this. If you are signed in, reload the page.' })
  const [member, admin] = await Promise.all([isMember(workspaceId, token), isAdmin(token)])
  if (!member) return res.status(403).json({ ok: false, error: 'You do not have access to that workspace.' })
  if (!admin) return res.status(403).json({ ok: false, error: 'The lead agent is for the admin only.' })

  try {
    const out = await actions[action]({ workspaceId, body, user })
    if (out && out.__fail) return res.status(out.status).json({ ok: false, error: out.error })
    return res.status(200).json({ ok: true, ...out })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
  }
}
