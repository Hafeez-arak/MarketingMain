import crypto from 'node:crypto'
import { db, isConfigured } from '../agent/_supabase.js'
import { sealSecret } from '../email/_secrets.js'
import { signState, authorizeUrl, READ_SCOPES } from '../email/_graph.js'
import { intakeWebsite, tryIt, QUALIFIER_MODEL } from './_intake.js'
import { checkMail } from './_mail.js'
import { exportLeads } from './_export.js'
import { leadDeps, openRouterKey, hasDeploymentKey, describeKey, sendAlert } from './_deps.js'

// ─── /api/leads/<action> ───────────────────────────────────────────────────
// One Vercel function for the lead agent: the last of the twelve the Hobby
// plan builds (api/_vercelFunctionBudget.test.js). Everything the agent will
// ever need goes behind this one dynamic route.
//
//   the website Sheet   POST /website with the Sheet's intake key, every five
//                       minutes from its own Apps Script timer. The key is the
//                       only proof, and all it can do is have that company's
//                       rows read (and its connected mailboxes checked) and
//                       get two cells back for each row. It is also the
//                       mailboxes' five-minute heartbeat: Google runs it, so
//                       no computer of ours needs to be on.
//   the master workbook POST /export with its own export key, every five
//                       minutes: every lead that changed since its cursor, as
//                       the workbook's rows. Read only.
//   the admin           POST /<action>, Bearer token, workspace_id in the body.
//                       Signed in, a member of that workspace (asked with the
//                       caller's own token, so RLS answers) and the access
//                       admin. Only then does the service key touch anything.
//
// Microsoft's sign-in comes back to /api/email/ms-callback (the address
// registered in Entra), which hands a lead-agent sign-in to _mail.js.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

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

function baseUrlOf(req) {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, '')
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || ''
  const proto = req.headers?.['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https')
  return host ? `${proto}://${host}` : ''
}

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

/**
 * Microsoft's admin-consent link for another organisation. Its admin approves
 * the app's read-only permissions for their whole Microsoft 365 once; the
 * answer comes back to the callback, which only shows a message.
 */
function consentUrl(ms, base) {
  const q = new URLSearchParams({
    client_id: ms.clientId,
    scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read openid profile email offline_access',
    redirect_uri: `${base}/api/email/ms-callback`,
    state: 'leads-consent',
  })
  return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${q}`
}

const MAILBOX_COLUMNS = 'id,email,label,tenant,display_name,status,read_from,last_checked_at,last_error,last_counts,history_from,history_until,history_cursor,history_done,created_at'
const fail = (status, error) => ({ __fail: true, status, error })

// ─── Admin actions ─────────────────────────────────────────────────────────

const actions = {
  /** Everything the Lead Agent page shows that RLS cannot: keys, model, mailboxes. */
  async status({ workspaceId }) {
    const settings = await settingsFor(workspaceId)
    const [[secret], mailboxes] = await Promise.all([
      db(`lead_agent_secrets?workspace_id=eq.${workspaceId}&select=updated_at`).then((r) => r || []),
      db(`lead_mailboxes?workspace_id=eq.${workspaceId}&select=${MAILBOX_COLUMNS}&order=created_at`).then((r) => r || []),
    ])
    const key = await openRouterKey(workspaceId)
    const ms = leadDeps().ms
    return {
      settings,
      model: QUALIFIER_MODEL,
      microsoft: ms.configured,
      // For a mailbox on another Microsoft 365 (clb-sa.com): its admin opens
      // this once to allow the app there. It comes back to the Lead Agent page.
      consentUrl: ms.configured ? consentUrl(ms, baseUrlOf(this.req)) : '',
      mailboxes,
      key: { saved: Boolean(secret), savedAt: secret?.updated_at || null, fromDeployment: !secret && hasDeploymentKey, ...(key ? await describeKey(key) : { valid: false }) },
    }
  },

  /** Who gets health alerts. Comma- or space-separated addresses. */
  async set_alert_emails({ workspaceId, body }) {
    const list = [...new Set(String(body.alert_emails || '').split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))]
    const bad = list.filter((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
    if (bad.length) return fail(400, `Not an email address: ${bad.join(', ')}`)
    await settingsFor(workspaceId)
    const [row] = await db(`lead_agent_settings?workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation', body: { alert_emails: list, updated_at: new Date().toISOString() },
    }) || []
    return { settings: row }
  },

  /** Send a test alert now, so you know the email arrives. */
  async test_alert({ workspaceId }) {
    const settings = await settingsFor(workspaceId)
    const to = settings?.alert_emails || []
    if (!to.length) return fail(400, 'Add an alert email first.')
    const out = await sendAlert({
      workspaceId, to,
      subject: '✅ Lead agent: test alert',
      text: 'This is a test. If something in the lead agent stops working, an email like this one says what and how to fix it.',
      html: '<p>This is a test. If something in the lead agent stops working, an email like this one says what and how to fix it.</p>',
    })
    if (!out.ok) return fail(502, `The test alert was not sent: ${out.error?.reason || out.error?.message || out.error}`)
    return { sentFrom: out.from, to }
  },

  /** Run the health check now (and email if something is wrong). */
  async health_check_now({ workspaceId }) {
    const out = await leadDeps().health({ workspaceId, force: true })
    return { issues: (out.issues || []).map((i) => ({ key: i.key, title: i.title })), sent: Boolean(out.sent?.ok), error: out.error || '' }
  },

  async set_enabled({ workspaceId, body }) {
    await settingsFor(workspaceId)
    const [row] = await db(`lead_agent_settings?workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation', body: { enabled: Boolean(body.enabled), updated_at: new Date().toISOString() },
    }) || []
    return { settings: row }
  },

  async rotate_export_key({ workspaceId }) {
    await settingsFor(workspaceId)
    const [row] = await db(`lead_agent_settings?workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation', body: { export_key: crypto.randomUUID(), updated_at: new Date().toISOString() },
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
    const out = await tryIt(leadDeps(), { workspaceId, input: body })
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
      // updated_at moves too, so the master Sheet picks the correction up.
      body: { human_verdict: verdict, reviewed_by: verdict ? user.id : null, reviewed_at: verdict ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
    }) || []
    if (!row) return fail(404, 'That lead is not in this company.')
    return { lead: row }
  },

  /**
   * Start "Connect a mailbox": a Microsoft sign-in asking for READ ONLY.
   * The answer comes back to /api/email/ms-callback (the registered address),
   * which sees `p: 'leads'` in the signed state and hands it to _mail.js.
   */
  async mail_connect_start({ workspaceId, body, user }) {
    const ms = leadDeps().ms
    if (!ms.configured) return fail(503, 'Microsoft sign-in is not switched on for this app yet.')
    const nonce = crypto.randomBytes(16).toString('base64url')
    // other_org: a mailbox on another Microsoft 365 (clb-sa.com). It signs in
    // at the shared "organizations" endpoint instead of our own tenant's.
    const otherOrg = Boolean(body.other_org)
    const state = signState({ ws: workspaceId, uid: user.id, p: 'leads', o: otherOrg ? 1 : 0, n: nonce }, SERVICE_KEY)
    const secure = /^https:/.test(baseUrlOf(this.req)) ? '; Secure' : ''
    // Path /api/email: that is where the callback reads it.
    this.res.setHeader('Set-Cookie', `ms_oauth=${nonce}; Path=/api/email; HttpOnly; SameSite=Lax; Max-Age=900${secure}`)
    const config = otherOrg ? { ...ms, tenant: 'organizations' } : ms
    return { url: authorizeUrl({ config, redirectUri: `${baseUrlOf(this.req)}/api/email/ms-callback`, state, scopes: READ_SCOPES }) }
  },

  /** Read the connected mailboxes now, instead of waiting for the next round. */
  async mail_check_now({ workspaceId }) {
    const out = await checkMail(leadDeps(), { workspaceId, calls: 15, deadline: Date.now() + 120_000 })
    return out
  },

  /** Stop reading a mailbox: its stored sign-in is deleted, its leads stay. */
  async mail_disconnect({ workspaceId, body }) {
    if (!isUuid(body.mailbox_id)) return fail(400, 'mailbox_id is required.')
    const gone = await db(`lead_mailboxes?id=eq.${body.mailbox_id}&workspace_id=eq.${workspaceId}`, { method: 'DELETE', prefer: 'return=representation' }) || []
    if (!gone.length) return fail(404, 'That mailbox is not connected in this company.')
    return { disconnected: gone[0].email }
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
      const out = await intakeWebsite(leadDeps(), { key: body.key, rows: body.rows })
      if (out.error) return res.status(out.status).json({ ok: false, error: out.error })
      return res.status(200).json({ ok: true, off: Boolean(out.off), results: out.results, mail: out.mail || null })
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
    }
  }

  // The master workbook's script: every lead, by its own key, read only.
  if (action === 'export') {
    try {
      const out = await exportLeads(leadDeps(), { key: body.key, cursor: body.cursor })
      if (out.error) return res.status(out.status).json({ ok: false, error: out.error })
      return res.status(200).json({ ok: true, leads: out.leads, next: out.next, more: out.more })
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
    const out = await actions[action].call({ req, res }, { workspaceId, body, user })
    if (out && out.__fail) return res.status(out.status).json({ ok: false, error: out.error })
    return res.status(200).json({ ok: true, ...out })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
  }
}
