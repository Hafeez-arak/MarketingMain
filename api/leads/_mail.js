import { READ_SCOPES, refreshTokens, exchangeCode, whoAmI, packTokens, unpackTokens, classifyGraphError } from '../email/_graph.js'
import { toEnvelope, findDuplicate } from '../../src/lib/leads/qualify.js'
import { capDecision } from '../../src/lib/agent/budget.js'
import { askModel, loadBrand, monthSpent, upsertLead } from './_intake.js'

// ─── The lead agent reads a mailbox ────────────────────────────────────────
// info@arak-sa.com first (the owner's decision, 2026-10-06), READ ONLY. New
// inbox mail since the last check goes through free filters in code first
// (colleagues, automatic senders, newsletters, out-of-office, the website
// form's own copies, replies in a conversation already sorted); only what is
// left reaches the model, through the same qualifier as the website.
//
// Nothing is sent, moved, tagged or deleted: the token is Mail.Read only, at
// sign-in and at every renewal (READ_SCOPES). Attachments are never fetched.
// Skipped mail is not stored at all.
//
//   deps.db / deps.model / deps.now   as in _intake.js
//   deps.fetch                        Microsoft (Graph and sign-in)
//   deps.ms                           msConfig()
//   deps.seal(plain) / deps.open(s)   the sealed-token helpers

/** Model calls one check may make per mailbox; the rest wait for the next round. */
export const MAIL_MAX_MODEL_CALLS = 8

/** How far back a first connection reads, so the page has something to show. */
export const FIRST_READ_DAYS = 7

/** Characters of an email the model sees: the new part, not the quoted thread. */
const MAX_BODY = 6000

const GRAPH = 'https://graph.microsoft.com/v1.0'

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|digest|updates?|marketing|mailer)([._+-]|$)/i
const AUTO_SUBJECT = /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|undeliverable|delivery status notification|delivery has failed|mail delivery (failed|subsystem)|accepted:|declined:|tentative:|invitation:|updated invitation|cancell?ed( event)?:|read:|رد تلقائي|خارج المكتب)/i

const lower = (s) => String(s || '').trim().toLowerCase()

/** One header's value from Graph's internetMessageHeaders, any case. */
export function header(msg, name) {
  const want = name.toLowerCase()
  return (msg?.internetMessageHeaders || []).find((h) => lower(h?.name) === want)?.value || ''
}

const senderOf = (msg) => msg?.from?.emailAddress || msg?.sender?.emailAddress || {}

/**
 * Why an email is not worth a model call, or '' when it is. Plain code: the
 * filters cost nothing, and most of an inbox is caught here.
 */
export function skipReason(msg, { ownDomain = '' } = {}) {
  if (msg?.isDraft) return 'draft'
  const from = lower(senderOf(msg).address)
  if (!from || !from.includes('@')) return 'no sender'
  const [local, domain] = from.split('@')
  if (ownDomain && domain === lower(ownDomain)) return 'colleague'
  const subject = String(msg?.subject || '').trim()
  // The website form's own copy of an enquiry: the Sheet already has it.
  if (/^Lighting enquiry — /.test(subject) || lower(senderOf(msg).name) === 'arak website') return 'website form copy'
  if (AUTOMATED_LOCAL.test(local)) return 'automatic sender'
  if (AUTO_SUBJECT.test(subject)) return 'automatic reply'
  if (header(msg, 'list-unsubscribe') || header(msg, 'list-id')) return 'newsletter'
  if (/bulk|list|junk/i.test(header(msg, 'precedence'))) return 'bulk mail'
  const auto = header(msg, 'auto-submitted')
  if (auto && !/^no$/i.test(auto.trim())) return 'automatic'
  return ''
}

/**
 * The new part of an email: everything above the quoted thread. Outlook,
 * Gmail and Apple Mail each mark the quote differently; the first marker
 * found ends the message.
 */
export function stripQuoted(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n')
  const markers = [
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^_{10,}\s*$/m,
    /^(From|De|Von|من)\s*:\s.+\n(Sent|Date|Envoyé|Gesendet|التاريخ|تاريخ الإرسال|أرسل)\s*:/im,
    /^On .{4,200}wrote:\s*$/im,
    /^في .{4,200}كتب.{0,40}:\s*$/im,
  ]
  let end = t.length
  for (const re of markers) {
    const m = re.exec(t)
    if (m && m.index > 0 && m.index < end) end = m.index
  }
  return t.slice(0, end).trim().slice(0, MAX_BODY)
}

/** A Graph message → the qualifier's envelope. */
export function messageToEnvelope(msg) {
  const from = senderOf(msg)
  const body = stripQuoted(msg?.body?.content || msg?.bodyPreview || '')
  return toEnvelope('email', {
    sourceRef: msg.internetMessageId || msg.id,
    receivedAt: msg.receivedDateTime || '',
    name: from.name || '',
    email: from.address || '',
    company: '',
    phone: '',
    subject: msg.subject || '',
    message: body,
    language: /\p{Script=Arabic}/u.test(`${msg.subject || ''} ${body}`) ? 'ar' : 'en',
  })
}

const authError = (reason) => Object.assign(new Error(reason), { kind: 'auth', reason })

/** A usable read-only access token for the mailbox, renewed (with READ_SCOPES) when near expiry. */
async function accessToken(deps, mb) {
  const [row] = await deps.db(`lead_mailbox_secrets?mailbox_id=eq.${mb.id}&select=secret`) || []
  if (!row) return { error: authError('No stored sign-in for this mailbox. Connect it again.') }
  let t = null
  try { t = unpackTokens(deps.open(row.secret)) } catch { /* sealed with another key */ }
  if (!t) return { error: authError('The stored sign-in cannot be read. Connect the mailbox again.') }
  const now = deps.now().getTime()
  if (t.at && t.exp > now + 5 * 60_000) return { token: t.at }
  try {
    const got = await refreshTokens({ config: deps.ms, refreshToken: t.rt, fetch: deps.fetch, scopes: READ_SCOPES })
    const packed = packTokens({ ...got, refresh_token: got.refresh_token || t.rt }, now)
    await deps.db('lead_mailbox_secrets?on_conflict=mailbox_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { mailbox_id: mb.id, workspace_id: mb.workspace_id, secret: deps.seal(packed), updated_at: deps.now().toISOString() },
    })
    return { token: got.access_token }
  } catch (err) {
    return { error: err }
  }
}

/** Inbox mail received at or after `sinceIso`, oldest first, text bodies, at most 25. */
async function listInbox(deps, token, sinceIso) {
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${sinceIso}`,
    $orderby: 'receivedDateTime asc',
    $top: '25',
    $select: 'id,internetMessageId,conversationId,subject,from,sender,receivedDateTime,body,bodyPreview,internetMessageHeaders,webLink,isDraft',
  })
  const res = await deps.fetch(`${GRAPH}/me/mailFolders/inbox/messages?${q}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
  })
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const code = data?.error?.code || ''
    const message = data?.error?.message || `Microsoft Graph answered ${res.status}`
    const { kind, reason } = classifyGraphError(res.status, code, message)
    return { error: Object.assign(new Error(`${code ? code + ': ' : ''}${message}`.slice(0, 300)), { kind, reason }) }
  }
  return { messages: Array.isArray(data?.value) ? data.value : [] }
}

const quoteIn = (values) => values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',')

async function setMailbox(deps, mb, patch) {
  await deps.db(`lead_mailboxes?id=eq.${mb.id}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { ...patch, updated_at: deps.now().toISOString() },
  })
}

/**
 * Read one mailbox's new mail and qualify what is worth it. `budget` is
 * shared across mailboxes in one check: { calls, deadline (ms) }.
 */
export async function checkMailbox(deps, { mb, brand, budget }) {
  const now = deps.now()
  const counts = { seen: 0, skipped: 0, qualified: 0, unqualified: 0, needs_review: 0, duplicate: 0, failed: 0, waiting: 0 }
  const tok = await accessToken(deps, mb)
  if (tok.error) {
    const auth = tok.error.kind === 'auth'
    await setMailbox(deps, mb, { status: auth ? 'reconnect' : mb.status, last_checked_at: now.toISOString(), last_error: String(tok.error.reason || tok.error.message).slice(0, 300) })
    return { email: mb.email, error: tok.error.reason || tok.error.message, counts }
  }
  const listed = await listInbox(deps, tok.token, new Date(mb.read_from).toISOString())
  if (listed.error) {
    const auth = listed.error.kind === 'auth'
    await setMailbox(deps, mb, { status: auth ? 'reconnect' : mb.status, last_checked_at: now.toISOString(), last_error: String(listed.error.reason || listed.error.message).slice(0, 300) })
    return { email: mb.email, error: listed.error.reason || listed.error.message, counts }
  }
  const msgs = listed.messages
  counts.seen = msgs.length
  const ownDomain = mb.email.split('@')[1] || ''

  // What we already decided: these messages (by Message-ID), these threads,
  // and the last week's email leads for the duplicate check. A message whose
  // model call failed has a row with no verdict, so it is NOT "decided" and
  // is asked again.
  const refs = msgs.map((m) => m.internetMessageId || m.id)
  const convIds = [...new Set(msgs.map((m) => m.conversationId).filter(Boolean))]
  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString()
  const [byRef, byConv, recent] = await Promise.all([
    refs.length ? deps.db(`leads?workspace_id=eq.${mb.workspace_id}&source=eq.email&source_ref=in.(${encodeURIComponent(quoteIn(refs))})&select=source_ref,verdict`) : [],
    convIds.length ? deps.db(`leads?workspace_id=eq.${mb.workspace_id}&conversation_id=in.(${encodeURIComponent(quoteIn(convIds))})&select=conversation_id,source_ref`) : [],
    deps.db(`leads?workspace_id=eq.${mb.workspace_id}&source=eq.email&received_at=gte.${since}&select=id,source_ref,email,phone,message,received_at&limit=500`),
  ])
  const decided = new Set((byRef || []).filter((l) => l.verdict).map((l) => l.source_ref))
  const threads = new Map((byConv || []).map((l) => [l.conversation_id, l.source_ref]))
  const known = (recent || []).map((l) => ({ id: l.id, sourceRef: l.source_ref, email: l.email, phone: l.phone, message: l.message, receivedAt: l.received_at }))

  let readFrom = mb.read_from
  let spent = null
  for (const m of msgs) {
    const ref = m.internetMessageId || m.id
    if (decided.has(ref)) { readFrom = m.receivedDateTime; continue }
    const reason = skipReason(m, { ownDomain })
    const sameThread = m.conversationId && threads.has(m.conversationId) && threads.get(m.conversationId) !== ref
    if (reason || sameThread) { counts.skipped++; readFrom = m.receivedDateTime; continue }
    if (budget.calls <= 0 || deps.now().getTime() > budget.deadline) { counts.waiting = msgs.length - msgs.indexOf(m); break }

    const env = messageToEnvelope(m)
    const base = {
      workspace_id: mb.workspace_id, source: 'email', source_ref: ref, received_at: m.receivedDateTime || null,
      name: env.name, company: env.company, email: env.email, phone: '', subject: env.subject, message: env.message,
      language: env.language, mailbox: mb.email, link: m.webLink || '', conversation_id: m.conversationId || '',
      updated_at: now.toISOString(),
    }
    const dup = findDuplicate(env, known.filter((k) => k.sourceRef !== ref), { days: 7 })
    if (dup) {
      await upsertLead(deps.db, { ...base, verdict: 'duplicate', reason: 'Same sender and message as an earlier email.', duplicate_of: dup.id || null, error: '' })
      counts.duplicate++
      threads.set(m.conversationId, ref)
      readFrom = m.receivedDateTime
      continue
    }
    if (spent === null) spent = await monthSpent(deps.db, mb.workspace_id, now)
    if (!capDecision({ cap: brand.cap, spent, estimate: 0.001 }).allowed) {
      await upsertLead(deps.db, { ...base, verdict: 'needs_review', category: 'unclear', reason: 'Not checked: this month\'s AI budget is used up.', error: 'cap' })
      counts.needs_review++
      readFrom = m.receivedDateTime
      continue
    }
    budget.calls--
    const out = await askModel(deps, { workspaceId: mb.workspace_id, env, brand })
    spent += out.cost
    if (out.error) {
      // Stored without a verdict and NOT read past: the next check asks again.
      await upsertLead(deps.db, { ...base, model: out.model, cost_usd: out.cost, error: out.error })
      counts.failed++
      break
    }
    const v = out.verdict
    const saved = await upsertLead(deps.db, {
      ...base, verdict: v.verdict, category: v.category, confidence: v.confidence, reason: v.reason,
      summary: v.summary, details: v.details, ask_next: v.ask_next, model: out.model, cost_usd: out.cost, error: '',
    })
    counts[v.verdict]++
    threads.set(m.conversationId, ref)
    known.push({ id: saved?.id, sourceRef: ref, email: env.email, phone: '', message: env.message, receivedAt: base.received_at })
    readFrom = m.receivedDateTime
  }

  await setMailbox(deps, mb, { read_from: readFrom, last_checked_at: now.toISOString(), last_error: '', status: 'active', last_counts: counts })
  return { email: mb.email, counts }
}

/** Every active mailbox of one company. */
export async function checkMail(deps, { workspaceId, calls = MAIL_MAX_MODEL_CALLS, deadline = Infinity }) {
  const mailboxes = await deps.db(`lead_mailboxes?workspace_id=eq.${workspaceId}&status=eq.active&select=*`) || []
  if (!mailboxes.length) return { mailboxes: [] }
  const brand = await loadBrand(deps.db, workspaceId)
  const budget = { calls, deadline }
  const out = []
  for (const mb of mailboxes) out.push(await checkMailbox(deps, { mb, brand, budget }))
  return { mailboxes: out }
}

/** The daily safety run: every company with an active mailbox and the agent switched on. */
export async function checkAllMail(deps) {
  const rows = await deps.db('lead_mailboxes?status=eq.active&select=workspace_id') || []
  const out = []
  for (const ws of [...new Set(rows.map((r) => r.workspace_id))]) {
    const [settings] = await deps.db(`lead_agent_settings?workspace_id=eq.${ws}&select=enabled`) || []
    if (settings && settings.enabled === false) continue
    out.push({ workspaceId: ws, ...(await checkMail(deps, { workspaceId: ws, calls: 25 })) })
  }
  return out
}

/**
 * The end of "Connect a mailbox": Microsoft sent back a code. Exchange it for
 * a READ-ONLY token, check the account has a mailbox, store it sealed.
 * Returns { ok, email } or { error: <short code for the page> }.
 */
export async function finishConnect(deps, { claims, code, redirectUri }) {
  let tokens
  try {
    tokens = await exchangeCode({ config: deps.ms, code, redirectUri, fetch: deps.fetch, scopes: READ_SCOPES })
  } catch { return { error: 'token' } }
  if (!tokens.refresh_token) return { error: 'token' }
  const me = await whoAmI({ accessToken: tokens.access_token, fetch: deps.fetch })
  if (!me.ok) return { error: /licence|mailbox/i.test(me.error?.reason || '') ? 'no_mailbox' : 'graph' }
  const email = lower(me.email)
  if (!email.includes('@')) return { error: 'graph' }

  const now = deps.now()
  const [existing] = await deps.db(`lead_mailboxes?workspace_id=eq.${claims.ws}&email=eq.${encodeURIComponent(email)}&select=*`) || []
  let mb = existing
  if (mb) {
    ;[mb] = await deps.db(`lead_mailboxes?id=eq.${mb.id}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { status: 'active', last_error: '', display_name: me.displayName || mb.display_name, updated_at: now.toISOString() },
    }) || []
  } else {
    ;[mb] = await deps.db('lead_mailboxes', {
      method: 'POST', prefer: 'return=representation',
      body: {
        workspace_id: claims.ws, email, display_name: me.displayName || '', status: 'active',
        read_from: new Date(now.getTime() - FIRST_READ_DAYS * 86_400_000).toISOString(), created_by: claims.uid || null,
      },
    }) || []
  }
  if (!mb) return { error: 'save' }
  await deps.db('lead_mailbox_secrets?on_conflict=mailbox_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { mailbox_id: mb.id, workspace_id: claims.ws, secret: deps.seal(packTokens(tokens, now.getTime())), updated_at: now.toISOString() },
  })
  return { ok: true, email }
}
