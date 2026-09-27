// ─── Dev-only: the Email harness's fake backend ────────────────────────────
// Imported FIRST by emailHarness.jsx. supabase-js captures window.fetch when
// the client is created, so the stand-in has to be in place before anything
// imports supabaseClient.

import { mailboxReadiness, mailboxCap, mailboxDomainProblem, domainOf } from '../lib/email/cold.js'

export const WS = '00000000-0000-0000-0000-00000000e1a1'
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const daysAgo = n => new Date(Date.now() - n * 86_400_000).toISOString()

const db = {
  email_contacts: [],
  email_groups: [],
  email_group_members: [],
  email_campaigns: [],
  email_sends: [],
  // One mailbox past its warm-up, one still warming.
  email_mailboxes: [
    { id: 'mb-ready', workspace_id: WS, provider: 'smtp', email: 'ahmed@araklighting.com', from_name: 'Ahmed Al-Harbi', signature: 'Ahmed Al-Harbi\nProject Sales, ARAK Lighting', smtp_host: 'smtp.gmail.com', smtp_port: 465, imap_host: 'imap.gmail.com', imap_port: 993, username: 'ahmed@araklighting.com', daily_limit: 20, warmup_started_on: daysAgo(20).slice(0, 10), first_sent_on: daysAgo(3).slice(0, 10), last_sent_at: daysAgo(1), next_send_at: null, status: 'active', status_reason: '', last_error: '', created_at: daysAgo(21), updated_at: now() },
    { id: 'mb-warm', workspace_id: WS, provider: 'smtp', email: 'sara@arak-lighting.co', from_name: 'Sara Nasser', signature: '', smtp_host: 'smtp.gmail.com', smtp_port: 465, imap_host: 'imap.gmail.com', imap_port: 993, username: 'sara@arak-lighting.co', daily_limit: 15, warmup_started_on: daysAgo(5).slice(0, 10), first_sent_on: null, last_sent_at: null, next_send_at: null, status: 'active', status_reason: '', last_error: '', created_at: daysAgo(5), updated_at: now() },
  ],
  // Arak's real public logo and a project photo, so the design editor's
  // picture picker has something to show. Read-only public URLs.
  brand_assets: [
    { id: 'a1', workspace_id: WS, kind: 'logo', title: 'arak-logo-black', created_at: now(), public_url: 'https://vxjhfvehccftvajgtqtv.supabase.co/storage/v1/object/public/brand-assets/00000000-0000-0000-0000-000000000001/logo/1789976769585_arak-logo-black.png' },
    { id: 'a2', workspace_id: WS, kind: 'project_photo', title: 'Project photo', created_at: now(), public_url: 'https://vxjhfvehccftvajgtqtv.supabase.co/storage/v1/object/public/brand-assets/00000000-0000-0000-0000-000000000001/project_photo/1782973356066_WhatsApp_Image_2026-07-01_at_15.37.37.jpeg' },
  ],
  // One ready week of AI drafts, for the Marketing tab's panel.
  email_ai_drafts: [{
    id: 'wk1', workspace_id: WS, week_of: (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10) })(),
    status: 'ready', note: 'Research is 10 days old, so these lean on standards and the calendar.', finished_at: now(), options: [
      { angle: 'SASO 2870 explained', why_now: 'Research: the standard is being cited in tenders.', audience: 'Customers', subject: 'What SASO 2870 means for your next fit-out', preheader: 'Certified luminaires are becoming the default', body: 'Hi {{first_name|there}},\n\nSASO 2870 is showing up in more specifications.\n\n- What it covers\n- What to ask a supplier', cta_label: 'Talk to our design team', cta_url: 'https://arak-sa.com/services/lighting-design', ar_subject: 'ما يعنيه SASO 2870', ar_preheader: '', ar_body: 'مرحباً،\n\nيظهر معيار SASO 2870 في المزيد من المواصفات.', ar_cta_label: 'تحدث إلى فريقنا' },
      { angle: 'Reading a photometric report', why_now: 'Extends last week\'s Instagram post.', audience: 'Consultants', subject: 'Three numbers that decide a lighting bill', preheader: 'Lux, uniformity and connected load', body: 'Hi {{first_name|there}},\n\nBefore a fixture is ordered, three numbers decide the energy bill.', cta_label: '', cta_url: '', ar_subject: '', ar_preheader: '', ar_body: '', ar_cta_label: '' },
      { angle: 'Cityscape in November', why_now: 'Event on 16 Nov; we are visiting.', audience: 'All marketing contacts', subject: 'See you at Cityscape Global?', preheader: '16–19 November, Riyadh', body: 'Hi {{first_name|there}},\n\nOur team will be at Cityscape Global.', cta_label: '', cta_url: '', ar_subject: '', ar_preheader: '', ar_body: '', ar_cta_label: '' },
    ],
  }],
  brand_profile: [{ workspace_id: WS, brand_colors: 'Steel #4c5e61 primary, warm gold #8a7a5c accent', contact_info: '', custom_fields: { website: 'arak-sa.com' } }],
  email_settings: [{
    workspace_id: WS, from_name: 'Arak Lighting', from_email: 'updates@email.arak-sa.com', reply_to: 'marketing@arak-sa.com',
    company_address: 'ARAK Lighting\nRiyadh, Saudi Arabia', warmup_started_on: daysAgo(9).slice(0, 10), warmup_enabled: true,
    provider_daily_limit: 100, provider_monthly_limit: 3000, cold_sending_enabled: false, updated_at: now(),
  }],
}

function seed() {
  const g1 = { id: uid(), workspace_id: WS, name: 'Customers', description: 'Bought from us in the last 3 years', audience: 'marketing', color: 'steel', created_at: now() }
  const g2 = { id: uid(), workspace_id: WS, name: 'Consultants', description: '', audience: 'marketing', color: 'sage', created_at: now() }
  const g3 = { id: uid(), workspace_id: WS, name: 'Riyadh hotel projects', description: 'From the research agent', audience: 'cold', color: 'sky', created_at: now() }
  db.email_groups.push(g1, g2, g3)
  const people = [
    ['sara@almabani.example', 'Sara', 'Al Qahtani', 'Al Mabani', 'Procurement Manager', 'Customer', 'marketing', 'ar'],
    ['omar@nesma.example', 'Omar', 'Haddad', 'Nesma & Partners', 'MEP Engineer', 'Contractor', 'marketing', 'en'],
    ['lina@dar.example', 'Lina', 'Khoury', 'Dar Al-Handasah', 'Lighting Designer', 'Consultant', 'marketing', 'en'],
    ['khalid@hotelgroup.example', 'Khalid', 'Al Otaibi', 'Riyadh Hotels Co', 'Project Director', 'Developer', 'cold', 'ar'],
    ['anna@fitout.example', 'Anna', 'Marsh', 'Interiors Fit-out', 'Design Manager', 'Interior designer', 'cold', 'en'],
    ['old@bounce.example', 'Old', 'Address', 'Gone Ltd', '', 'Customer', 'marketing', 'en'],
  ]
  people.forEach(([email, first_name, last_name, company, job_title, contact_type, audience, language], i) => {
    const c = {
      id: uid(), workspace_id: WS, email, first_name, last_name, company, job_title, phone: '', city: 'Riyadh', country: 'Saudi Arabia',
      contact_type, audience, language, consent: audience === 'cold' ? 'none' : 'customer',
      status: email.startsWith('old@') ? 'bounced' : 'active', source: 'import', notes: '', replied_at: null, opportunity_id: null,
      unsubscribe_token: uid(), unsubscribed_at: null, last_sent_at: i < 3 ? daysAgo(2) : null, last_opened_at: null, last_clicked_at: null,
      created_at: daysAgo(10 - i), updated_at: now(),
    }
    db.email_contacts.push(c)
    const g = audience === 'cold' ? g3 : (contact_type === 'Consultant' ? g2 : g1)
    db.email_group_members.push({ group_id: g.id, contact_id: c.id, workspace_id: WS, added_at: now() })
  })
  const camp = {
    id: uid(), workspace_id: WS, audience: 'marketing', name: 'September update', subject: 'Three new projects lit by Arak',
    preheader: 'A hotel lobby, an office tower and a villa', body: 'Hi {{first_name|there}},\n\nA quick update from **Arak Lighting**.\n\n- Hotel lobby, Riyadh\n- Office tower, Jeddah\n\n[See the projects](https://arak-sa.com)',
    language: 'en', group_ids: [g1.id], follow_ups: [], status: 'sent', scheduled_for: null, from_name: 'Arak Lighting', from_email: 'updates@email.arak-sa.com',
    reply_to: '', recipients: 3, launched_at: daysAgo(3), completed_at: daysAgo(3), created_at: daysAgo(4), updated_at: daysAgo(3),
  }
  db.email_campaigns.push(camp)
  db.email_contacts.filter(c => c.audience === 'marketing').slice(0, 3).forEach((c, i) => {
    db.email_sends.push({
      id: uid(), workspace_id: WS, campaign_id: camp.id, contact_id: c.id, email: c.email, step: 0,
      status: i === 0 ? 'clicked' : i === 1 ? 'opened' : 'delivered', due_at: daysAgo(3), subject: '', body: '', provider_id: `re_${i}`, error: '',
      sent_at: daysAgo(3), delivered_at: daysAgo(3), opened_at: i < 2 ? daysAgo(2) : null, clicked_at: i === 0 ? daysAgo(2) : null,
      bounced_at: null, complained_at: null, created_at: daysAgo(3), updated_at: daysAgo(3),
    })
  })
}
seed()

// ── A PostgREST stand-in: enough of eq / in / gte / order / on_conflict ──
function matches(row, params) {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const val = rest.join('.')
    const cell = row[key]
    if (op === 'eq' && String(cell ?? '') !== val) return false
    if (op === 'in') {
      const list = val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''))
      if (!list.includes(String(cell))) return false
    }
    if (op === 'gte' && !(cell && cell >= val)) return false
  }
  return true
}

function stats() {
  const by = new Map()
  for (const s of db.email_sends) {
    const x = by.get(s.campaign_id) || { campaign_id: s.campaign_id, workspace_id: s.workspace_id, total: 0, queued: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, failed: 0 }
    x.total++
    if (s.status === 'queued') x.queued++
    if (s.sent_at) x.sent++
    if (s.delivered_at) x.delivered++
    if (s.opened_at) x.opened++
    if (s.clicked_at) x.clicked++
    if (s.bounced_at) x.bounced++
    if (s.complained_at) x.complained++
    if (['failed', 'skipped'].includes(s.status)) x.failed++
    by.set(s.campaign_id, x)
  }
  return [...by.values()]
}

const DEFAULTS = {
  email_contacts: () => ({ id: uid(), first_name: '', last_name: '', company: '', job_title: '', phone: '', city: '', country: '', contact_type: '', audience: 'marketing', language: 'en', consent: 'business_contact', status: 'active', source: 'manual', notes: '', replied_at: null, unsubscribe_token: uid(), last_sent_at: null, created_at: now(), updated_at: now() }),
  email_groups: () => ({ id: uid(), description: '', audience: 'marketing', color: 'steel', created_at: now(), updated_at: now() }),
  email_group_members: () => ({ added_at: now() }),
  email_campaigns: () => ({ id: uid(), status: 'draft', preheader: '', follow_ups: [], group_ids: [], recipients: 0, created_at: now(), updated_at: now() }),
  email_settings: () => ({ updated_at: now() }),
}

function rest(url, init) {
  const u = new URL(url)
  const table = u.pathname.split('/').pop()
  const params = [...u.searchParams.entries()]
  const method = (init?.method || 'GET').toUpperCase()
  const headers = new Headers(init?.headers || {})
  const wantsObject = (headers.get('Accept') || '').includes('vnd.pgrst.object')
  const body = init?.body ? JSON.parse(init.body) : null
  let rows

  if (table === 'email_campaign_stats') rows = stats().filter(r => matches(r, params))
  else if (method === 'GET') {
    rows = (db[table] || []).filter(r => matches(r, params))
    const order = u.searchParams.get('order')
    if (order) {
      const [col, dir] = order.split('.')
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === 'desc' ? -1 : 1))
    }
  } else if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body]
    const conflict = u.searchParams.get('on_conflict')
    const ignore = (headers.get('Prefer') || '').includes('ignore-duplicates')
    const merge = (headers.get('Prefer') || '').includes('merge-duplicates')
    rows = []
    for (const item of list) {
      const keys = conflict ? conflict.split(',') : null
      const existing = keys && db[table].find(r => keys.every(k => r[k] === item[k]))
      if (existing && ignore) continue
      if (existing && (merge || !ignore)) { Object.assign(existing, item); rows.push(existing); continue }
      if (table === 'email_groups' && db.email_groups.some(g => g.name.toLowerCase() === String(item.name).toLowerCase())) {
        return json({ message: 'duplicate key value violates unique constraint "email_groups_ws_name_idx"', code: '23505' }, 409)
      }
      const row = { ...(DEFAULTS[table]?.() || {}), ...item }
      db[table].push(row)
      rows.push(row)
    }
  } else if (method === 'PATCH') {
    rows = db[table].filter(r => matches(r, params))
    rows.forEach(r => Object.assign(r, body))
  } else if (method === 'DELETE') {
    rows = db[table].filter(r => matches(r, params))
    db[table] = db[table].filter(r => !rows.includes(r))
    if (table === 'email_contacts') db.email_group_members = db.email_group_members.filter(m => !rows.some(r => r.id === m.contact_id))
    if (table === 'email_groups') db.email_group_members = db.email_group_members.filter(m => !rows.some(r => r.id === m.group_id))
  }
  return json(wantsObject ? (rows?.[0] ?? null) : rows)
}

function json(payload, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/*' } }))
}

function api(action, body) {
  const settings = db.email_settings[0]
  if (action === 'status') {
    return json({
      ok: true, configured: { resend: true, webhook: false, cron: false }, settings,
      stats: { today: now().slice(0, 10), sentToday: 12, sentThisMonth: 40, recent: { sent: 40, bounced: 0, complained: 0 } },
      cap: { cap: 100, remaining: 88, day: 9, limitedBy: 'warm-up', health: { state: 'ok', reason: '' } },
    })
  }
  if (action === 'send_test') return json({ ok: true, sent_to: body.to, id: 're_test' })
  if (action === 'mailbox_test') {
    const mb = db.email_mailboxes.find(m => m.id === body.mailbox_id)
    return json({ ok: true, sent_to: body.to || 'hafeez@arak-sa.com', from: mb?.email })
  }
  if (action === 'mailbox_save') {
    const input = body.mailbox || {}
    const problem = mailboxDomainProblem(input.email, [settings.from_email, settings.reply_to, 'hafeez@arak-sa.com'].map(domainOf))
    if (problem) return json({ ok: false, error: problem }, 400)
    if (!input.id && !body.password) return json({ ok: false, error: 'Paste the mailbox\'s app password.' }, 400)
    return new Promise(r => setTimeout(r, 600)).then(() => {
      let mb = db.email_mailboxes.find(m => m.id === input.id)
      if (mb) Object.assign(mb, input, { status: mb.status === 'error' ? 'active' : mb.status, updated_at: now() })
      else {
        mb = { id: uid(), workspace_id: WS, provider: 'smtp', first_sent_on: null, last_sent_at: null, next_send_at: null, status: 'active', status_reason: '', last_error: '', created_at: now(), ...input, email: String(input.email).toLowerCase() }
        db.email_mailboxes.push(mb)
      }
      return json({ ok: true, mailbox: mb, verified: true })
    })
  }
  if (action === 'mailbox_pause') {
    const mb = db.email_mailboxes.find(m => m.id === body.mailbox_id)
    Object.assign(mb, body.paused ? { status: 'paused', status_reason: 'Paused by hafeez@arak-sa.com.' } : { status: 'active', status_reason: '' })
    return json({ ok: true })
  }
  if (action === 'mailbox_delete') {
    db.email_mailboxes = db.email_mailboxes.filter(m => m.id !== body.mailbox_id)
    return json({ ok: true })
  }
  if (action === 'cold_preview') {
    const today = now().slice(0, 10)
    const queued = db.email_sends.find(x => x.status === 'queued' && x.step === 0)
    return json({ ok: true, preview: { window: true, workspaces: [{ mailboxes: db.email_mailboxes.map(mb => {
      const r = mailboxReadiness(mb, today)
      if (!r.ready) return { mailbox: mb.email, action: 'wait', reason: r.reason }
      const cap = mailboxCap(mb, today).cap
      return queued
        ? { mailbox: mb.email, action: 'send', reason: 'Would send now.', sentToday: 2, capToday: cap, next: { email: queued.email, step: 0, campaign: 'Riyadh hotels' } }
        : { mailbox: mb.email, action: 'wait', reason: 'Nothing due for this mailbox right now.', sentToday: 2, capToday: cap }
    }) }] } })
  }
  if (action === 'dispatch') return json({ ok: true, dispatched: { sent: 0 } })
  if (action === 'draft') {
    return new Promise(r => setTimeout(r, 700)).then(() => json({
      ok: true, cost: 0.041,
      options: [
        { angle: 'Recent project story', subject: 'How we lit the new Riyadh hotel lobby', preheader: 'Warm light, low glare, and a 40% lower load', body: 'Hi {{first_name|there}},\n\nWe just finished the lobby lighting for a new hotel in Riyadh.\n\n- Warm 2700K throughout\n- Glare-free downlights\n\n[See the project](https://arak-sa.com)' },
        { angle: 'Showroom invitation', subject: 'Come and see the new range in our showroom', preheader: 'Tuesday to Thursday, any time', body: 'Hi {{first_name|there}},\n\nOur showroom has the new architectural range on display.\n\nReply with a day that suits you.' },
        { angle: 'Practical tip', subject: 'One lighting mistake we see on every fit-out', preheader: 'And the two-minute fix', body: 'Hi {{first_name|there}},\n\nThe most common problem we see is **colour temperature mixing** between zones.\n\nHappy to review a drawing if useful.' },
      ],
    }))
  }
  if (action === 'launch') {
    const c = db.email_campaigns.find(x => x.id === body.campaign_id)
    if (c.audience === 'cold') {
      const members = db.email_group_members.filter(m => c.group_ids.includes(m.group_id))
      const prospects = members.map(m => db.email_contacts.find(x => x.id === m.contact_id)).filter(x => x && x.status === 'active' && x.audience === 'cold')
      for (const k of prospects) db.email_sends.push({ id: uid(), workspace_id: WS, campaign_id: c.id, contact_id: k.id, email: k.email, step: 0, status: 'queued', sent_at: null, due_at: now(), error: '', mailbox_id: null, created_at: now() })
      Object.assign(c, { status: 'sending', recipients: prospects.length, launched_at: now(), from_email: 'ahmed@araklighting.com' })
      return json({ ok: true, queued: prospects.length, recontact: 0, scheduled: false, mailboxes: 1, perDay: 10 })
    }
    const members = db.email_group_members.filter(m => c.group_ids.includes(m.group_id))
    const contacts = members.map(m => db.email_contacts.find(x => x.id === m.contact_id)).filter(x => x && x.status === 'active' && x.audience === 'marketing')
    for (const k of contacts) db.email_sends.push({ id: uid(), workspace_id: WS, campaign_id: c.id, contact_id: k.id, email: k.email, step: 0, status: 'sent', sent_at: now(), due_at: now(), error: '', created_at: now() })
    Object.assign(c, { status: body.when === 'schedule' ? 'scheduled' : 'sent', recipients: contacts.length, launched_at: now(), scheduled_for: body.when === 'schedule' ? `${body.date}T06:00:00Z` : null })
    return json({ ok: true, queued: contacts.length, scheduled: body.when === 'schedule', dispatched: { sent: contacts.length } })
  }
  return json({ ok: true })
}

const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.includes('/rest/v1/')) return rest(url, init)
  if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'hafeez@arak-sa.com' })
  if (url.startsWith('/api/email/')) return api(url.split('/').pop(), init?.body ? JSON.parse(init.body) : {})
  return realFetch(input, init)
}
window.__emailDb = db

