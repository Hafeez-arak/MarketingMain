import crypto from 'node:crypto'
import { db, isConfigured } from '../agent/_supabase.js'
import { callModel } from '../agent/_provider.js'
import { loadBrandContext } from '../agent/_context.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { DRAFT_IDENTITY, DRAFT_SCHEMA, draftPrompt, parseDrafts } from '../../src/lib/email/draft.js'
import { renderEmail, marketingProblems, escapeHtml, safeHref } from '../../src/lib/email/render.js'
import { renderDesign, designChecks, hasDesign } from '../../src/lib/email/design.js'
import { isValidEmail, normalizeEmail } from '../../src/lib/email/contacts.js'
import { dailyCap } from '../../src/lib/email/warmup.js'
import { createResend } from './_resend.js'
import {
  launchCampaign, dispatch, applyEvent, unsubscribe, subscribe, verifySvix, loadSettings,
  sendingStats, fromHeader, closeFinished, websiteSignup,
} from './_engine.js'
import { launchColdCampaign, coldTick, readReplies, resolveStuck, resolveStuckByHand } from './_cold.js'
import { sealSecret, openSecret } from './_secrets.js'
import { verifyMailbox, sendFromMailbox } from './_mailbox.js'
import {
  msConfig, signState, openState, authorizeUrl, exchangeCode, whoAmI, packTokens, createGraphMail,
} from './_graph.js'
import { mailboxDomainProblem, domainOf, HARD_MAX_PER_MAILBOX } from '../../src/lib/email/cold.js'

// ─── /api/email/<action> ───────────────────────────────────────────────────
// One Vercel function for the whole Email section. The Hobby plan builds at
// most 12 functions (see api/_vercelFunctionBudget.test.js), so every action
// lives behind this one dynamic route.
//
// Three kinds of caller, three kinds of check:
//
//   signed-in person   POST, Bearer token, workspace_id in the body. The token
//                      proves who; a read of `workspaces` WITH THAT TOKEN
//                      proves membership (RLS answers it). Only then does the
//                      service key touch anything.
//   Resend             POST /webhook, signed (Svix). The signature is the only
//                      proof; RESEND_WEBHOOK_SECRET must be set or every
//                      webhook is refused.
//   the public         GET/POST /unsubscribe?t=<token>. The token is the only
//                      key, and all it can do is unsubscribe its own address.
//                      GET/POST /subscribe?t=<token>, the same token: all it
//                      can do is sign its own address up to the newsletter.
//   Vercel Cron        GET /cron with Bearer CRON_SECRET: the morning run.
//   n8n (the box)      GET /cold-tick with Bearer CRON_SECRET, every 10
//                      minutes: the cold lane's sending run.
//   the website        POST /website-signup from arak-sa.com's contact form,
//                      with the form's key. All it can do is add or file one
//                      marketing contact who ticked the marketing box.
//   Microsoft          GET /ms-callback?code&state after someone signs in as
//                      a Microsoft 365 mailbox. The signed state (and the
//                      cookie set by /ms_connect_start) is the only proof.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const RESEND_KEY = process.env.RESEND_API_KEY || ''
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || ''
const CRON_SECRET = process.env.CRON_SECRET || ''
const MS = msConfig()

// ─── Plumbing ──────────────────────────────────────────────────────────────

function bearerOf(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

async function readRaw(req) {
  // Read the stream BEFORE anything touches req.body: the webhook signature is
  // over the exact bytes, and a re-serialised object is not those bytes.
  if (typeof req.rawBody === 'string') return req.rawBody
  const chunks = []
  try { for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) } catch { /* no stream */ }
  if (chunks.length) return Buffer.concat(chunks).toString('utf8')
  if (typeof req.body === 'string') return req.body
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body)
  return ''
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const raw = await readRaw(req)
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

/** Exact row count for a PostgREST path (service key). */
async function count(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${path.includes('?') ? '&' : '?'}limit=1`, {
    method: 'HEAD',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' },
  })
  if (!res.ok) throw new Error(`Supabase count ${res.status}`)
  const range = res.headers.get('content-range') || ''
  const total = Number(range.split('/')[1])
  return Number.isFinite(total) ? total : 0
}

function baseUrlOf(req) {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, '')
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || ''
  const proto = req.headers?.['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https')
  return host ? `${proto}://${host}` : ''
}

function html(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).send(body)
}

async function authenticate(token) {
  if (!token) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    const user = await r.json()
    return user?.id ? user : null
  } catch { return null }
}

// Membership asked WITH THE CALLER'S TOKEN, so RLS answers it. A service-key
// read would return any workspace on earth.
async function isMember(workspaceId, token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(workspaceId || ''))) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=id`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return false
    const rows = await r.json()
    return Array.isArray(rows) && rows.length === 1
  } catch { return false }
}

const deps = () => ({ db, count, resend: createResend({ apiKey: RESEND_KEY }) })

// Microsoft 365 mailboxes: Graph, with renewed tokens sealed back as they come.
const graphMail = () => createGraphMail({
  config: MS,
  save: (mb, plain) => db('email_mailbox_secrets?on_conflict=mailbox_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { mailbox_id: mb.id, workspace_id: mb.workspace_id, secret: sealSecret(plain, SERVICE_KEY), updated_at: new Date().toISOString() },
  }),
})

/** Send by the mailbox's provider: Microsoft through Graph, the rest over SMTP. */
const sendBy = (mb, secret, message) => (mb.provider === 'microsoft'
  ? graphMail().send(mb, secret, message)
  : sendFromMailbox(mb, secret, message))

// The cold lane's IO: our own mailboxes, never Resend. `baseUrl` builds each
// email's newsletter sign-up link.
const coldDeps = (req = null) => ({
  db, count, baseUrl: req ? baseUrlOf(req) : '',
  mail: {
    send: sendBy,
    inbox: (mb, secret, since) => graphMail().inbox(mb, secret, since),
    findSent: (mb, secret, q) => graphMail().findSent(mb, secret, q),
  },
  open: sealed => openSecret(sealed, SERVICE_KEY),
  uuid: () => crypto.randomUUID(),
  random: Math.random,
})

function needResend() {
  return RESEND_KEY ? null
    // Said plainly, without setup instructions: those live in
    // docs/EMAIL-SETUP.md, not in front of everyone who uses the app.
    : 'Email sending is not switched on yet.'
}

const isUuid = v => /^[0-9a-f-]{36}$/i.test(String(v || ''))

// ─── Signed-in actions ─────────────────────────────────────────────────────

const actions = {
  /** Everything the Overview and Settings need to know about sending. */
  async status({ workspaceId }) {
    const settings = await loadSettings({ db }, workspaceId)
    const stats = await sendingStats({ count }, { workspaceId })
    const cap = dailyCap({ settings, today: stats.today, sentToday: stats.sentToday, sentThisMonth: stats.sentThisMonth, recent: stats.recent })
    return {
      // cron covers both the morning marketing run and the cold sending run:
      // n8n calls /cold-tick with the same secret.
      configured: { resend: Boolean(RESEND_KEY), webhook: Boolean(WEBHOOK_SECRET), cron: Boolean(CRON_SECRET), microsoft: MS.configured },
      settings, stats, cap,
    }
  },

  async send_test({ workspaceId, body, user }) {
    const missing = needResend(); if (missing) return fail(missing, 503)
    const to = normalizeEmail(body.to || user?.email)
    if (!isValidEmail(to)) return fail('Enter a valid address to send the test to.')
    const settings = await loadSettings({ db }, workspaceId)
    // A cold draft may be tested too: one email to ourselves is not outreach.
    // What Resend's terms forbid is sending it to the prospects.
    const audience = body.audience === 'cold' ? 'cold' : 'marketing'
    if (!settings.from_email) return fail('Set the sender address in Email → Settings first.')
    const sample = { first_name: body.sample?.first_name || 'Sara', last_name: '', company: body.sample?.company || 'Example Co', job_title: '', city: 'Riyadh', email: to }
    const common = {
      subject: `[TEST] ${body.subject || ''}`, preheader: body.preheader || '',
      language: body.language === 'ar' ? 'ar' : 'en', contact: sample,
      sender: settings, unsubscribeUrl: `${baseUrlOf(this.req)}/api/email/unsubscribe?t=test`,
      subscribeUrl: `${baseUrlOf(this.req)}/api/email/subscribe?t=test`,
    }
    // Cold email is never designed: it must look typed by a person.
    const rendered = audience === 'marketing' && hasDesign(body.design)
      ? renderDesign({ ...common, design: body.design })
      : renderEmail({ ...common, audience, body: body.body || '' })
    const r = await deps().resend.send({
      from: fromHeader(settings), to: [to], subject: rendered.subject, html: rendered.html, text: rendered.text,
      ...(settings.reply_to ? { reply_to: settings.reply_to } : {}),
    })
    if (!r.ok) return fail(r.error, r.status >= 400 && r.status < 600 ? r.status : 502)
    return { sent_to: to, id: r.id }
  },

  async launch({ workspaceId, body }) {
    if (!isUuid(body.campaign_id)) return fail('campaign_id is required.')
    const when = body.when === 'schedule' ? 'schedule' : 'now'
    if (when === 'schedule' && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) return fail('Pick a date to schedule for.')
    const [lane] = await db(`email_campaigns?id=eq.${body.campaign_id}&workspace_id=eq.${workspaceId}&select=audience`) || []
    if (lane?.audience === 'cold') {
      // Cold goes out from our own mailboxes on the next sending runs, never
      // through Resend, so it needs no Resend key and sends nothing here.
      const out = await launchColdCampaign({ db }, { workspaceId, campaignId: body.campaign_id, when, scheduleDate: body.date })
      if (out.error) return fail(out.error, out.status || 400)
      return out
    }
    const missing = needResend(); if (missing) return fail(missing, 503)
    const settings = await loadSettings({ db }, workspaceId)
    const out = await launchCampaign({ db }, { workspaceId, campaignId: body.campaign_id, when, scheduleDate: body.date, settings })
    if (out.error) return fail(out.error, out.status || 400)
    let dispatched = null
    if (!out.scheduled) dispatched = await dispatch(deps(), { workspaceId, baseUrl: baseUrlOf(this.req) })
    return { ...out, dispatched }
  },

  /** Send whatever is due now. Also called when the Email page opens. */
  async dispatch({ workspaceId }) {
    if (!RESEND_KEY) return { dispatched: null, skipped: 'no key' }
    return { dispatched: await dispatch(deps(), { workspaceId, baseUrl: baseUrlOf(this.req) }) }
  },

  async pause({ workspaceId, body }) {
    if (!isUuid(body.campaign_id)) return fail('campaign_id is required.')
    await db(`email_campaigns?id=eq.${body.campaign_id}&workspace_id=eq.${workspaceId}&status=in.(sending,scheduled)`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'paused', updated_at: new Date().toISOString() },
    })
    return { paused: body.campaign_id }
  },

  async resume({ workspaceId, body }) {
    if (!isUuid(body.campaign_id)) return fail('campaign_id is required.')
    await db(`email_campaigns?id=eq.${body.campaign_id}&workspace_id=eq.${workspaceId}&status=eq.paused`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'sending', updated_at: new Date().toISOString() },
    })
    const dispatched = RESEND_KEY ? await dispatch(deps(), { workspaceId, baseUrl: baseUrlOf(this.req) }) : null
    return { resumed: body.campaign_id, dispatched }
  },

  async cancel({ workspaceId, body }) {
    if (!isUuid(body.campaign_id)) return fail('campaign_id is required.')
    const now = new Date().toISOString()
    await db(`email_sends?campaign_id=eq.${body.campaign_id}&workspace_id=eq.${workspaceId}&status=eq.queued`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', error: 'Campaign cancelled', updated_at: now },
    })
    await db(`email_campaigns?id=eq.${body.campaign_id}&workspace_id=eq.${workspaceId}&status=in.(sending,scheduled,paused)`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', updated_at: now },
    })
    return { cancelled: body.campaign_id }
  },

  /** Three AI options, from the Brand Brain and recent research. */
  async draft({ workspaceId, body }) {
    const audience = body.audience === 'cold' ? 'cold' : 'marketing'
    const language = body.language === 'ar' ? 'ar' : 'en'
    const ws = encodeURIComponent(workspaceId)
    let contact = null
    let opportunity = null
    if (isUuid(body.contact_id)) {
      ;[contact] = await db(`email_contacts?id=eq.${body.contact_id}&workspace_id=eq.${ws}&select=*`) || []
      if (contact?.opportunity_id) {
        ;[opportunity] = await db(`research_opportunities?id=eq.${contact.opportunity_id}&workspace_id=eq.${ws}&select=*`) || []
      }
    }
    if (!opportunity && isUuid(body.opportunity_id)) {
      ;[opportunity] = await db(`research_opportunities?id=eq.${body.opportunity_id}&workspace_id=eq.${ws}&select=*`) || []
    }
    // What the research agent found lately. Failing to read it is not a reason
    // to fail the draft — the brand block alone still makes a good email.
    const [opportunities, events, signals] = await Promise.all([
      db(`research_opportunities?workspace_id=eq.${ws}&status=in.(new,assigned,pursued)&order=last_seen_at.desc&limit=6&select=name,headline,location`).catch(() => []),
      db(`research_events?workspace_id=eq.${ws}&status=eq.upcoming&order=start_date.asc.nullslast&limit=5&select=name,start_date,city,recommendation`).catch(() => []),
      db(`research_signals?workspace_id=eq.${ws}&competitor=eq.&relevance=eq.high&order=last_seen_at.desc&limit=6&select=summary`).catch(() => []),
    ])

    const { brand } = await loadBrandContext(workspaceId, 'caption')
    const out = await callModel({
      workspaceId, job: 'email', surface: 'chat', stage: `email-draft:${audience}`,
      identity: DRAFT_IDENTITY, brand,
      messages: [{
        role: 'user',
        content: draftPrompt({
          audience, language, brief: String(body.brief || '').slice(0, 2000),
          current: body.current && typeof body.current === 'object'
            ? { subject: String(body.current.subject || '').slice(0, 300), body: String(body.current.body || '').slice(0, 6000) }
            : null,
          contact, opportunity,
          research: { opportunities, events, signals },
        }),
      }],
      maxTokens: 6_000,
      effort: 'medium',
      outputFormat: DRAFT_SCHEMA,
    })
    if (out.refused) return { ok: false, capped: true, error: out.error, options: [] }
    if (!out.ok) return fail(out.error || 'The draft could not be written.', 502)
    const parsed = parseDrafts(textIn(out.response))
    if (!parsed.ok) return fail(parsed.error, 502)
    return { options: parsed.options, cost: out.cost || 0 }
  },

  // ── Outreach mailboxes ──
  // Every write goes through here (RLS lets people only read them): the
  // domain is checked, the login is proven before anything is stored, and
  // the password is stored sealed, in a table nobody but the server reads.

  async mailbox_save({ workspaceId, body, user }) {
    const input = body.mailbox || {}
    const id = isUuid(input.id) ? input.id : null
    const [existing] = id ? await db(`email_mailboxes?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*`) || [] : []
    if (id && !existing) return fail('That mailbox is not in this workspace.', 404)
    if (existing?.provider === 'microsoft') return saveMicrosoftSettings({ workspaceId, existing, input })
    if (input.provider === 'microsoft') return fail('A Microsoft 365 mailbox is connected by signing in: use "Connect Microsoft 365".')

    const email = normalizeEmail(input.email ?? existing?.email)
    const settings = await loadSettings({ db }, workspaceId)
    const problem = mailboxDomainProblem(email, [settings.from_email, settings.reply_to, user?.email].map(domainOf))
    if (problem) return fail(problem)

    const row = {
      email,
      from_name: String(input.from_name ?? existing?.from_name ?? '').replace(/[<>"]/g, '').trim().slice(0, 100),
      signature: String(input.signature ?? existing?.signature ?? '').slice(0, 1000),
      smtp_host: String(input.smtp_host ?? existing?.smtp_host ?? '').trim().toLowerCase(),
      smtp_port: Number(input.smtp_port ?? existing?.smtp_port ?? 465),
      imap_host: String(input.imap_host ?? existing?.imap_host ?? '').trim().toLowerCase(),
      imap_port: Number(input.imap_port ?? existing?.imap_port ?? 993),
      username: normalizeEmail(input.username ?? existing?.username ?? '') || email,
      daily_limit: Math.max(0, Math.min(HARD_MAX_PER_MAILBOX, Math.round(Number(input.daily_limit ?? existing?.daily_limit ?? 15)) || 0)),
      warmup_started_on: /^\d{4}-\d{2}-\d{2}$/.test(String(input.warmup_started_on || ''))
        ? input.warmup_started_on
        : (input.warmup_started_on === null || input.warmup_started_on === '' ? null : existing?.warmup_started_on ?? null),
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(row.smtp_host) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(row.imap_host)) {
      return fail('Enter the sending (SMTP) and reading (IMAP) server names.')
    }
    if (![row.smtp_port, row.imap_port].every(p => Number.isInteger(p) && p > 0 && p < 65536)) return fail('The ports must be numbers.')

    // Google shows app passwords in groups of four; the spaces are not part of it.
    const typed = String(body.password || '')
    const given = row.smtp_host === 'smtp.gmail.com' ? typed.replace(/\s+/g, '') : typed
    const connectionChanged = !existing || ['email', 'username', 'smtp_host', 'smtp_port', 'imap_host', 'imap_port']
      .some(k => String(row[k]) !== String(existing[k]))
    const stored = existing ? openSecret((await db(`email_mailbox_secrets?mailbox_id=eq.${existing.id}&select=secret`) || [])[0]?.secret, SERVICE_KEY) : null
    const password = given || stored
    if (!password) return fail(existing ? 'Paste the app password again to reconnect this mailbox.' : 'Paste the mailbox\'s app password.')

    const now = new Date().toISOString()
    if (given || connectionChanged || existing?.status === 'error') {
      const check = await verifyMailbox(row, password)
      if (!check.ok) return fail(check.error)
      Object.assign(row, { last_checked_at: now, last_error: '' })
      // A mailbox that failed its login is fixed by a login that works.
      if (!existing || existing.status === 'error') Object.assign(row, { status: 'active', status_reason: '' })
    }

    let saved
    if (existing) {
      ;[saved] = await db(`email_mailboxes?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`, {
        method: 'PATCH', prefer: 'return=representation', body: { ...row, updated_at: now },
      }) || []
    } else {
      const dupe = await db(`email_mailboxes?workspace_id=eq.${workspaceId}&email=eq.${encodeURIComponent(email)}&select=id`) || []
      if (dupe.length) return fail('That mailbox is already connected.')
      ;[saved] = await db('email_mailboxes', {
        method: 'POST', prefer: 'return=representation',
        body: { ...row, workspace_id: workspaceId, provider: 'smtp', created_by: user?.id || null },
      }) || []
    }
    if (!saved) return fail('The mailbox could not be saved.', 500)
    if (given) {
      await db('email_mailbox_secrets?on_conflict=mailbox_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { mailbox_id: saved.id, workspace_id: workspaceId, secret: sealSecret(given, SERVICE_KEY), updated_at: now },
      })
    }
    return { mailbox: saved, verified: Boolean(row.last_checked_at) }
  },

  async mailbox_pause({ workspaceId, body, user }) {
    if (!isUuid(body.mailbox_id)) return fail('mailbox_id is required.')
    const [mb] = await db(`email_mailboxes?id=eq.${body.mailbox_id}&workspace_id=eq.${workspaceId}&select=id,status`) || []
    if (!mb) return fail('That mailbox is not in this workspace.', 404)
    if (!body.paused && mb.status === 'error') return fail('This mailbox\'s login stopped working. Reconnect it to resume.')
    await db(`email_mailboxes?id=eq.${mb.id}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: body.paused
        ? { status: 'paused', status_reason: `Paused by ${user?.email || 'a person'}.`, updated_at: new Date().toISOString() }
        : { status: 'active', status_reason: '', updated_at: new Date().toISOString() },
    })
    return { mailbox_id: mb.id, paused: Boolean(body.paused) }
  },

  async mailbox_delete({ workspaceId, body }) {
    if (!isUuid(body.mailbox_id)) return fail('mailbox_id is required.')
    const now = new Date().toISOString()
    // Follow-ups belong to their thread's mailbox; without it they cannot go.
    await db(`email_sends?workspace_id=eq.${workspaceId}&mailbox_id=eq.${body.mailbox_id}&status=eq.queued`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', error: 'Mailbox removed', updated_at: now },
    })
    await db(`email_mailboxes?id=eq.${body.mailbox_id}&workspace_id=eq.${workspaceId}`, { method: 'DELETE', prefer: 'return=minimal' })
    return { deleted: body.mailbox_id }
  },

  /** One email from a mailbox to the person asking: proves it lands, sends nothing to prospects. */
  async mailbox_test({ workspaceId, body, user }) {
    if (!isUuid(body.mailbox_id)) return fail('Choose a mailbox to send the test from.')
    const [mb] = await db(`email_mailboxes?id=eq.${body.mailbox_id}&workspace_id=eq.${workspaceId}&select=*`) || []
    if (!mb) return fail('That mailbox is not in this workspace.', 404)
    const to = normalizeEmail(body.to || user?.email)
    if (!isValidEmail(to)) return fail('Enter a valid address to send the test to.')
    const password = openSecret((await db(`email_mailbox_secrets?mailbox_id=eq.${mb.id}&select=secret`) || [])[0]?.secret, SERVICE_KEY)
    if (!password) return fail('This mailbox\'s login can no longer be read. Reconnect it.')
    const sample = { first_name: body.sample?.first_name || 'Sara', last_name: body.sample?.last_name || '', company: body.sample?.company || 'Example Co', job_title: '', city: 'Riyadh', email: to }
    const rendered = renderEmail({
      audience: 'cold',
      subject: `[TEST] ${body.subject || 'Outreach mailbox check'}`,
      body: body.body || 'Hi {{first_name|there}},\n\nThis is a test from the outreach mailbox. If it arrived in the inbox (not spam or Promotions), this mailbox is ready.',
      language: body.language === 'ar' ? 'ar' : 'en', contact: sample, signature: mb.signature,
      subscribeUrl: `${baseUrlOf(this.req)}/api/email/subscribe?t=test`,
    })
    const r = await sendBy(mb, password, {
      from: { name: mb.from_name || '', address: mb.email }, to: { name: '', address: to },
      subject: rendered.subject, text: rendered.text, html: rendered.html,
      messageId: `<${crypto.randomUUID()}@${domainOf(mb.email)}>`,
    })
    if (!r.ok) return fail(String(r.error?.reason || r.error?.response || r.error?.message || 'The test could not be sent.').slice(0, 300), 502)
    return { sent_to: to, from: mb.email }
  },

  /**
   * Start signing in as a Microsoft 365 mailbox. Returns the Microsoft URL
   * to send the browser to, and sets the cookie the callback checks.
   * body.mailbox_id: reconnect that mailbox (the same account must sign in).
   */
  async ms_connect_start({ workspaceId, body, user }) {
    if (!MS.configured) return fail('Microsoft sign-in is not switched on yet.', 503)
    let loginHint = ''
    if (body.mailbox_id) {
      if (!isUuid(body.mailbox_id)) return fail('mailbox_id is not valid.')
      const [mb] = await db(`email_mailboxes?id=eq.${body.mailbox_id}&workspace_id=eq.${workspaceId}&provider=eq.microsoft&select=id,email`) || []
      if (!mb) return fail('That Microsoft mailbox is not in this workspace.', 404)
      loginHint = mb.email
    }
    const nonce = crypto.randomBytes(16).toString('base64url')
    const state = signState({ ws: workspaceId, uid: user.id, mb: body.mailbox_id || null, n: nonce }, SERVICE_KEY)
    const secure = /^https:/.test(baseUrlOf(this.req)) ? '; Secure' : ''
    this.res.setHeader('Set-Cookie', `ms_oauth=${nonce}; Path=/api/email; HttpOnly; SameSite=Lax; Max-Age=900${secure}`)
    return { url: authorizeUrl({ config: MS, redirectUri: `${baseUrlOf(this.req)}/api/email/ms-callback`, state, loginHint }) }
  },

  /** A person's answer for an email stuck in 'sending': it went out, send it again, or drop it. */
  async stuck_resolve({ workspaceId, body, user }) {
    if (!isUuid(body.send_id)) return fail('send_id is required.')
    if (!['sent', 'retry', 'drop'].includes(body.outcome)) return fail('Choose sent, retry or drop.')
    const out = await resolveStuckByHand({ db }, { workspaceId, sendId: body.send_id, outcome: body.outcome, by: user?.email || '' })
    if (out.error) return fail(out.error, out.status || 400)
    return out
  },

  /** "What goes out next": the sending run, decided but not done. */
  async cold_preview({ workspaceId }) {
    return { preview: await coldTick(coldDeps(), { dryRun: true, workspaceId }) }
  },

  /** Is the campaign ready to send? The same check launch makes. */
  async check({ workspaceId, body }) {
    const settings = await loadSettings({ db }, workspaceId)
    const designed = hasDesign(body.design)
    return { problems: [
      ...marketingProblems({ subject: body.subject, body: designed ? 'designed' : body.body, sender: settings }),
      ...(designed ? designChecks(body.design).problems : []),
    ] }
  },
}

function fail(error, status = 400) {
  return { __fail: true, status, error }
}

/** A Microsoft mailbox's editable settings. Its address and login come from Microsoft. */
async function saveMicrosoftSettings({ workspaceId, existing, input }) {
  const row = {
    from_name: String(input.from_name ?? existing.from_name ?? '').replace(/[<>"]/g, '').trim().slice(0, 100),
    signature: String(input.signature ?? existing.signature ?? '').slice(0, 1000),
    daily_limit: Math.max(0, Math.min(HARD_MAX_PER_MAILBOX, Math.round(Number(input.daily_limit ?? existing.daily_limit ?? 15)) || 0)),
    warmup_started_on: /^\d{4}-\d{2}-\d{2}$/.test(String(input.warmup_started_on || ''))
      ? input.warmup_started_on
      : (input.warmup_started_on === null || input.warmup_started_on === '' ? null : existing.warmup_started_on ?? null),
    updated_at: new Date().toISOString(),
  }
  const [saved] = await db(`email_mailboxes?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', prefer: 'return=representation', body: row,
  }) || []
  if (!saved) return fail('The mailbox could not be saved.', 500)
  return { mailbox: saved, verified: false }
}

// ─── Public endpoints ──────────────────────────────────────────────────────

function unsubscribePage({ title, message, form = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f4f3f0;color:#1a1a1a;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border-radius:10px;max-width:440px;width:100%;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 10px}p{line-height:1.5;color:#444}
button{background:#1a1a1a;color:#fff;border:0;border-radius:6px;padding:12px 18px;font-size:15px;cursor:pointer}.ar{direction:rtl;text-align:right;color:#666;margin-top:18px;border-top:1px solid #eee;padding-top:14px}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>${form}</div></body></html>`
}

async function handleUnsubscribe(req, res) {
  const url = new URL(req.url || '/', 'http://x')
  const token = String(req.query?.t || url.searchParams.get('t') || '')
  if (token === 'test') {
    return html(res, 200, unsubscribePage({ title: 'This is a test email', message: 'In a real email, this link unsubscribes the person it was sent to.' }))
  }
  // GET only asks. Corporate mail scanners open every link in an email; if a
  // GET unsubscribed, half a company's recipients would be removed by their
  // own firewall. The mail client's one-click button and the form below POST.
  if (req.method === 'GET') {
    const safe = encodeURIComponent(token)
    return html(res, 200, unsubscribePage({
      title: 'Unsubscribe',
      message: 'Stop receiving marketing emails from us? You can always ask to be added back.',
      form: `<form method="post" action="?t=${safe}"><button type="submit">Unsubscribe</button></form>
<p class="ar">هل تريد إيقاف رسائلنا التسويقية؟ اضغط الزر أعلاه لإلغاء الاشتراك.</p>`,
    }))
  }
  if (req.method !== 'POST') return res.status(405).send('')
  const out = await unsubscribe({ db }, token)
  if (!out.ok) {
    return html(res, 404, unsubscribePage({ title: 'Link not recognised', message: 'This unsubscribe link is not valid. Reply to the email and we will remove you by hand.' }))
  }
  return html(res, 200, unsubscribePage({
    title: 'You are unsubscribed',
    message: `${out.email} will not receive marketing emails from us again.`,
    form: '<p class="ar">تم إلغاء اشتراكك ولن تصلك رسائلنا التسويقية بعد الآن.</p>',
  }))
}

// ─── Newsletter sign-up from an outreach email ─────────────────────────────
// The button in a cold email links here with the contact's own token. Like
// unsubscribe, GET only asks: a corporate link scanner opening every link
// must not sign a whole company up. The person's press on the page POSTs.

function subscribeCopy(settings = {}) {
  const e = s => escapeHtml(String(s || '').trim())
  const name = e(settings.newsletter_name) || (e(settings.from_name) ? `the ${e(settings.from_name)} newsletter` : 'our newsletter')
  const offer = e(settings.subscribe_offer)
  return { name, offer, gift: safeHref(settings.subscribe_gift_url) }
}

async function handleSubscribe(req, res) {
  const url = new URL(req.url || '/', 'http://x')
  const token = String(req.query?.t || url.searchParams.get('t') || '')
  if (token === 'test') {
    return html(res, 200, unsubscribePage({ title: 'This is a test email', message: 'In a real email, this button signs up the person it was sent to.' }))
  }
  const safe = encodeURIComponent(token)
  if (req.method === 'GET') {
    const [contact] = /^[0-9a-f-]{36}$/i.test(token)
      ? await db(`email_contacts?unsubscribe_token=eq.${token}&select=workspace_id,subscribed_at`) || []
      : []
    if (!contact) {
      return html(res, 404, unsubscribePage({ title: 'Link not recognised', message: 'This sign-up link is not valid. Reply to the email and we will add you by hand.' }))
    }
    const c = subscribeCopy(await loadSettings({ db }, contact.workspace_id))
    return html(res, 200, unsubscribePage({
      title: `Join ${c.name}`,
      message: c.offer
        ? `Confirm below and we will send you <strong>${c.offer}</strong>, then our newsletter. Unsubscribe any time.`
        : 'Confirm below to get our emails. Unsubscribe any time.',
      form: `<form method="post" action="?t=${safe}"><button type="submit">Yes, subscribe me</button></form>
<p class="ar">اضغط الزر أعلاه لتأكيد اشتراكك. يمكنك إلغاء الاشتراك في أي وقت.</p>`,
    }))
  }
  if (req.method !== 'POST') return res.status(405).send('')
  const out = await subscribe({ db }, token)
  if (!out.ok) {
    return html(res, 404, unsubscribePage({ title: 'Link not recognised', message: 'This sign-up link is not valid. Reply to the email and we will add you by hand.' }))
  }
  const c = subscribeCopy(out.settings)
  const gift = c.gift
    ? `<p><a href="${escapeHtml(c.gift)}" style="display:inline-block;background:#1a1a1a;color:#fff;border-radius:6px;padding:12px 18px;text-decoration:none">${c.offer ? 'Download the guide' : 'Open your gift'}</a></p>`
    : ''
  return html(res, 200, unsubscribePage({
    title: out.already ? 'You are already subscribed' : 'You are subscribed',
    message: `${escapeHtml(out.email)} is on the list for ${c.name}.${c.offer && !c.gift ? ` We will email you ${c.offer} shortly.` : ''}`,
    form: `${gift}<p class="ar">تم تأكيد اشتراكك. شكراً لك!</p>`,
  }))
}

// Where the website's contact form may post from. The key in the body is
// what picks the workspace; this only stops other sites' pages using it.
const SIGNUP_ORIGINS = [/^https:\/\/(www\.)?arak-sa\.com$/, /^http:\/\/localhost(:\d+)?$/]

async function handleWebsiteSignup(req, res) {
  const origin = String(req.headers?.origin || '')
  if (SIGNUP_ORIGINS.some(re => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  } else if (origin) {
    return res.status(403).json({ ok: false, error: 'Not allowed from this site.' })
  }
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false })
  // Sent as text/plain by the site (no preflight); the body is JSON either way.
  const body = await readJson(req)
  const out = await websiteSignup({ db }, { key: body.key, input: body })
  return res.status(out.ok ? 200 : out.status || 400).json(out.ok ? { ok: true, added: out.added } : { ok: false, error: out.error })
}

async function handleWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false })
  if (!WEBHOOK_SECRET) {
    return res.status(503).json({ ok: false, error: 'RESEND_WEBHOOK_SECRET is not set, so webhooks cannot be verified and are refused.' })
  }
  const raw = await readRaw(req)
  const ok = verifySvix({
    secret: WEBHOOK_SECRET,
    id: req.headers['svix-id'], timestamp: req.headers['svix-timestamp'], signature: req.headers['svix-signature'],
    body: raw,
  })
  if (!ok) return res.status(401).json({ ok: false, error: 'Bad signature' })
  let event
  try { event = JSON.parse(raw) } catch { return res.status(400).json({ ok: false, error: 'Bad JSON' }) }
  try {
    const out = await applyEvent({ db }, event)
    return res.status(200).json({ ok: true, ...out })
  } catch (err) {
    // 500 makes Resend retry, which is what we want for a database blip.
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 200) })
  }
}

async function handleCron(req, res) {
  if (!CRON_SECRET || bearerOf(req) !== CRON_SECRET) return res.status(401).json({ ok: false })
  if (!RESEND_KEY) return res.status(503).json({ ok: false, error: 'RESEND_API_KEY is not set.' })
  // Every workspace with something due. Distinct in code: PostgREST has no
  // DISTINCT, and the list is small.
  const now = new Date().toISOString()
  const due = await db(`email_sends?status=eq.queued&due_at=lte.${now}&select=workspace_id&limit=1000`) || []
  const scheduled = await db(`email_campaigns?status=eq.scheduled&scheduled_for=lte.${now}&select=workspace_id`) || []
  const workspaces = [...new Set([...due, ...scheduled].map(r => r.workspace_id))]
  const results = {}
  for (const workspaceId of workspaces) {
    try { results[workspaceId] = await dispatch(deps(), { workspaceId, baseUrl: baseUrlOf(req) }) }
    catch (err) { results[workspaceId] = { error: String(err.message || err).slice(0, 200) } }
  }
  const sending = await db('email_campaigns?status=eq.sending&select=workspace_id') || []
  for (const workspaceId of new Set(sending.map(r => r.workspace_id))) {
    await closeFinished({ db, count }, { workspaceId }).catch(() => {})
  }
  return res.status(200).json({ ok: true, workspaces: workspaces.length, results })
}

async function handleColdTick(req, res) {
  if (!CRON_SECRET || bearerOf(req) !== CRON_SECRET) return res.status(401).json({ ok: false })
  // Replies first: an answer that arrived since the last run must stop its
  // follow-up before this run could send it.
  let inbox
  try { inbox = MS.configured ? await readReplies(coldDeps()) : { skipped: 'Microsoft sign-in is not configured.' } }
  catch (err) { inbox = { error: String(err?.message || err).slice(0, 300) } }
  // Then emails a dead run left half-sent: settled from Sent Items where the
  // mailbox can say, otherwise marked for a person. Before sending, so a
  // stuck first email that did leave queues its follow-up on time.
  let stuck
  try { stuck = await resolveStuck(coldDeps()) }
  catch (err) { stuck = { error: String(err?.message || err).slice(0, 300) } }
  const out = await coldTick(coldDeps(req))
  return res.status(200).json({ ok: true, ...out, inbox, stuck })
}

// ─── Microsoft sign-in callback ────────────────────────────────────────────
// Microsoft sends the browser here after someone signs in as a mailbox. The
// state proves which member of which workspace started it; the cookie proves
// it is the same browser. The mailbox is stored only once Microsoft has
// given tokens AND the account has a working mailbox. Errors travel back as
// a short code, never as text or an address in the URL.

function cookieOf(req, name) {
  const raw = String(req.headers?.cookie || '')
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return ''
}

async function handleMsCallback(req, res) {
  const base = baseUrlOf(req)
  const url = new URL(req.url || '/', 'http://x')
  const q = key => String(req.query?.[key] ?? url.searchParams.get(key) ?? '')
  res.setHeader('Set-Cookie', 'ms_oauth=; Path=/api/email; HttpOnly; SameSite=Lax; Max-Age=0')
  res.setHeader('Cache-Control', 'no-store')
  const back = params => {
    res.setHeader('Location', `${base}/email?tab=settings&${new URLSearchParams(params)}`)
    return res.status(302).end()
  }

  const claims = openState(q('state'), SERVICE_KEY)
  if (!claims) return back({ ms_error: 'expired' })
  const nonce = cookieOf(req, 'ms_oauth')
  if (!nonce || nonce !== claims.n) return back({ ms_error: 'browser' })
  if (q('error')) return back({ ms_error: /consent/i.test(q('error') + q('error_description')) ? 'consent' : 'denied' })
  if (!q('code') || !MS.configured) return back({ ms_error: 'config' })

  let tokens
  try {
    tokens = await exchangeCode({ config: MS, code: q('code'), redirectUri: `${base}/api/email/ms-callback` })
  } catch {
    return back({ ms_error: 'token' })
  }
  if (!tokens.refresh_token) return back({ ms_error: 'token' })

  const me = await whoAmI({ accessToken: tokens.access_token })
  if (!me.ok) return back({ ms_error: /licence|mailbox/i.test(me.error?.reason || '') ? 'no_mailbox' : 'graph' })
  const email = normalizeEmail(me.email)
  // A personal Outlook.com account is never an outreach sender. The company
  // domain is allowed here, by the owner's decision (see cold.js).
  if (!isValidEmail(email) || mailboxDomainProblem(email, [])) return back({ ms_error: 'personal' })

  const now = new Date().toISOString()
  const ws = claims.ws
  let [mb] = claims.mb
    ? await db(`email_mailboxes?id=eq.${claims.mb}&workspace_id=eq.${ws}&select=*`) || []
    : await db(`email_mailboxes?workspace_id=eq.${ws}&email=eq.${encodeURIComponent(email)}&select=*`) || []
  if (claims.mb && !mb) return back({ ms_error: 'gone' })
  if (mb && mb.email !== email) return back({ ms_error: 'wrong_account' })
  if (mb && mb.provider !== 'microsoft') return back({ ms_error: 'taken' })

  if (mb) {
    ;[mb] = await db(`email_mailboxes?id=eq.${mb.id}&workspace_id=eq.${ws}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { status: 'active', status_reason: '', last_error: '', last_checked_at: now, updated_at: now },
    }) || []
  } else {
    ;[mb] = await db('email_mailboxes', {
      method: 'POST', prefer: 'return=representation',
      body: {
        workspace_id: ws, provider: 'microsoft', email, username: email,
        from_name: me.displayName.replace(/[<>"]/g, '').slice(0, 100),
        daily_limit: 15, status: 'active', last_checked_at: now, created_by: claims.uid || null,
      },
    }) || []
  }
  if (!mb) return back({ ms_error: 'save' })
  await db('email_mailbox_secrets?on_conflict=mailbox_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { mailbox_id: mb.id, workspace_id: ws, secret: sealSecret(packTokens(tokens), SERVICE_KEY), updated_at: now },
  })
  return back({ ms: 'connected' })
}

// ─── Entry ─────────────────────────────────────────────────────────────────

export const isAction = name => Object.prototype.hasOwnProperty.call(actions, name)

export default async function handler(req, res) {
  const action = String(req.query?.action || '')
  if (!SUPABASE_URL || !SERVICE_KEY || !isConfigured) {
    return res.status(503).json({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.' })
  }

  try {
    if (action === 'unsubscribe') return await handleUnsubscribe(req, res)
    if (action === 'subscribe') return await handleSubscribe(req, res)
    if (action === 'webhook') return await handleWebhook(req, res)
    if (action === 'website-signup') return await handleWebsiteSignup(req, res)
    if (action === 'cron') return await handleCron(req, res)
    if (action === 'cold-tick') return await handleColdTick(req, res)
    if (action === 'ms-callback') return await handleMsCallback(req, res)
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'POST only' })
  }
  if (!isAction(action)) return res.status(404).json({ ok: false, error: `Unknown action: ${action || '(none)'}` })

  const body = await readJson(req)
  const workspaceId = String(body.workspace_id || '').trim()
  const token = bearerOf(req)
  const [user, member] = await Promise.all([authenticate(token), token ? isMember(workspaceId, token) : false])
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in to do this. If you are signed in, reload the page.' })
  if (!member) return res.status(403).json({ ok: false, error: 'You do not have access to that workspace.' })

  try {
    const out = await actions[action].call({ req, res }, { workspaceId, body, user })
    if (out && out.__fail) return res.status(out.status).json({ ok: false, error: out.error })
    return res.status(200).json({ ok: true, ...out })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
  }
}
