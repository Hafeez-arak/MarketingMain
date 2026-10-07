import { READ_SCOPES, refreshTokens, exchangeCode, whoAmI, packTokens, unpackTokens, classifyGraphError } from '../email/_graph.js'
import { toEnvelope, findDuplicate } from '../../src/lib/leads/qualify.js'
import { capDecision } from '../../src/lib/agent/budget.js'
import { askModel, loadBrand, monthSpent, upsertLead } from './_intake.js'

// ─── The lead agent reads mailboxes ────────────────────────────────────────
// info@arak-sa.com and info@clb-sa.com (the owner's decisions, 2026-10-06/07),
// READ ONLY. Every folder is read, Junk included, because good enquiries land
// there too; outgoing mail (Sent, Drafts, Outbox) is ours and skipped. Free
// filters in code go first (colleagues on either company domain, automatic
// senders, newsletters, out-of-office, the website form's own copies, replies
// in a conversation already sorted); only what is left reaches the model,
// through the same qualifier as the website.
//
// Two passes per mailbox, sharing one budget:
//   new mail   from read_from onwards (new mailboxes start at 1 October 2026,
//              where the workbook's "New leads" tab starts)
//   history    1 July → 1 October 2026, once, for the "Jul–Sep 2026" tab;
//              it walks history_cursor forward and stops when done
//
// Nothing is sent, moved, tagged or deleted: the token is Mail.Read only, at
// sign-in and at every renewal (READ_SCOPES). Attachments are never fetched.
// Skipped mail is not stored at all.
//
//   deps.db / deps.model / deps.now   as in _intake.js
//   deps.fetch                        Microsoft (Graph and sign-in)
//   deps.ms                           msConfig()
//   deps.seal(plain) / deps.open(s)   the sealed-token helpers

/**
 * Model calls one round may make across every mailbox and both passes. Kept
 * under OpenRouter's limit for new accounts, 20 requests a minute per model
 * (seen 2026-10-07 on the first history round): a call over it is refused,
 * the email waits for the next round, and the page shows it as not checked.
 */
export const MAIL_CALLS_PER_ROUND = 18

/** Model calls in flight at once. */
const CONCURRENCY = 4

/** Where a new mailbox starts reading new mail: the "New leads" tab's first day. */
export const NEW_LEADS_FROM = '2026-10-01T00:00:00+03:00'

/** Messages per Graph page. */
const PAGE = 50

/** Characters of an email the model sees: the new part, not the quoted thread. */
const MAX_BODY = 6000

const GRAPH = 'https://graph.microsoft.com/v1.0'

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|digest|updates?|marketing|mailer)([._+-]|$)/i
const AUTO_SUBJECT = /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|undeliverable|delivery status notification|delivery has failed|mail delivery (failed|subsystem)|accepted:|declined:|tentative:|invitation:|updated invitation|cancell?ed( event)?:|read:|رد تلقائي|خارج المكتب)/i

const lower = (s) => String(s || '').trim().toLowerCase()
const domainOf = (email) => lower(email).split('@')[1] || ''

/** One header's value from Graph's internetMessageHeaders, any case. */
export function header(msg, name) {
  const want = name.toLowerCase()
  return (msg?.internetMessageHeaders || []).find((h) => lower(h?.name) === want)?.value || ''
}

const senderOf = (msg) => msg?.from?.emailAddress || msg?.sender?.emailAddress || {}

/**
 * Why an email is not worth a model call, or '' when it is. Plain code: the
 * filters cost nothing, and most of a mailbox is caught here. `ownDomains`
 * are the company's own (arak-sa.com, clb-sa.com): mail from them is a
 * colleague's, and that includes everything in Sent and Outbox.
 */
export function skipReason(msg, { ownDomains = [], ownDomain = '' } = {}) {
  if (msg?.isDraft) return 'draft'
  const from = lower(senderOf(msg).address)
  if (!from || !from.includes('@')) return 'no sender'
  const [local, domain] = from.split('@')
  const own = new Set([...ownDomains, ownDomain].map(lower).filter(Boolean))
  if (own.has(domain)) return 'colleague'
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

/** The sign-in settings for this mailbox: another organisation's renews against its own tenant. */
const configFor = (deps, mb) => (mb?.tenant ? { ...deps.ms, tenant: mb.tenant } : deps.ms)

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
    const got = await refreshTokens({ config: configFor(deps, mb), refreshToken: t.rt, fetch: deps.fetch, scopes: READ_SCOPES })
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

/**
 * Mail in every folder received in [from, until), oldest first, text bodies.
 * /me/messages spans all folders, Junk and Deleted Items included; Sent and
 * Outbox mail is from the company's own domain and Drafts are drafts, so the
 * filters drop them without a folder lookup.
 */
async function listMail(deps, token, { from, until }) {
  const filter = `receivedDateTime ge ${new Date(from).toISOString()}${until ? ` and receivedDateTime lt ${new Date(until).toISOString()}` : ''}`
  const q = new URLSearchParams({
    $filter: filter,
    $orderby: 'receivedDateTime asc',
    $top: String(PAGE),
    $select: 'id,internetMessageId,conversationId,subject,from,sender,receivedDateTime,body,bodyPreview,internetMessageHeaders,webLink,isDraft',
  })
  const res = await deps.fetch(`${GRAPH}/me/messages?${q}`, {
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
  Object.assign(mb, patch)
  await deps.db(`lead_mailboxes?id=eq.${mb.id}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { ...patch, updated_at: deps.now().toISOString() },
  })
}

const emptyCounts = () => ({ seen: 0, skipped: 0, qualified: 0, unqualified: 0, needs_review: 0, duplicate: 0, failed: 0, waiting: 0 })

/**
 * One page of one pass. Plans every message in order (decided, skipped,
 * duplicate, or ask the model), asks in parallel, then stores in order and
 * moves the read point only past what is settled: a failed or unasked
 * message stays ahead of it and is read again next round.
 * Returns { to, counts, finishedPage, listedFull }.
 */
async function readPage(deps, ctx, { mb, token, from, until, budget }) {
  const counts = emptyCounts()
  const listed = await listMail(deps, token, { from, until })
  if (listed.error) return { error: listed.error, counts }
  const msgs = listed.messages
  counts.seen = msgs.length
  const now = deps.now()

  const refs = msgs.map((m) => m.internetMessageId || m.id)
  const convIds = [...new Set(msgs.map((m) => m.conversationId).filter(Boolean))]
  const since = new Date(Date.parse(msgs[0]?.receivedDateTime || now.toISOString()) - 8 * 86_400_000).toISOString()
  const [byRef, byConv, recent] = await Promise.all([
    refs.length ? deps.db(`leads?workspace_id=eq.${mb.workspace_id}&source=eq.email&source_ref=in.(${encodeURIComponent(quoteIn(refs))})&select=source_ref,verdict`) : [],
    convIds.length ? deps.db(`leads?workspace_id=eq.${mb.workspace_id}&conversation_id=in.(${encodeURIComponent(quoteIn(convIds))})&select=conversation_id,source_ref`) : [],
    msgs.length ? deps.db(`leads?workspace_id=eq.${mb.workspace_id}&source=eq.email&received_at=gte.${since}&select=id,source_ref,email,phone,message,received_at&limit=1000`) : [],
  ])
  // A message whose model call failed has a row with no verdict: not decided.
  const decided = new Set((byRef || []).filter((l) => l.verdict).map((l) => l.source_ref))
  const threads = new Map((byConv || []).map((l) => [l.conversation_id, l.source_ref]))
  const known = (recent || []).map((l) => ({ id: l.id, sourceRef: l.source_ref, email: l.email, phone: l.phone, message: l.message, receivedAt: l.received_at }))

  // 1. Plan, in order. Planning stops at the first message the budget cannot cover.
  const plan = []
  let asks = 0
  for (const m of msgs) {
    const ref = m.internetMessageId || m.id
    if (decided.has(ref)) { plan.push({ m, kind: 'seen' }); continue }
    const sameThread = m.conversationId && threads.has(m.conversationId) && threads.get(m.conversationId) !== ref
    if (skipReason(m, { ownDomains: ctx.ownDomains }) || sameThread) { plan.push({ m, kind: 'skip' }); continue }
    const env = messageToEnvelope(m)
    const dup = findDuplicate(env, known.filter((k) => k.sourceRef !== ref), { days: 7 })
    if (dup) { plan.push({ m, kind: 'dup', env, dup }); continue }
    if (asks >= budget.calls || deps.now().getTime() > budget.deadline) break
    asks++
    plan.push({ m, kind: 'ask', env })
    threads.set(m.conversationId, ref)
    known.push({ id: null, sourceRef: ref, email: env.email, phone: '', message: env.message, receivedAt: m.receivedDateTime })
  }

  // 2. Ask the model, a few at a time, inside the time budget and the cap.
  const toAsk = plan.filter((p) => p.kind === 'ask')
  for (let i = 0; i < toAsk.length; i += CONCURRENCY) {
    if (deps.now().getTime() > budget.deadline) break
    const chunk = toAsk.slice(i, i + CONCURRENCY)
    if (!capDecision({ cap: ctx.brand.cap, spent: ctx.spent, estimate: 0.001 * chunk.length }).allowed) {
      for (const p of toAsk.slice(i)) p.cap = true
      break
    }
    budget.calls -= chunk.length
    const outs = await Promise.all(chunk.map((p) => askModel(deps, { workspaceId: mb.workspace_id, env: p.env, brand: ctx.brand })))
    chunk.forEach((p, k) => { p.out = outs[k]; ctx.spent += outs[k].cost || 0 })
  }

  // 3. Store in order; the read point moves only past what is settled.
  let to = from
  let settledAll = true
  for (const p of plan) {
    const m = p.m
    const base = () => ({
      workspace_id: mb.workspace_id, source: 'email', source_ref: m.internetMessageId || m.id, received_at: m.receivedDateTime || null,
      name: p.env.name, company: '', email: p.env.email, phone: '', subject: p.env.subject, message: p.env.message,
      language: p.env.language, mailbox: mb.label || mb.email, link: m.webLink || '', conversation_id: m.conversationId || '',
      updated_at: now.toISOString(),
    })
    if (p.kind === 'seen') { to = m.receivedDateTime; continue }
    if (p.kind === 'skip') { counts.skipped++; to = m.receivedDateTime; continue }
    if (p.kind === 'dup') {
      await upsertLead(deps.db, { ...base(), verdict: 'duplicate', reason: 'Same sender and message as an earlier email.', duplicate_of: p.dup.id || null, error: '' })
      counts.duplicate++; to = m.receivedDateTime; continue
    }
    if (p.cap) {
      await upsertLead(deps.db, { ...base(), verdict: 'needs_review', category: 'unclear', reason: 'Not checked: this month\'s AI budget is used up.', error: 'cap' })
      counts.needs_review++; to = m.receivedDateTime; continue
    }
    if (!p.out) { settledAll = false; break } // not asked in time: next round
    if (p.out.error) {
      await upsertLead(deps.db, { ...base(), model: p.out.model, cost_usd: p.out.cost, error: p.out.error })
      counts.failed++; settledAll = false; break
    }
    const v = p.out.verdict
    await upsertLead(deps.db, {
      ...base(), verdict: v.verdict, category: v.category, confidence: v.confidence, reason: v.reason,
      summary: v.summary, details: v.details, ask_next: v.ask_next, model: p.out.model, cost_usd: p.out.cost, error: '',
    })
    counts[v.verdict]++
    to = m.receivedDateTime
  }
  const planned = plan.length
  if (planned < msgs.length) { settledAll = false; counts.waiting = msgs.length - planned }
  return { to, counts, finishedPage: settledAll, listedFull: msgs.length === PAGE }
}

const addCounts = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k] || 0; return a }

/** Pages through one pass until it is caught up or the budget runs out. */
async function readPass(deps, ctx, { mb, token, from, until, budget }) {
  const counts = emptyCounts()
  let cursor = from
  for (let page = 0; page < 20; page++) {
    const r = await readPage(deps, ctx, { mb, token, from: cursor, until, budget })
    if (r.error) return { error: r.error, counts, to: cursor, caughtUp: false }
    addCounts(counts, r.counts)
    const moved = r.to && Date.parse(r.to) > Date.parse(cursor)
    cursor = r.to || cursor
    if (!r.finishedPage) return { counts, to: cursor, caughtUp: false }
    if (!r.listedFull) return { counts, to: cursor, caughtUp: true }
    // A full page with every message settled: there may be more. A full page
    // all at one timestamp would never move the cursor, so stop rather than spin.
    if (!moved) return { counts, to: cursor, caughtUp: false }
    if (budget.calls <= 0 || deps.now().getTime() > budget.deadline) return { counts, to: cursor, caughtUp: false }
  }
  return { counts, to: cursor, caughtUp: false }
}

/**
 * New mail for one mailbox, then (if budget is left and it is not done) its
 * July–September history. `ctx` is shared across the round's mailboxes.
 */
export async function checkMailbox(deps, { mb, brand, budget, ctx: shared }) {
  const now = deps.now()
  const ctx = shared || { brand, ownDomains: [domainOf(mb.email), domainOf(mb.label)].filter(Boolean), spent: await monthSpent(deps.db, mb.workspace_id, now) }
  const tok = await accessToken(deps, mb)
  const fail = async (err) => {
    const auth = err.kind === 'auth'
    await setMailbox(deps, mb, { status: auth ? 'reconnect' : mb.status, last_checked_at: now.toISOString(), last_error: String(err.reason || err.message).slice(0, 300) })
    return { email: mb.label || mb.email, error: err.reason || err.message, counts: emptyCounts() }
  }
  if (tok.error) return fail(tok.error)

  const live = await readPass(deps, ctx, { mb, token: tok.token, from: mb.read_from, until: null, budget })
  if (live.error) return fail(live.error)
  await setMailbox(deps, mb, { read_from: live.to, last_checked_at: now.toISOString(), last_error: '', status: 'active', last_counts: live.counts })

  let history = null
  if (!mb.history_done && budget.calls > 0 && deps.now().getTime() <= budget.deadline) {
    const from = mb.history_cursor || mb.history_from
    const h = await readPass(deps, ctx, { mb, token: tok.token, from, until: mb.history_until, budget })
    if (!h.error) {
      await setMailbox(deps, mb, { history_cursor: h.to, history_done: h.caughtUp })
      history = { counts: h.counts, done: h.caughtUp, upTo: h.to }
    } else {
      history = { error: h.error.reason || h.error.message }
    }
  }
  return { email: mb.label || mb.email, counts: live.counts, history }
}

/** Every active mailbox of one company: new mail for all of them first, then history. */
export async function checkMail(deps, { workspaceId, calls = MAIL_CALLS_PER_ROUND, deadline = Infinity }) {
  const mailboxes = await deps.db(`lead_mailboxes?workspace_id=eq.${workspaceId}&status=eq.active&select=*&order=created_at`) || []
  if (!mailboxes.length) return { mailboxes: [] }
  const brand = await loadBrand(deps.db, workspaceId)
  const ownDomains = [...new Set(mailboxes.flatMap((mb) => [domainOf(mb.email), domainOf(mb.label)]).filter(Boolean))]
  const ctx = { brand, ownDomains, spent: await monthSpent(deps.db, workspaceId, deps.now()) }
  const budget = { calls, deadline }
  const out = []
  for (const mb of mailboxes) out.push(await checkMailbox(deps, { mb, budget, ctx }))
  return { mailboxes: out }
}

/** The daily safety run: every company with an active mailbox and the agent switched on. */
export async function checkAllMail(deps) {
  const rows = await deps.db('lead_mailboxes?status=eq.active&select=workspace_id') || []
  const out = []
  for (const ws of [...new Set(rows.map((r) => r.workspace_id))]) {
    const [settings] = await deps.db(`lead_agent_settings?workspace_id=eq.${ws}&select=enabled`) || []
    if (settings && settings.enabled === false) continue
    out.push({ workspaceId: ws, ...(await checkMail(deps, { workspaceId: ws, calls: MAIL_CALLS_PER_ROUND, deadline: Date.now() + 200_000 })) })
  }
  return out
}

/** The tenant id inside Microsoft's id_token, or ''. */
export function tenantOf(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken || '').split('.')[1], 'base64url').toString('utf8')).tid || '' } catch { return '' }
}

/**
 * The end of "Connect a mailbox": Microsoft sent back a code. Exchange it for
 * a READ-ONLY token, check the account has a mailbox, store it sealed.
 * `claims.o` marks a mailbox from another Microsoft 365 organisation
 * (clb-sa.com): the code is redeemed at the shared "organizations" endpoint
 * and the mailbox's own tenant is kept for renewals.
 * Returns { ok, email } or { error: <short code for the page> }.
 */
export async function finishConnect(deps, { claims, code, redirectUri }) {
  const config = claims.o ? { ...deps.ms, tenant: 'organizations' } : deps.ms
  let tokens
  try {
    tokens = await exchangeCode({ config, code, redirectUri, fetch: deps.fetch, scopes: READ_SCOPES })
  } catch { return { error: 'token' } }
  if (!tokens.refresh_token) return { error: 'token' }
  const me = await whoAmI({ accessToken: tokens.access_token, fetch: deps.fetch })
  if (!me.ok) return { error: /licence|mailbox/i.test(me.error?.reason || '') ? 'no_mailbox' : 'graph' }
  const email = lower(me.email)
  if (!email.includes('@')) return { error: 'graph' }

  // Shown as the address people write to: an info@ alias when the account has
  // one (a.rak@arak-sa.com answers to info@arak-sa.com).
  let label = email
  try {
    const r = await deps.fetch(`${GRAPH}/me?$select=proxyAddresses`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
    const j = await r.json()
    const info = (j?.proxyAddresses || []).map((a) => lower(String(a).replace(/^smtp:/i, ''))).find((a) => a.startsWith('info@'))
    if (info) label = info
  } catch { /* the primary address will do */ }
  const tenant = claims.o ? tenantOf(tokens.id_token) : ''

  const now = deps.now()
  const [existing] = await deps.db(`lead_mailboxes?workspace_id=eq.${claims.ws}&email=eq.${encodeURIComponent(email)}&select=*`) || []
  let mb = existing
  if (mb) {
    ;[mb] = await deps.db(`lead_mailboxes?id=eq.${mb.id}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { status: 'active', last_error: '', display_name: me.displayName || mb.display_name, label: mb.label || label, tenant: tenant || mb.tenant || '', updated_at: now.toISOString() },
    }) || []
  } else {
    ;[mb] = await deps.db('lead_mailboxes', {
      method: 'POST', prefer: 'return=representation',
      body: {
        workspace_id: claims.ws, email, label, tenant, display_name: me.displayName || '', status: 'active',
        read_from: NEW_LEADS_FROM, created_by: claims.uid || null,
      },
    }) || []
  }
  if (!mb) return { error: 'save' }
  await deps.db('lead_mailbox_secrets?on_conflict=mailbox_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { mailbox_id: mb.id, workspace_id: claims.ws, secret: deps.seal(packTokens(tokens, now.getTime())), updated_at: now.toISOString() },
  })
  return { ok: true, email: label }
}
