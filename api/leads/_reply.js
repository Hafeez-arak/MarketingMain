import { accessToken, findMessage, requestKey } from './_mail.js'
import { toEnvelope } from '../../src/lib/leads/qualify.js'
import { replyRequest, parseReply, buildReply, replyMessage, signatureFromBody, websiteFromContact } from '../../src/lib/leads/autoReply.js'

export { websiteFromContact }

// ─── Auto-replies: queue and send (2026-10-29) ─────────────────────────────
// Every qualified lead gets one short acknowledgement (src/lib/leads/
// autoReply.js), 15–20 minutes after its email arrived, from the mailbox it
// came to, on the same thread, with that mailbox's own Outlook signature and
// never another's (a CLB email: info@clb-sa.com with CLB's signature). A
// website enquiry is answered by a new email from the mailbox on the
// company's website domain (info@arak-sa.com). A mailbox with no signature
// copied sends nothing: its replies wait, up to two hours. A needs-review lead is answered 15–20
// minutes after a person approves it.
//
// Runs in the five-minute round (intakeWebsite, after the mailboxes), in two
// steps, each a no-op when there is nothing to do:
//   queue  new qualified leads → lead_replies 'due' with send_after, or
//          'skipped' with the reason (no address, the same request again)
//   send   'due' rows whose time has come → 'sent', 'skipped' (someone at
//          the company answered first, or it is no longer a lead) or 'failed'
//
// Off unless lead_agent_settings.auto_reply_since is set, and only leads that
// arrived after that moment are answered: switching on never replies to a
// backlog. One real reply per lead (a unique index), and a row is claimed
// (sent_at) before its email goes, so two rounds never send it twice. A claim
// that never finished is marked failed, never retried: a second email to a
// customer is worse than none.

const GRAPH = 'https://graph.microsoft.com/v1.0'
export const DELAY_MIN = 15
export const DELAY_MAX = 20
export const REPEAT_DAYS = 14
/** Model calls per round: the round shares 45 seconds with everything else. */
export const QUEUE_PER_ROUND = 5
export const SEND_PER_ROUND = 8
const STUCK_MS = 10 * 60_000
/** How long a reply may wait for its mailbox's signature before it is dropped. */
export const HOLD_MS = 2 * 3600_000

const lower = (s) => String(s || '').trim().toLowerCase()
const domainOf = (email) => lower(email).split('@')[1] || ''
const subjectKey = (s) => lower(s).replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()
const isQualified = (l) => (l.human_verdict || l.verdict) === 'qualified'

/**
 * When the reply goes: 15–20 minutes (a random minute, so it does not look
 * like a machine) after the email arrived, or after a person approved it.
 * Never in the past by more than now: a late queue sends at the next round.
 */
export function sendAfterFor(lead, now, rand = Math.random()) {
  const approvedLater = lead.human_verdict === 'qualified' && lead.verdict !== 'qualified'
  const base = approvedLater ? now.getTime() : (Date.parse(lead.received_at) || now.getTime())
  return new Date(base + (DELAY_MIN + rand * (DELAY_MAX - DELAY_MIN)) * 60_000)
}

/**
 * The same request again: an earlier reply (queued or sent) in the last 14
 * days to the same sender about the same subject, or with the same RFQ
 * reference from the same company. `earlier` = [{ lead: { email, subject, received_at } }].
 */
export function repeatOf(lead, earlier = []) {
  const t = Date.parse(lead.received_at) || 0
  const key = requestKey(lead.email, lead.subject)
  return earlier.find((r) => {
    const o = r.lead || {}
    const ot = Date.parse(o.received_at) || 0
    if (!ot || ot >= t || t - ot > REPEAT_DAYS * 86_400_000) return false
    return (key && requestKey(o.email, o.subject) === key)
      || (o.email && lower(o.email) === lower(lead.email) && subjectKey(o.subject) === subjectKey(lead.subject))
  }) || null
}

/**
 * Has someone at the company already answered this customer on the thread?
 * A message after the enquiry, from one of our domains, to someone outside
 * them. A forward from info@ to a salesperson stays inside and does not count.
 */
export function alreadyAnswered(messages = [], { receivedAt, ownDomains = [] } = {}) {
  const own = new Set(ownDomains.map(lower))
  const after = Date.parse(receivedAt) || 0
  return messages.some((m) => {
    const when = Date.parse(m.sentDateTime || m.receivedDateTime) || 0
    if (when <= after || !own.has(domainOf(m.from?.emailAddress?.address))) return false
    const to = [...(m.toRecipients || []), ...(m.ccRecipients || [])].map((r) => domainOf(r?.emailAddress?.address))
    return to.some((d) => d && !own.has(d))
  })
}

async function settingsOf(deps, workspaceId) {
  try {
    const [row] = await deps.db(`lead_agent_settings?workspace_id=eq.${workspaceId}&select=auto_reply_since`) || []
    return row || {}
  } catch {
    // The column is not there yet (migration 20261107): auto-replies stay off.
    return {}
  }
}

async function mailboxesOf(deps, workspaceId) {
  try {
    return await deps.db(`lead_mailboxes?workspace_id=eq.${workspaceId}&status=eq.active&select=id,email,label,can_send,tenant,reply_signature&order=created_at`) || []
  } catch {
    return await deps.db(`lead_mailboxes?workspace_id=eq.${workspaceId}&status=eq.active&select=id,email,label,can_send,tenant&order=created_at`) || []
  }
}

const LEAD_FIELDS = 'id,source,source_ref,mailbox,name,company,email,phone,subject,message,summary,language,received_at,verdict,human_verdict,duplicate_of'

/** Queue new qualified leads. Returns { queued, skipped }. */
export async function queueReplies(deps, { workspaceId, since, deadline = Infinity, companyName = '' }) {
  const clock = deps.clock || Date.now
  const leads = await deps.db(`leads?workspace_id=eq.${workspaceId}&received_at=gte.${encodeURIComponent(since)}&duplicate_of=is.null&or=(verdict.eq.qualified,human_verdict.eq.qualified)&select=${LEAD_FIELDS}&order=received_at.asc&limit=100`) || []
  const fresh = leads.filter(isQualified)
  if (!fresh.length) return { queued: 0, skipped: 0 }
  const have = await deps.db(`lead_replies?workspace_id=eq.${workspaceId}&status=neq.test&lead_id=in.(${fresh.map((l) => l.id).join(',')})&select=lead_id`) || []
  const done = new Set(have.map((r) => r.lead_id))
  const todo = fresh.filter((l) => !done.has(l.id)).slice(0, QUEUE_PER_ROUND)
  if (!todo.length) return { queued: 0, skipped: 0 }

  const lookback = new Date(Date.parse(todo[0].received_at) - REPEAT_DAYS * 86_400_000).toISOString()
  const earlier = await deps.db(`lead_replies?workspace_id=eq.${workspaceId}&status=in.(due,sent)&created_at=gte.${encodeURIComponent(lookback)}&select=id,lead:leads(email,subject,received_at)`) || []
  let queued = 0
  let skipped = 0
  for (const lead of todo) {
    if (clock() > deadline) break
    const now = deps.now()
    const row = { workspace_id: workspaceId, lead_id: lead.id, created_at: now.toISOString(), updated_at: now.toISOString() }
    const repeat = repeatOf(lead, earlier)
    if (!lead.email) Object.assign(row, { status: 'skipped', skip_reason: 'No email address to reply to.' })
    else if (repeat) Object.assign(row, { status: 'skipped', skip_reason: `Same request again: ${repeat.lead?.subject || 'an earlier email'} (${String(repeat.lead?.received_at || '').slice(0, 10)}) already has a reply.` })
    else {
      const env = toEnvelope('email', {
        sourceRef: lead.source_ref, receivedAt: lead.received_at || '', name: lead.name, company: lead.company,
        email: lead.email, phone: lead.phone, subject: lead.subject, message: lead.message, language: lead.language,
      })
      env.source = lead.source
      const body = replyRequest(env, lead, { companyName })
      const res = await deps.model(body, workspaceId).catch((err) => ({ error: err.message }))
      const usage = res.usage || {}
      await deps.db('agent_usage', {
        method: 'POST', prefer: 'return=minimal',
        body: {
          workspace_id: workspaceId, surface: 'lead_auto_reply', model: body.model,
          tokens_in: usage.prompt_tokens || 0, tokens_out: usage.completion_tokens || 0,
          cost_usd: Number(usage.cost) || 0, error: res.error ? String(res.error).slice(0, 300) : '',
        },
      }).catch(() => {})
      // A failed call still gets the reply, just without the topic ("Thank you for your enquiry.").
      const pick = res.error ? { topic: '' } : parseReply(res.text)
      const reply = buildReply(pick, lead, { company: { name: companyName } })
      Object.assign(row, {
        status: 'due', format: 'acknowledge', subject: reply.subject, body: reply.text,
        model: body.model, cost_usd: Number(usage.cost) || 0, send_after: sendAfterFor(lead, now).toISOString(),
      })
    }
    try {
      await deps.db('lead_replies', { method: 'POST', prefer: 'return=minimal', body: row })
      if (row.status === 'due') { queued++; earlier.push({ lead }) } else skipped++
    } catch { /* another round queued it first (one real reply per lead) */ }
  }
  return { queued, skipped }
}

async function finish(deps, id, patch) {
  await deps.db(`lead_replies?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...patch, updated_at: deps.now().toISOString() } })
}

/** Send the replies whose time has come. Returns { sent, skipped, failed, held }. */
export async function sendDueReplies(deps, { workspaceId, deadline = Infinity, ownDomains = [] }) {
  const clock = deps.clock || Date.now
  const now = deps.now()
  // A claim that never finished (the round died mid-send): it may or may not
  // have gone, so it is failed, never sent again.
  const stuck = new Date(now.getTime() - STUCK_MS).toISOString()
  await deps.db(`lead_replies?workspace_id=eq.${workspaceId}&status=eq.due&sent_at=lt.${encodeURIComponent(stuck)}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'failed', error: 'The send did not finish; it may or may not have gone. Not retried.', updated_at: now.toISOString() },
  }).catch(() => {})

  const due = await deps.db(`lead_replies?workspace_id=eq.${workspaceId}&status=eq.due&sent_at=is.null&send_after=lte.${encodeURIComponent(now.toISOString())}&select=id,lead_id,subject,body,send_after&order=send_after.asc&limit=${SEND_PER_ROUND}`) || []
  const out = { sent: 0, skipped: 0, failed: 0, held: 0 }
  if (!due.length) return out
  const mailboxes = await mailboxesOf(deps, workspaceId)
  const site = await websiteDomainOf(deps, workspaceId)
  const own = [...new Set([...ownDomains, ...mailboxes.flatMap((m) => [domainOf(m.email), domainOf(m.label)])].filter(Boolean))]

  for (const row of due) {
    if (clock() > deadline) break
    const [claimed] = await deps.db(`lead_replies?id=eq.${row.id}&status=eq.due&sent_at=is.null`, {
      method: 'PATCH', prefer: 'return=representation', body: { sent_at: deps.now().toISOString(), updated_at: deps.now().toISOString() },
    }) || []
    if (!claimed) continue
    try {
      const r = await sendOne(deps, { workspaceId, row, mailboxes, own, site })
      if (r.hold) {
        // Nothing went. Wait for the signature, but not for ever: a reply
        // hours late is worse than none.
        const late = deps.now().getTime() - Date.parse(row.send_after) > HOLD_MS
        await finish(deps, row.id, late ? { status: 'skipped', skip_reason: `${r.hold} It waited too long and was not sent.`, sent_at: null } : { sent_at: null, error: r.hold })
        if (late) out.skipped++; else out.held++
      } else if (r.skipped) { await finish(deps, row.id, { status: 'skipped', skip_reason: r.skipped, sent_at: null }); out.skipped++ }
      else if (r.ok) { await finish(deps, row.id, { status: 'sent', sent_at: deps.now().toISOString(), error: '' }); out.sent++ }
      else { await finish(deps, row.id, { status: 'failed', error: String(r.error || 'Not sent.').slice(0, 400) }); out.failed++ }
    } catch (err) {
      await finish(deps, row.id, { status: 'failed', error: String(err.message || err).slice(0, 400) }).catch(() => {})
      out.failed++
    }
  }
  return out
}

/**
 * The mailbox a reply goes from, never mixed (the owner, 2026-10-29): an
 * email is answered from the mailbox it came to (a CLB email from info@clb,
 * an Arak one from info@arak); a website enquiry from the mailbox on the
 * company's own website domain (`site`, from its Brand Brain contact
 * details), else the first that may send.
 */
export function replyMailbox(lead, mailboxes = [], site = '') {
  if (lead.source === 'email') return mailboxes.find((m) => lower(m.label) === lower(lead.mailbox) || lower(m.email) === lower(lead.mailbox)) || null
  const onSite = site && mailboxes.find((m) => m.can_send && [domainOf(m.label), domainOf(m.email)].includes(lower(site)))
  return onSite || mailboxes.find((m) => m.can_send) || null
}

async function websiteDomainOf(deps, workspaceId) {
  try {
    const [p] = await deps.db(`brand_profile?workspace_id=eq.${workspaceId}&select=contact_info`) || []
    return websiteFromContact(p?.contact_info)
  } catch { return '' }
}

/** The From the customer sees: the address they wrote to (info@, an alias), else the account's own. */
const fromOf = (mb) => ({ emailAddress: { address: lower(mb.label).includes('@') ? lower(mb.label) : lower(mb.email) } })

async function graphPost(deps, auth, path, body) {
  const r = await deps.fetch(`${GRAPH}${path}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (r.ok) return { ok: true }
  let j = {}
  try { j = await r.json() } catch { /* not JSON */ }
  return { ok: false, error: `Microsoft answered ${r.status}${j?.error?.code ? ` (${j.error.code})` : ''}: ${String(j?.error?.message || '').slice(0, 200)}` }
}

async function sendOne(deps, { workspaceId, row, mailboxes, own, site = '' }) {
  const [lead] = await deps.db(`leads?id=eq.${row.lead_id}&workspace_id=eq.${workspaceId}&select=${LEAD_FIELDS}`) || []
  if (!lead) return { skipped: 'The lead was deleted.' }
  if (!isQualified(lead)) return { skipped: 'No longer a qualified lead.' }
  const mb = replyMailbox(lead, mailboxes, site)
  if (!mb) return { error: `The mailbox ${lead.mailbox || ''} is not connected.` }
  if (!mb.can_send) return { error: `${mb.label || mb.email} can only read. On Agent settings, choose "Allow forwarding" on it.` }
  // Only the mailbox's own signature: a CLB reply never signs as Arak.
  if (!mb.reply_signature?.html) return { hold: `${mb.label || mb.email} has no signature copied yet (Agent settings → Auto-replies).` }
  const { html, attachments } = replyMessage(row.body, mb.reply_signature)

  if (lead.source === 'email') {
    const f = await findMessage(deps, { workspaceId, leadId: lead.id, select: 'id,conversationId' })
    if (f.error) return { error: f.error }
    // Someone at the company answered first (from this mailbox): no auto-reply.
    if (f.msg.conversationId) {
      const q = new URLSearchParams({ $filter: `conversationId eq '${String(f.msg.conversationId).replace(/'/g, "''")}'`, $select: 'from,toRecipients,ccRecipients,sentDateTime,receivedDateTime', $top: '50' })
      const conv = await deps.fetch(`${GRAPH}/me/messages?${q}`, { headers: f.auth })
      const list = conv.ok ? (await conv.json())?.value || [] : []
      if (alreadyAnswered(list, { receivedAt: lead.received_at, ownDomains: own })) return { skipped: 'Someone at the company already replied on this thread.' }
    }
    // On the thread: Graph's reply keeps the subject, recipients and threading.
    return graphPost(deps, f.auth, `/me/messages/${encodeURIComponent(f.msg.id)}/reply`, {
      message: { from: fromOf(mb), body: { contentType: 'HTML', content: html }, attachments },
    })
  }

  // A website enquiry: a new email to the address they gave.
  const tok = await accessToken(deps, mb)
  if (tok.error) return { error: tok.error.reason || tok.error.message }
  return graphPost(deps, { Authorization: `Bearer ${tok.token}` }, '/me/sendMail', {
    message: {
      from: fromOf(mb), subject: row.subject,
      toRecipients: [{ emailAddress: { address: lead.email, name: lead.name || '' } }],
      body: { contentType: 'HTML', content: html }, attachments,
    },
    saveToSentItems: true,
  })
}

/**
 * The round's auto-reply step: queue, then send. Off (and silent) until the
 * company switches auto-replies on. Never throws.
 */
export async function runAutoReplies(deps, { workspaceId, deadline = Infinity, companyName = '', ownDomains = [] }) {
  try {
    const { auto_reply_since: since } = await settingsOf(deps, workspaceId)
    if (!since) return { off: true }
    if (!companyName) {
      const [ws] = await deps.db(`workspaces?id=eq.${workspaceId}&select=name`) || []
      companyName = ws?.name || ''
    }
    const queue = await queueReplies(deps, { workspaceId, since, deadline, companyName })
    const send = await sendDueReplies(deps, { workspaceId, deadline, ownDomains })
    return { ...queue, ...send }
  } catch (err) {
    return { error: String(err.message || err).slice(0, 300) }
  }
}

// ─── The mailbox's Outlook signature ───────────────────────────────────────

/**
 * Copy a mailbox's Outlook signature (pictures included) from the newest
 * draft or sent email that carries it, into lead_mailboxes.reply_signature.
 * Returns { ok, from, pictures } or { status, error }.
 */
export async function copySignature(deps, { workspaceId, mailboxId }) {
  const [mb] = await deps.db(`lead_mailboxes?id=eq.${mailboxId}&workspace_id=eq.${workspaceId}&select=*`) || []
  if (!mb) return { status: 404, error: 'That mailbox is not connected to this company.' }
  const tok = await accessToken(deps, mb)
  if (tok.error) return { status: 502, error: tok.error.reason || tok.error.message }
  const auth = { Authorization: `Bearer ${tok.token}` }
  let found = null
  for (const folder of ['drafts', 'sentitems']) {
    const q = new URLSearchParams({ $top: '50', $select: 'id,subject,lastModifiedDateTime,body' })
    const r = await deps.fetch(`${GRAPH}/me/mailFolders/${folder}/messages?${q}`, { headers: auth })
    const list = r.ok ? (await r.json())?.value || [] : []
    const withSig = list.filter((m) => /<div[^>]*\bid="Signature"/i.test(m.body?.content || ''))
      .sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)))
    if (withSig.length) { found = { ...withSig[0], folder }; break }
  }
  if (!found) return { status: 404, error: `No draft or sent email in ${mb.label || mb.email} has its Outlook signature. In Outlook, start a new email from that account (the signature is added) and leave it in Drafts, then try again.` }
  const a = await deps.fetch(`${GRAPH}/me/messages/${encodeURIComponent(found.id)}/attachments`, { headers: auth })
  const sig = signatureFromBody(found.body?.content, a.ok ? (await a.json())?.value || [] : [])
  if (!sig) return { status: 422, error: 'The signature in that email was empty.' }
  const from = `${found.folder === 'drafts' ? 'Drafts' : 'Sent Items'}: ${found.subject || '(no subject)'}`
  try {
    await deps.db(`lead_mailboxes?id=eq.${mb.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { reply_signature: { ...sig, copied_from: from, copied_at: deps.now().toISOString() } },
    })
  } catch {
    return { status: 503, error: 'The database is not ready for signatures yet (migration 20261107).' }
  }
  return { ok: true, from, pictures: sig.images.length }
}
