import crypto from 'node:crypto'
import { db, isConfigured } from '../agent/_supabase.js'
import { sealSecret } from '../email/_secrets.js'
import { signState, authorizeUrl, READ_SCOPES } from '../email/_graph.js'
import { SEND_SCOPES } from './_mail.js'
import { intakeWebsite, tryIt, QUALIFIER_MODEL } from './_intake.js'
import { checkMail, emailFile, currentOutlookLink, emailAttachments, attachmentFile } from './_mail.js'
import { exportLeads, applySheetDecisions } from './_export.js'
import { approveLead, crmStatus, saveCrm, sendWaiting, disconnectCrm } from './_crm.js'
import { openCard, saveCard, watchlist } from './_card.js'
import { assignLead, teamList, teamSave, teamCheckOdoo } from './_assign.js'
import { controlPanel, saveTargets, saveRouting, markLead, remind, accountContacted, sendToSales, runDailyAlerts, MIGRATION_MISSING } from './_control.js'
import { addLead, trackLead, deleteLead } from './_pipeline.js'
import { leadDeps, openRouterKey, hasDeploymentKey, describeKey, sendAlert } from './_deps.js'
import { previewLenses } from '../agent/_investigate.js'

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
//   a sales person      the same, but with a sales seat in that company
//                       instead of membership, and only review, email_file,
//                       approve, assign, forward, outlook_link, set_project
//                       the battle card, adding a lead by hand and moving
//                       its stage (SALES_ACTIONS), and only on a
//                       lead they can see (their own, since 2026-10-13: the
//                       database's can_see_lead answers). approve, assign and
//                       forward also ask whether they are a sales admin.
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

// A sales person (20261013_sales_seats) is not a member of the company at
// all: their seat is asked for separately, again with their own token. A
// seat opens these actions and nothing else.
const SALES_ACTIONS = new Set(['review', 'email_file', 'approve', 'assign', 'forward', 'outlook_link', 'set_project', 'card', 'card_save', 'lead_add', 'stage', 'attachments', 'attachment_file', 'lead_delete', 'lead_mark'])

/**
 * May this sales person open this lead? Asked with their own token, so the
 * leads policy (can_see_lead: their own leads, all for a sales admin, the
 * website's too for a seat that has them) answers.
 */
async function canSeeLead(workspaceId, leadId, token) {
  if (!isUuid(workspaceId) || !isUuid(leadId)) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=id`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    const rows = r.ok ? await r.json() : []
    return Array.isArray(rows) && rows.length === 1
  } catch { return false }
}

async function isSalesMember(workspaceId, token) {
  if (!isUuid(workspaceId)) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_sales_member`, {
      method: 'POST',
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ws_id: workspaceId }),
    })
    return r.ok && (await r.json()) === true
  } catch { return false }
}

/**
 * May this caller approve leads into the CRM here? The access admin, or a
 * sales admin with a seat in this company. Asked with the caller's token.
 */
async function canApprove(workspaceId, token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_approve_leads`, {
      method: 'POST',
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ws_id: workspaceId }),
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
    // Mail.Send since 2026-10-13: a mailbox there may be allowed to forward
    // leads to the salesperson they are assigned to.
    scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read openid profile email offline_access',
    redirect_uri: `${base}/api/email/ms-callback`,
    state: 'leads-consent',
  })
  return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${q}`
}

const MAILBOX_COLUMNS = 'id,email,label,tenant,can_send,warmup_tag,display_name,status,read_from,last_checked_at,last_error,last_counts,history_from,history_until,history_cursor,history_done,created_at'
const fail = (status, error) => ({ __fail: true, status, error })

// ─── Admin actions ─────────────────────────────────────────────────────────

const actions = {
  /**
   * The lead's original email as an .eml file, to open in the Outlook app
   * with its attachments. Written straight to the response (not JSON).
   */
  async email_file({ workspaceId, body }) {
    if (!isUuid(body.lead_id)) return fail(400, 'Which lead?')
    const out = await emailFile(leadDeps(), { workspaceId, leadId: body.lead_id })
    if (out.error) return fail(out.status, out.error)
    const res = this.res
    res.setHeader('Content-Type', 'message/rfc822')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(out.bytes)
    return { __sent: true }
  },

  /** The email's attachments (BOQ, drawings, RFQ templates), listed from its mailbox. */
  async attachments({ workspaceId, body }) {
    if (!isUuid(body.lead_id)) return fail(400, 'Which lead?')
    const out = await emailAttachments(leadDeps(), { workspaceId, leadId: body.lead_id })
    if (out.error) return fail(out.status, out.error)
    return { attachments: out.attachments }
  },

  /** One attachment from the mailbox: the file itself, or a private link to it when it is large. */
  async attachment_file({ workspaceId, body }) {
    if (!isUuid(body.lead_id)) return fail(400, 'Which lead?')
    const out = await attachmentFile(leadDeps(), { workspaceId, leadId: body.lead_id, attachmentId: body.attachment_id })
    if (out.error) return fail(out.status, out.error)
    // Too big for Vercel's 4.5 MB answer: a ten-minute private link instead.
    if (out.url) return { url: out.url, filename: out.filename }
    const res = this.res
    res.setHeader('Content-Type', out.contentType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.status(200).send(out.bytes)
    return { __sent: true }
  },

  /**
   * "Open in Outlook": the email's link as it is now, in its own mailbox.
   * Worked out at the click, because Exchange changes an email's id when it
   * moves folder, and a stored link then opens "moved or deleted".
   */
  async outlook_link({ workspaceId, body }) {
    if (!isUuid(body.lead_id)) return fail(400, 'Which lead?')
    const out = await currentOutlookLink(leadDeps(), { workspaceId, leadId: body.lead_id })
    if (out.error) return fail(out.status, out.error)
    return { url: out.url }
  },

  /**
   * The team's project phase (2026-10-12): JIH / Tender / Maintenance, or
   * 'none' (no phase), or null to follow the agent again. Anyone on the leads
   * team may set it, stated in the email or not; it wins everywhere
   * (project_final), and updated_at moves so the workbook takes it.
   */
  async set_project({ workspaceId, body, user }) {
    if (!isUuid(body.lead_id)) return fail(400, 'Which lead?')
    const project = body.project === null || body.project === '' ? null : String(body.project)
    if (project !== null && !['jih', 'tender', 'maintenance', 'none'].includes(project)) return fail(400, 'Unknown project phase.')
    const now = new Date().toISOString()
    const [row] = await db(`leads?id=eq.${body.lead_id}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { human_project_type: project, project_set_by: project ? user.id : null, project_set_at: project ? now : null, updated_at: now },
    }) || []
    if (!row) return fail(404, 'That lead is not in this company.')
    return { lead: row }
  },

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
      crm: await crmStatus(leadDeps(), workspaceId),
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
    // Why the agent was wrong, in a person's words (optional): the weekly
    // review turns these into rules. Cleared with the verdict.
    const reason = verdict ? String(body.reason || '').trim().slice(0, 500) : ''
    const [row] = await db(`leads?id=eq.${body.lead_id}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation',
      // updated_at moves too, so the master Sheet picks the correction up.
      body: { human_verdict: verdict, human_reason: reason, reviewed_by: verdict ? user.id : null, reviewed_at: verdict ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
    }) || []
    if (!row) return fail(404, 'That lead is not in this company.')
    return { lead: row }
  },

  /**
   * Approve a lead into the CRM (Odoo): the access admin or a sales admin,
   * after confirming on the page. Sent now when Odoo is connected, otherwise
   * kept waiting until it is. See _crm.js.
   */
  async approve({ workspaceId, body, user, token }) {
    if (!(await canApprove(workspaceId, token))) return fail(403, 'Only a sales admin can approve leads into the CRM.')
    const deps = leadDeps()
    // Chosen in the confirmation when no one had it yet (or someone else):
    // assigned first, which forwards the email, then approved.
    let forward = null
    if (isUuid(body.assign_to)) {
      const [cur] = await db(`leads?id=eq.${body.lead_id}&workspace_id=eq.${workspaceId}&select=assigned_to`) || []
      if (cur && cur.assigned_to !== body.assign_to) {
        const a = await assignLead(deps, { workspaceId, leadId: body.lead_id, to: body.assign_to, user, appUrl: baseUrlOf(this.req) })
        if (a.error) return fail(a.status, a.error)
        forward = a.forward
      }
    }
    const out = await approveLead(deps, { workspaceId, leadId: body.lead_id, user })
    if (out.error) return fail(out.status, out.error)
    // Every approved lead gets its battle card. Built now so it is waiting;
    // if this fails, opening the card builds it.
    await openCard(deps, { workspaceId, leadId: body.lead_id }).catch(() => null)
    return { lead: out.lead, crm: out.crm, forward }
  },

  /**
   * Give a lead to a salesperson (or, before approval, to no one: user_id
   * null). Their email gets the customer's email at once. A sales admin or
   * the access admin only. See _assign.js.
   */
  async assign({ workspaceId, body, user, token }) {
    if (!(await canApprove(workspaceId, token))) return fail(403, 'Only a sales admin can assign leads.')
    const out = await assignLead(leadDeps(), { workspaceId, leadId: body.lead_id, to: body.user_id || null, user, appUrl: baseUrlOf(this.req) })
    if (out.error) return fail(out.status, out.error)
    return { lead: out.lead, forward: out.forward, odooError: out.odooError }
  },

  /** Send the email to the person it is assigned to again (after a failed forward). */
  async forward({ workspaceId, body, user, token }) {
    if (!(await canApprove(workspaceId, token))) return fail(403, 'Only a sales admin can forward leads.')
    if (!isUuid(body.lead_id)) return fail(400, 'Which lead?')
    const [cur] = await db(`leads?id=eq.${body.lead_id}&workspace_id=eq.${workspaceId}&select=assigned_to`) || []
    if (!cur) return fail(404, 'That lead is not in this company.')
    if (!cur.assigned_to) return fail(400, 'Assign it to someone first.')
    const out = await assignLead(leadDeps(), { workspaceId, leadId: body.lead_id, to: cur.assigned_to, user, appUrl: baseUrlOf(this.req) })
    if (out.error) return fail(out.status, out.error)
    return { lead: out.lead, forward: out.forward }
  },

  // ── The CEO's control panel (_control.js; needs 20261025_ceo_control) ──

  /** Six numbers, at most three decisions, one row per salesperson, the top ten customers. */
  async control({ workspaceId }) {
    try {
      return await controlPanel(leadDeps(), { workspaceId })
    } catch (err) {
      if (String(err.message) === MIGRATION_MISSING) return fail(503, MIGRATION_MISSING)
      throw err
    }
  },

  /** His targets, who gets the Sunday summary and the daily alert, routing on or off. */
  async targets_save({ workspaceId, body, user }) {
    const out = await saveTargets(leadDeps(), { workspaceId, body, user })
    return out.error ? fail(out.status, out.error) : out
  },

  /** The routing rules, replaced whole in the order given. */
  async routing_save({ workspaceId, body }) {
    const out = await saveRouting(leadDeps(), { workspaceId, body })
    return out.error ? fail(out.status, out.error) : out
  },

  /** A salesperson marks a first reply or a quote sent, until Odoo says it for them. */
  async lead_mark({ workspaceId, body }) {
    const out = await markLead(leadDeps(), { workspaceId, body })
    return out.error ? fail(out.status, out.error) : out
  },

  /** The CEO's "Remind" on a late lead: the owner's bell. */
  async remind({ workspaceId, body, user }) {
    const out = await remind(leadDeps(), { workspaceId, body, user })
    return out.error ? fail(out.status, out.error) : out
  },

  /** "We spoke to them today" on a key account. */
  async account_contacted({ workspaceId, body }) {
    const out = await accountContacted(leadDeps(), { workspaceId, body })
    return out.error ? fail(out.status, out.error) : out
  },

  /** A research project handed to a salesperson. */
  async send_to_sales({ workspaceId, body, user }) {
    const out = await sendToSales(leadDeps(), { workspaceId, body, user })
    return out.error ? fail(out.status, out.error) : out
  },

  /** The daily alert now, for testing the email (it is otherwise once a day). */
  async alerts_now({ workspaceId }) {
    return runDailyAlerts(leadDeps(), { workspaceId, force: true, pageUrl: `${baseUrlOf(this.req)}/ceo` })
  },

  /** The sales team on Agent settings: who sees the website's leads, who they are in Odoo. */
  async team({ workspaceId }) {
    return { team: await teamList(leadDeps(), workspaceId) }
  },

  async team_save({ workspaceId, body }) {
    const out = await teamSave(leadDeps(), workspaceId, body)
    if (out.error) return fail(out.status, out.error)
    return out
  },

  /** Look every salesperson up in Odoo now. */
  async team_odoo({ workspaceId }) {
    const out = await teamCheckOdoo(leadDeps(), workspaceId)
    if (out.error) return fail(out.status, out.error)
    return out
  },

  /** An approved lead's battle card, built the first time it is opened. */
  async card({ workspaceId, body }) {
    const deps = leadDeps()
    const out = await openCard(deps, { workspaceId, leadId: body.lead_id })
    if (out.error) return fail(out.status, out.error)
    return { card: out.card, watchlist: await watchlist(deps, workspaceId) }
  },

  /** The team's edits to a card, the things recorded after the call, and the next step. */
  async card_save({ workspaceId, body, user }) {
    const out = await saveCard(leadDeps(), { workspaceId, leadId: body.lead_id, user, body })
    if (out.error) return fail(out.status, out.error)
    return { card: out.card, lead: out.lead }
  },

  /**
   * A lead added by hand (2026-10-18): a call, WhatsApp, a walk-in… It joins
   * the Pipeline with its battle card. A salesperson's is their own; a sales
   * admin or the access admin may give it to someone (assign_to).
   */
  async lead_add({ workspaceId, body, user, token }) {
    const canAssign = await canApprove(workspaceId, token)
    const out = await addLead(leadDeps(), { workspaceId, user, body, canAssign })
    if (out.error) return fail(out.status, out.error)
    return { lead: out.lead, card: out.card }
  },

  /**
   * Delete a lead, after the page's confirmation: a sales admin or the access
   * admin any lead; a salesperson only one they added themselves.
   */
  async lead_delete({ workspaceId, body, user, token }) {
    const out = await deleteLead(leadDeps(), { workspaceId, leadId: body.lead_id, user, canAll: await canApprove(workspaceId, token) })
    if (out.error) return fail(out.status, out.error)
    return { deleted: out.deleted, inOdoo: out.inOdoo }
  },

  /** Move a lead along the Pipeline, or set its next step and follow-up date. */
  async stage({ workspaceId, body, user }) {
    const out = await trackLead(leadDeps(), { workspaceId, leadId: body.lead_id, user, body })
    if (out.error) return fail(out.status, out.error)
    return { lead: out.lead }
  },

  /** Save the Odoo connection and test it (read only); a working one sends the waiting leads. */
  async crm_save({ workspaceId, body }) {
    const deps = leadDeps()
    const out = await saveCrm(deps, workspaceId, body)
    if (out.error) return fail(out.status, out.error)
    const sent = out.crm.connected && (out.crm.queued || out.crm.failed) ? await sendWaiting(deps, workspaceId) : null
    return { crm: sent ? await crmStatus(deps, workspaceId) : out.crm, test: out.test, sent }
  },

  /** Send the approved leads still waiting (or failed before). */
  async crm_send({ workspaceId }) {
    const deps = leadDeps()
    const out = await sendWaiting(deps, workspaceId)
    if (out.error) return fail(409, out.error)
    return { sent: out, crm: await crmStatus(deps, workspaceId) }
  },

  /** Forget the Odoo connection. Leads already sent keep their Odoo links. */
  async crm_disconnect({ workspaceId }) {
    return { crm: await disconnectCrm(leadDeps(), workspaceId) }
  },

  /**
   * Start "Connect a mailbox": a Microsoft sign-in asking for READ ONLY, or
   * (body.send, "Allow forwarding") read plus Mail.Send, to forward leads.
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
    const send = Boolean(body.send)
    const state = signState({ ws: workspaceId, uid: user.id, p: 'leads', o: otherOrg ? 1 : 0, s: send ? 1 : 0, n: nonce }, SERVICE_KEY)
    const secure = /^https:/.test(baseUrlOf(this.req)) ? '; Secure' : ''
    // Path /api/email: that is where the callback reads it.
    this.res.setHeader('Set-Cookie', `ms_oauth=${nonce}; Path=/api/email; HttpOnly; SameSite=Lax; Max-Age=900${secure}`)
    const config = otherOrg ? { ...ms, tenant: 'organizations' } : ms
    const loginHint = String(body.login_hint || '').trim().slice(0, 200)
    return { url: authorizeUrl({ config, redirectUri: `${baseUrlOf(this.req)}/api/email/ms-callback`, state, loginHint, scopes: send ? SEND_SCOPES : READ_SCOPES }) }
  },

  /** Read the connected mailboxes now, instead of waiting for the next round. */
  async mail_check_now({ workspaceId }) {
    const out = await checkMail(leadDeps(), { workspaceId, calls: 15, deadline: Date.now() + 120_000 })
    return out
  },

  /**
   * The warm-up service's tag for a mailbox it also warms up (Instantly shows
   * it per mailbox). Emails carrying it are skipped before any model call.
   */
  async mail_set_warmup_tag({ workspaceId, body }) {
    if (!isUuid(body.mailbox_id)) return fail(400, 'mailbox_id is required.')
    const tag = String(body.warmup_tag || '').trim().slice(0, 100)
    if (tag && tag.length < 4) return fail(400, 'The warm-up tag is at least 4 characters. Copy it from the warm-up service.')
    const saved = await db(`lead_mailboxes?id=eq.${body.mailbox_id}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation', body: { warmup_tag: tag, updated_at: new Date().toISOString() },
    }) || []
    if (!saved.length) return fail(404, 'That mailbox is not connected in this company.')
    return { mailbox_id: body.mailbox_id, warmup_tag: tag }
  },

  /**
   * The Agent Brief page: exactly what every research lens would be asked on
   * the next run, plus the ICPs it works from. Read only, no model call. It
   * lives here only because this is the admin-checked function and the plan
   * allows no thirteenth.
   */
  async lens_preview({ workspaceId }) {
    return previewLenses(workspaceId)
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

  // The workbook's Decision column: the team settles leads from the Sheet.
  if (action === 'sheet_decisions') {
    try {
      const out = await applySheetDecisions(leadDeps(), { key: body.key, decisions: body.decisions })
      if (out.error) return res.status(out.status).json({ ok: false, error: out.error })
      return res.status(200).json({ ok: true, applied: out.applied })
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
  if (!member || !admin) {
    // Not the admin in this company: a sales seat may still correct a
    // verdict or fetch an email, and do nothing else.
    const sales = SALES_ACTIONS.has(action) && await isSalesMember(workspaceId, token)
    if (!sales) return res.status(403).json({ ok: false, error: member ? 'The lead agent is for the admin only.' : 'You do not have access to that workspace.' })
    // And only on a lead they can see: their own, unless they see them all.
    if (body.lead_id !== undefined && !(await canSeeLead(workspaceId, body.lead_id, token))) {
      return res.status(404).json({ ok: false, error: 'That lead is not one of yours.' })
    }
  }

  try {
    const out = await actions[action].call({ req, res }, { workspaceId, body, user, token })
    if (out && out.__fail) return res.status(out.status).json({ ok: false, error: out.error })
    if (out && out.__sent) return undefined
    return res.status(200).json({ ok: true, ...out })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
  }
}
