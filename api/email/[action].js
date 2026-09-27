import crypto from 'node:crypto'
import { db, isConfigured } from '../agent/_supabase.js'
import { callModel } from '../agent/_provider.js'
import { loadBrandContext } from '../agent/_context.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { DRAFT_IDENTITY, DRAFT_SCHEMA, draftPrompt, parseDrafts } from '../../src/lib/email/draft.js'
import { renderEmail, marketingProblems } from '../../src/lib/email/render.js'
import { renderDesign, designChecks, hasDesign } from '../../src/lib/email/design.js'
import { isValidEmail, normalizeEmail } from '../../src/lib/email/contacts.js'
import { dailyCap } from '../../src/lib/email/warmup.js'
import { createResend } from './_resend.js'
import {
  launchCampaign, dispatch, applyEvent, unsubscribe, verifySvix, loadSettings,
  sendingStats, fromHeader, closeFinished,
} from './_engine.js'
import { launchColdCampaign, coldTick } from './_cold.js'
import { sealSecret, openSecret } from './_secrets.js'
import { verifyMailbox, sendFromMailbox } from './_mailbox.js'
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
//   Vercel Cron        GET /cron with Bearer CRON_SECRET: the morning run.
//   n8n (the box)      GET /cold-tick with Bearer CRON_SECRET, every 10
//                      minutes: the cold lane's sending run.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const RESEND_KEY = process.env.RESEND_API_KEY || ''
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || ''
const CRON_SECRET = process.env.CRON_SECRET || ''

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

// The cold lane's IO: our own mailboxes over SMTP, never Resend.
const coldDeps = () => ({
  db, count,
  mail: { send: sendFromMailbox },
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
      configured: { resend: Boolean(RESEND_KEY), webhook: Boolean(WEBHOOK_SECRET), cron: Boolean(CRON_SECRET) },
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
    if (!body.paused && mb.status === 'error') return fail('This mailbox\'s login stopped working. Reconnect it with a new app password to resume.')
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
    if (!password) return fail('This mailbox\'s password can no longer be read. Reconnect it.')
    const sample = { first_name: body.sample?.first_name || 'Sara', last_name: body.sample?.last_name || '', company: body.sample?.company || 'Example Co', job_title: '', city: 'Riyadh', email: to }
    const rendered = renderEmail({
      audience: 'cold',
      subject: `[TEST] ${body.subject || 'Outreach mailbox check'}`,
      body: body.body || 'Hi {{first_name|there}},\n\nThis is a test from the outreach mailbox. If it arrived in the inbox (not spam or Promotions), this mailbox is ready.',
      language: body.language === 'ar' ? 'ar' : 'en', contact: sample, signature: mb.signature,
    })
    const r = await sendFromMailbox(mb, password, {
      from: { name: mb.from_name || '', address: mb.email }, to: { name: '', address: to },
      subject: rendered.subject, text: rendered.text, html: rendered.html,
      messageId: `<${crypto.randomUUID()}@${domainOf(mb.email)}>`,
    })
    if (!r.ok) return fail(String(r.error?.response || r.error?.message || 'The test could not be sent.').slice(0, 300), 502)
    return { sent_to: to, from: mb.email }
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
  const out = await coldTick(coldDeps())
  return res.status(200).json({ ok: true, ...out })
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
    if (action === 'webhook') return await handleWebhook(req, res)
    if (action === 'cron') return await handleCron(req, res)
    if (action === 'cold-tick') return await handleColdTick(req, res)
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
    const out = await actions[action].call({ req }, { workspaceId, body, user })
    if (out && out.__fail) return res.status(out.status).json({ ok: false, error: out.error })
    return res.status(200).json({ ok: true, ...out })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
  }
}
