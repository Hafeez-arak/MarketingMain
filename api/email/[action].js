import { db, isConfigured } from '../agent/_supabase.js'
import { callModel } from '../agent/_provider.js'
import { loadBrandContext } from '../agent/_context.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { DRAFT_IDENTITY, DRAFT_SCHEMA, draftPrompt, parseDrafts } from '../../src/lib/email/draft.js'
import { renderEmail, marketingProblems } from '../../src/lib/email/render.js'
import { isValidEmail, normalizeEmail } from '../../src/lib/email/contacts.js'
import { dailyCap } from '../../src/lib/email/warmup.js'
import { createResend } from './_resend.js'
import {
  launchCampaign, dispatch, applyEvent, unsubscribe, verifySvix, loadSettings,
  sendingStats, fromHeader, closeFinished,
} from './_engine.js'

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

function needResend() {
  return RESEND_KEY ? null
    : 'RESEND_API_KEY is not set on this deployment. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.'
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
    const rendered = renderEmail({
      audience, subject: `[TEST] ${body.subject || ''}`, preheader: body.preheader || '', body: body.body || '',
      language: body.language === 'ar' ? 'ar' : 'en', contact: sample,
      sender: settings, unsubscribeUrl: `${baseUrlOf(this.req)}/api/email/unsubscribe?t=test`,
    })
    const r = await deps().resend.send({
      from: fromHeader(settings), to: [to], subject: rendered.subject, html: rendered.html, text: rendered.text,
      ...(settings.reply_to ? { reply_to: settings.reply_to } : {}),
    })
    if (!r.ok) return fail(r.error, r.status >= 400 && r.status < 600 ? r.status : 502)
    return { sent_to: to, id: r.id }
  },

  async launch({ workspaceId, body }) {
    const missing = needResend(); if (missing) return fail(missing, 503)
    if (!isUuid(body.campaign_id)) return fail('campaign_id is required.')
    const settings = await loadSettings({ db }, workspaceId)
    const when = body.when === 'schedule' ? 'schedule' : 'now'
    if (when === 'schedule' && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) return fail('Pick a date to schedule for.')
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

  /** Is the campaign ready to send? The same check launch makes. */
  async check({ workspaceId, body }) {
    const settings = await loadSettings({ db }, workspaceId)
    return { problems: marketingProblems({ subject: body.subject, body: body.body, sender: settings }) }
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
