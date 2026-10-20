import { db } from '../agent/_supabase.js'
import { sealSecret, openSecret } from '../email/_secrets.js'
import { msConfig, createGraphMail } from '../email/_graph.js'
import { checkMail } from './_mail.js'
import { runHealth } from './_health.js'
import { supabaseStorage } from './_files.js'
import { checkWebsite } from './_website.js'
import { maybePullCards } from './_crmCard.js'

// ─── The lead agent's real IO, in one place ────────────────────────────────
// Used by api/leads/[action].js and, for the two things that must live in
// the Email route (Microsoft's sign-in callback, whose address is the one
// registered in Entra, and the daily cron), by api/email/[action].js.

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
// A deployment-wide key, used when a company has not saved its own.
const ENV_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || ''
// Read-only use: a normal key sees only its own spend limit, never the
// account's balance. Only a management key may ask /credits. It reads the
// account it belongs to, so it assumes every company's key is on that account.
const OPENROUTER_MANAGEMENT_KEY = process.env.OPENROUTER_MANAGEMENT_KEY || ''
const APP_URL = (process.env.PUBLIC_APP_URL || 'https://marketing-main-ten.vercel.app').replace(/\/$/, '')

/** The company's own key if it saved one, else the deployment's. */
export async function openRouterKey(workspaceId) {
  const [row] = await db(`lead_agent_secrets?workspace_id=eq.${workspaceId}&select=openrouter_key`) || []
  if (row?.openrouter_key) {
    try { return openSecret(row.openrouter_key, SERVICE_KEY) } catch { /* sealed with an old service key: fall back */ }
  }
  return ENV_OPENROUTER_KEY
}

export const hasDeploymentKey = Boolean(ENV_OPENROUTER_KEY)

/** The account's credit: bought minus used. Null without a management key or on any failure. */
async function accountCredit() {
  if (!OPENROUTER_MANAGEMENT_KEY) return null
  try {
    const r = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${OPENROUTER_MANAGEMENT_KEY}` } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.data?.total_credits == null) return null
    return Number(j.data.total_credits) - Number(j.data.total_usage || 0)
  } catch { return null }
}

/**
 * What OpenRouter says about a key: valid, its label, credit left. Free.
 * creditLeft is the account's balance when it can be read, else the key's own
 * limit: a key with a $50 limit on a $10 account would otherwise say $50.
 */
export async function describeKey(key) {
  try {
    const [r, credit] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } }),
      accountCredit(),
    ])
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.data) return { valid: false }
    const limitRemaining = j.data.limit_remaining ?? null
    const creditLeft = credit != null && limitRemaining != null ? Math.min(credit, limitRemaining) : (credit ?? limitRemaining)
    return { valid: true, label: j.data.label || '', limitRemaining, creditLeft, usage: j.data.usage ?? null }
  } catch { return { valid: null } } // unreachable: neither good nor bad
}

/** The company's key, as OpenRouter sees it; null when there is none to ask about. */
export async function keyInfo(workspaceId) {
  const key = await openRouterKey(workspaceId)
  return key ? describeKey(key) : { valid: false }
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

/**
 * A health alert, sent through one of the company's connected Microsoft 365
 * mailboxes (the outreach ones, which may send): the alert address's own
 * mailbox if it is connected, else the first. It lands in that mailbox's Sent
 * Items like any email. Renewed tokens are sealed back, as outreach does.
 */
export async function sendAlert({ workspaceId, to, subject, text, html }) {
  const mailboxes = await db(`email_mailboxes?workspace_id=eq.${workspaceId}&provider=eq.microsoft&status=eq.active&select=*&order=created_at`) || []
  const wanted = to.map((a) => String(a).toLowerCase())
  const mb = mailboxes.find((m) => wanted.includes(String(m.email).toLowerCase())) || mailboxes[0]
  if (!mb) return { ok: false, error: new Error('No connected Microsoft 365 mailbox to send the alert from.') }
  const [row] = await db(`email_mailbox_secrets?mailbox_id=eq.${mb.id}&select=secret`) || []
  if (!row) return { ok: false, error: new Error(`${mb.email} has no stored sign-in.`) }
  let plain
  try { plain = openSecret(row.secret, SERVICE_KEY) } catch { return { ok: false, error: new Error(`${mb.email}'s sign-in cannot be read.`) } }
  const graph = createGraphMail({
    config: msConfig(),
    save: (m, p) => db('email_mailbox_secrets?on_conflict=mailbox_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { mailbox_id: m.id, workspace_id: m.workspace_id, secret: sealSecret(p, SERVICE_KEY), updated_at: new Date().toISOString() },
    }),
  })
  const res = await graph.send(mb, plain, {
    from: { name: 'Arak lead agent', address: mb.email },
    to: to.map((address) => ({ name: '', address })),
    subject, text, html,
  })
  return res.ok ? { ok: true, from: mb.email } : { ok: false, error: res.error }
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
    keyInfo,
    sendAlert,
    // Large attachments, a day at a time (_files.js).
    storage: supabaseStorage({ url: SUPABASE_URL, key: SERVICE_KEY }),
  }
  deps.checkMail = (args) => checkMail(deps, args)
  deps.website = (domain) => checkWebsite(deps, domain)
  deps.health = (args) => runHealth(deps, { pageUrl: `${APP_URL}/leads`, ...args })
  // The battle cards read back from Odoo at 07:50 and 13:00 Riyadh (_crmCard.js).
  deps.crmPull = (args) => maybePullCards(deps, args)
  return deps
}
