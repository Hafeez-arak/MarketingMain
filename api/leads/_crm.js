// ─── Approve a lead into the CRM ───────────────────────────────────────────
// The owner's plan (2026-10-12): an Approve button beside every lead; a
// sales admin (or the access admin) confirms, and the lead goes to Odoo.
// Odoo's API key comes later, so until the company's Odoo is connected an
// approved lead waits as 'queued', and connecting sends every waiting one.
//
// A lead goes to Odoo once. Two guards: the database claim below (only one
// request can move a lead to 'sending'), and createLead looking for our
// reference in Odoo first, for a push that died after Odoo had saved it.
//
// Since 2026-10-13 every lead goes in with its salesperson (user_id): under
// Odoo's "Own Documents Only" an unassigned lead is visible to every
// salesperson, so a lead with no one assigned is not sent at all.

import {
  SENDER_LABEL, PROJECT_LABEL, REQUEST_LABEL, FOLDER_LABEL, PHILIPS_LABEL,
  channelLabel, phonesOf, effectiveVerdict, projectOf,
} from '../../src/lib/leads/view.js'
import { riyadhTime } from './_export.js'
import { normalizeUrl, defaultDb, discoverDb, testConnection, createLead, findUserId, customerHistory } from './_odoo.js'
import { pushCard } from './_crmCard.js'
import { openCard } from './_card.js'
import { briefHtml } from '../../src/lib/sales/odooCard.js'
import { matchAccount } from '../../src/lib/sales/leadCard.js'

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const para = (label, value) => (value ? `<p><b>${esc(label)}:</b> ${esc(value)}</p>` : '')

/** A sending that has not finished in this long is taken to have died, and may be retried. */
export const STUCK_MS = 5 * 60_000

/**
 * One of our leads → the values of an Odoo crm.lead. The criteria, the
 * message and the agent's questions go in the description, which also
 * carries our reference so the same lead is never created twice.
 */
export function odooLeadValues(lead, { approvedBy = '', card = null, history = null, now = new Date() } = {}) {
  const phones = phonesOf(lead)
  const v2 = (lead.criteria_version || 1) >= 2
  const what = lead.summary || lead.subject || 'Enquiry'
  const who = lead.company || lead.name || lead.email || ''
  const asks = Array.isArray(lead.ask_next) ? lead.ask_next : []
  const message = [lead.subject && lead.source === 'email' ? lead.subject : '', lead.message].filter(Boolean).join('\n\n').slice(0, 8000)
  // With its battle card (2026-10-20): Internal Notes open on the short brief
  // to read before the call, then their own words. The criteria are in the
  // brief already, so they are not repeated.
  const description = card ? [
    briefHtml(card, lead, history, now),
    para('Came in', [channelLabel(lead), lead.mailbox, lead.source === 'email' && lead.folder ? FOLDER_LABEL[lead.folder] || lead.folder : '', riyadhTime(lead.received_at || lead.created_at)].filter(Boolean).join(' · ')),
    phones.length ? para(phones.length > 1 ? 'Numbers' : 'Number', phones.join(', ')) : '',
    message ? `<p><b>Their message:</b></p><blockquote>${esc(message).replace(/\n/g, '<br>')}</blockquote>` : '',
    para('Approved by', approvedBy),
    `<p>Lead Agent ref: ${esc(lead.id)}</p>`,
  ].filter(Boolean).join('') : [
    '<p><b>From the Lead Agent</b></p>',
    para('Came in', [channelLabel(lead), lead.mailbox, lead.source === 'email' && lead.folder ? FOLDER_LABEL[lead.folder] || lead.folder : ''].filter(Boolean).join(' · ')),
    para('Received', riyadhTime(lead.received_at || lead.created_at)),
    v2 ? para('Who', SENDER_LABEL[lead.sender_type] || lead.sender_type) : '',
    v2 && lead.source_check ? para('Source', lead.source_check === 'verified' ? 'Verified' : 'Not verified') : '',
    v2 ? para('Request', REQUEST_LABEL[lead.request_type] || lead.request_type) : '',
    v2 || lead.human_project_type ? para('Project', PROJECT_LABEL[projectOf(lead)] || projectOf(lead)) : '',
    para('Philips', PHILIPS_LABEL[lead.philips]),
    para('Email', lead.email_kind === 'free' ? 'Free email (Gmail, Outlook…)' : lead.email_kind === 'company' ? 'Company domain' : ''),
    phones.length > 1 ? para('All numbers', phones.join(', ')) : '',
    para('Summary', lead.summary),
    message ? `<p><b>Their message:</b></p><blockquote>${esc(message).replace(/\n/g, '<br>')}</blockquote>` : '',
    asks.length ? `<p><b>Ask on the first call:</b></p><ul>${asks.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '',
    para('Approved by', approvedBy),
    `<p>Lead Agent ref: ${esc(lead.id)}</p>`,
  ].filter(Boolean).join('')
  const tags = ['Lead Agent', channelLabel(lead), PROJECT_LABEL[projectOf(lead)]].filter(Boolean)
  return {
    name: (who && !what.includes(who) ? `${what} (${who})` : what).slice(0, 200),
    contact_name: lead.name || '',
    partner_name: lead.company || '',
    email_from: lead.email || '',
    phone: phones[0] || '',
    description,
    tags,
  }
}

// ─── The connection ────────────────────────────────────────────────────────

/** The company's Odoo row, with the API key opened. null when there is none. */
export async function crmConnection(deps, workspaceId) {
  const [row] = await deps.db(`lead_crm?workspace_id=eq.${workspaceId}&select=*`) || []
  if (!row) return null
  let apiKey
  try { apiKey = row.api_key ? deps.open(row.api_key) : '' } catch { apiKey = '' }
  return { ...row, apiKey, ready: Boolean(row.url && row.db && row.login && apiKey && row.odoo_uid) }
}

/** What the admin page shows: never the key. */
export async function crmStatus(deps, workspaceId) {
  const conn = await crmConnection(deps, workspaceId)
  const [waiting, unsynced, sent] = await Promise.all([
    deps.db(`leads?workspace_id=eq.${workspaceId}&crm_status=in.(queued,failed)&select=crm_status`).then((r) => r || []),
    deps.db(`lead_cards?workspace_id=eq.${workspaceId}&crm_sync_error=neq.&select=lead_id`).then((r) => r || []).catch(() => []),
    deps.db(`leads?workspace_id=eq.${workspaceId}&crm_status=eq.sent&crm_id=neq.&crm_test=eq.false&select=id`).then((r) => r || []).catch(() => []),
  ])
  return {
    // The battle card in Odoo (2026-10-20): the team our leads go into, and
    // the twice-daily read back.
    teamId: conn?.team_id || null,
    teamName: conn?.team_name || '',
    lastPullAt: conn?.last_pull_at || null,
    lastPullError: conn?.last_pull_error || '',
    lastPullCounts: conn?.last_pull_counts || null,
    cardsNotSynced: unsynced.length,
    // Deals already in Odoo (tests aside): a team change can move them along.
    sentCount: sent.length,
    connected: Boolean(conn?.ready),
    url: conn?.url || '',
    db: conn?.db || '',
    login: conn?.login || '',
    hasKey: Boolean(conn?.api_key),
    version: conn?.server_version || '',
    lastCheckedAt: conn?.last_checked_at || null,
    lastError: conn?.last_error || '',
    queued: waiting.filter((l) => l.crm_status === 'queued').length,
    failed: waiting.filter((l) => l.crm_status === 'failed').length,
  }
}

/**
 * Save the admin's Odoo details and test them at once (read only). A blank
 * api_key keeps the saved one. Returns the status, with the test's error if
 * it failed; the details are saved either way so they can be fixed.
 */
export async function saveCrm(deps, workspaceId, body = {}) {
  const url = normalizeUrl(body.url)
  if (!url) return { status: 400, error: 'That is not an Odoo address. It looks like https://your-company.odoo.com.' }
  // Asked of Odoo itself: on Odoo Online the name is not the subdomain.
  const dbName = String(body.db || '').trim() || await discoverDb(deps.fetch, url) || defaultDb(url)
  if (!dbName) return { status: 400, error: 'Which database? On Odoo Online it is the first part of the address.' }
  const login = String(body.login || '').trim()
  if (!login) return { status: 400, error: 'The Odoo login (the user\'s email) is required.' }
  const prev = await crmConnection(deps, workspaceId)
  const apiKey = String(body.api_key || '').trim() || prev?.apiKey || ''
  if (!apiKey) return { status: 400, error: 'Paste the API key from Odoo (Preferences → Account Security → New API Key).' }

  const test = await testConnection(deps.fetch, { url, db: dbName, login, apiKey })
  const okToCreate = test.ok && test.canCreate
  await deps.db('lead_crm?on_conflict=workspace_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      workspace_id: workspaceId, url, db: dbName, login, api_key: deps.seal(apiKey),
      odoo_uid: okToCreate ? test.uid : null,
      server_version: test.version || '',
      last_checked_at: deps.now().toISOString(),
      last_error: test.ok ? (test.canCreate ? '' : 'This Odoo user may not create CRM leads. Give it the Sales / CRM user right.') : test.error,
      updated_at: deps.now().toISOString(),
    },
  })
  return { status: 200, crm: await crmStatus(deps, workspaceId), test }
}

export async function disconnectCrm(deps, workspaceId) {
  await deps.db(`lead_crm?workspace_id=eq.${workspaceId}`, { method: 'DELETE', prefer: 'return=minimal' })
  return crmStatus(deps, workspaceId)
}

// ─── The salesperson in Odoo ───────────────────────────────────────────────

export const odooCfg = (conn) => ({ url: conn.url, db: conn.db, login: conn.login, apiKey: conn.apiKey })

/** "Ammar Ahmed (ammar@…)" or the email, for messages. */
const nameOf = (u) => (u?.full_name ? `${u.full_name} (${u.email})` : u?.email || 'That person')

/**
 * The Odoo user id of the salesperson a lead is assigned to. Found in Odoo
 * by their login (their email here, or the Odoo login set on their seat) and
 * kept on the seat, so Odoo is asked once per person. Throws, in words the
 * admin can act on, when there is no one or Odoo has no such user.
 */
export async function odooOwner(deps, conn, workspaceId, userId) {
  if (!isUuid(userId)) throw new Error('No one is assigned to this lead. Assign it to a salesperson first.')
  const [[seat], [person]] = await Promise.all([
    deps.db(`sales_seats?user_id=eq.${userId}&workspace_id=eq.${workspaceId}&select=odoo_login,odoo_user_id`).then((r) => r || []),
    deps.db(`user_access?user_id=eq.${userId}&select=email,full_name`).then((r) => r || []),
  ])
  if (!seat) throw new Error(`${nameOf(person)} is no longer on this company's sales team. Assign the lead to someone else.`)
  if (seat.odoo_user_id) return seat.odoo_user_id
  const login = seat.odoo_login || person?.email || ''
  const id = await findUserId(deps.fetch, odooCfg(conn), login)
  if (!id) throw new Error(`${nameOf(person)} has no user in Odoo with the login ${login}. Add them in Odoo, or set their Odoo login under Sales team.`)
  await deps.db(`sales_seats?user_id=eq.${userId}&workspace_id=eq.${workspaceId}`, { method: 'PATCH', prefer: 'return=minimal', body: { odoo_user_id: id } })
  return id
}

/**
 * What Odoo knows about the lead's company: matched by their email domain
 * (never ours, never a free address's domain), by Odoo's own name for them
 * when our client list knows their domain, or by company name.
 */
export async function leadHistory(deps, conn, lead) {
  const ws = lead.workspace_id || conn.workspace_id
  const [boxes, clients] = await Promise.all([
    deps.db(`lead_mailboxes?workspace_id=eq.${ws}&select=email,label`).catch(() => []),
    deps.db(`sales_accounts?workspace_id=eq.${ws}&domains=neq.%7B%7D&select=name,odoo_name,domains`).catch(() => []),
  ])
  const ownDomains = [...new Set((boxes || []).flatMap((b) => [b.email, b.label]).map((e) => String(e || '').split('@')[1]).filter(Boolean))]
  const client = matchAccount(lead, clients || [])
  const odooName = client?.matchedBy === 'domain' ? client.odoo_name || '' : ''
  return customerHistory(deps.fetch, odooCfg(conn), { email: lead.email || '', company: lead.company || '', odooName, freeEmail: lead.email_kind === 'free', ownDomains })
}

// ─── Approving and sending ─────────────────────────────────────────────────

const LEAD_SELECT = 'id,source,received_at,created_at,name,company,email,phone,phones,subject,message,summary,ask_next,verdict,human_verdict,mailbox,folder,sender_type,source_check,project_type,request_type,philips,email_kind,criteria_version,human_project_type,project_final,approved_at,approved_by,assigned_to,stage,channel,crm_test,crm_status,crm_id,crm_url,crm_error,crm_sent_at,updated_at'

/** Claim a lead for sending: only one request can, and only from these states. */
function claimable(now) {
  const stuck = new Date(now.getTime() - STUCK_MS).toISOString()
  return `or=(crm_status.is.null,crm_status.eq.queued,crm_status.eq.failed,and(crm_status.eq.sending,updated_at.lt.${stuck}))`
}

/** "Layla (layla@arak-sa.com)" for the person who approved, from user_access. */
async function approverName(deps, userId) {
  if (!isUuid(userId)) return ''
  const [u] = await deps.db(`user_access?user_id=eq.${userId}&select=email,full_name`) || []
  return u ? (u.full_name ? `${u.full_name} (${u.email})` : u.email) : ''
}

/**
 * Claim the lead and send it. `marks` (the approval) are written in the same
 * claim: written first on their own, they would move updated_at and make a
 * send that died look alive, so it could never be retried.
 */
async function pushOne(deps, conn, lead, marks = {}) {
  const now = deps.now()
  const [claimed] = await deps.db(`leads?id=eq.${lead.id}&workspace_id=eq.${lead.workspace_id || conn.workspace_id}&${claimable(now)}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { ...marks, crm_status: 'sending', crm_error: '', updated_at: now.toISOString() },
  }) || []
  if (!claimed) return null // someone else is sending it, or it is already in Odoo
  try {
    const by = await approverName(deps, claimed.approved_by)
    // A test push (the access admin's "Test only") belongs to the Odoo
    // connection's own user: no salesperson of ours sees it or is told.
    const owner = claimed.crm_test ? conn.odoo_uid : await odooOwner(deps, conn, claimed.workspace_id || lead.workspace_id || conn.workspace_id, claimed.assigned_to)
    // Into the team chosen on Agent settings (its leads carry the battle-card
    // fields); with none chosen, Odoo picks as before.
    // Its battle card (made when it was assigned) opens its Internal Notes.
    // Its battle card opens its Internal Notes; made now if it has none yet
    // (a lead approved before anyone was assigned to it).
    let [cardRow] = conn.team_id ? await deps.db(`lead_cards?lead_id=eq.${lead.id}&select=card`).catch(() => []) || [] : []
    if (conn.team_id && !cardRow) {
      await openCard(deps, { workspaceId: claimed.workspace_id || lead.workspace_id || conn.workspace_id, leadId: lead.id }).catch(() => null)
      ;[cardRow] = await deps.db(`lead_cards?lead_id=eq.${lead.id}&select=card`).catch(() => []) || []
    }
    // Their history with us, read from Odoo, for "who they are" on the card.
    // Unreadable is not a reason to hold the lead back.
    const history = cardRow ? await leadHistory(deps, conn, { ...lead, ...claimed }).catch(() => null) : null
    const values = { ...odooLeadValues({ ...lead, ...claimed }, { approvedBy: by, card: cardRow?.card || null, history, now: deps.now() }), user_id: owner, ...(conn.team_id ? { team_id: conn.team_id } : {}) }
    const out = await createLead(deps.fetch, odooCfg(conn), values, lead.id, { pipeline: true, phase: projectOf({ ...lead, ...claimed }) })
    const [row] = await deps.db(`leads?id=eq.${lead.id}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { crm_status: 'sent', crm_id: String(out.id), crm_url: out.url, crm_error: '', crm_sent_at: deps.now().toISOString(), updated_at: deps.now().toISOString() },
    }) || []
    // The whole battle card as fields on it, and a note in its history. A
    // failure here is kept on the card and retried; the lead is in Odoo.
    if (conn.team_id) await pushCard(deps, { conn, workspaceId: claimed.workspace_id || lead.workspace_id || conn.workspace_id, leadId: lead.id, title: `From the Arak leads platform${by ? `, approved by ${by}` : ''}. The brief to read before the call is in Internal Notes.` })
    return row
  } catch (err) {
    const [row] = await deps.db(`leads?id=eq.${lead.id}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { crm_status: 'failed', crm_error: String(err.message || err).slice(0, 400), updated_at: deps.now().toISOString() },
    }) || []
    return row
  }
}

/**
 * A person approves a lead: it becomes qualified (their verdict), is marked
 * approved, and goes to Odoo now if Odoo is connected, or waits as queued.
 * Approving one that is already in Odoo changes nothing.
 * Returns { lead, crm: 'sent' | 'queued' | 'failed' | 'already' } or { status, error }.
 */
export async function approveLead(deps, { workspaceId, leadId, user, test = false }) {
  if (!isUuid(leadId)) return { status: 400, error: 'Which lead?' }
  const [lead] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${LEAD_SELECT}`) || []
  if (!lead) return { status: 404, error: 'That lead is not in this company.' }
  if (lead.crm_status === 'sent') return { lead, crm: 'already' }
  // "Test only" (the access admin, 2026-10-20): no one of ours is needed,
  // and it is not worth waiting for Odoo.
  if (test && lead.assigned_to) return { status: 409, error: 'This lead is assigned to someone. A test uses a lead no one has yet.' }
  if (!test && !lead.assigned_to) return { status: 400, error: 'Assign this lead to a salesperson before approving it.' }

  const now = deps.now().toISOString()
  const marks = { updated_at: now }
  if (!lead.approved_at) Object.assign(marks, { approved_at: now, approved_by: user.id })
  // Approved leads gather in the Pipeline (2026-10-18), starting at New.
  if (!lead.stage) Object.assign(marks, { stage: 'new', stage_at: now, stage_by: user.id })
  if (effectiveVerdict(lead) !== 'qualified') Object.assign(marks, { human_verdict: 'qualified', reviewed_by: user.id, reviewed_at: now })
  if (test) marks.crm_test = true
  const conn = await crmConnection(deps, workspaceId)
  if (test && !conn?.ready) return { status: 409, error: 'Connect Odoo first: a test goes there straight away.' }
  if (!conn?.ready) {
    marks.crm_status = 'queued'
    const [row] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&${claimable(deps.now())}`, { method: 'PATCH', prefer: 'return=representation', body: marks }) || []
    return { lead: row || lead, crm: row ? 'queued' : 'already' }
  }
  const sent = await pushOne(deps, conn, { ...lead, workspace_id: workspaceId }, marks)
  return { lead: sent || lead, crm: sent ? sent.crm_status : 'already' }
}

/**
 * Send every approved lead still waiting (queued, or failed before), oldest
 * approval first. Run when Odoo is connected, and by the admin's "Send".
 * Returns { sent, failed, left }.
 */
export async function sendWaiting(deps, workspaceId, { limit = 20 } = {}) {
  const conn = await crmConnection(deps, workspaceId)
  if (!conn?.ready) return { sent: 0, failed: 0, left: 0, error: 'Odoo is not connected.' }
  const waiting = await deps.db(`leads?workspace_id=eq.${workspaceId}&crm_status=in.(queued,failed)&select=${LEAD_SELECT}&order=approved_at.asc.nullslast&limit=${limit + 1}`) || []
  let sent = 0
  let failed = 0
  for (const lead of waiting.slice(0, limit)) {
    const row = await pushOne(deps, conn, { ...lead, workspace_id: workspaceId })
    if (row?.crm_status === 'sent') sent++
    else if (row?.crm_status === 'failed') failed++
  }
  return { sent, failed, left: Math.max(0, waiting.length - limit) }
}
