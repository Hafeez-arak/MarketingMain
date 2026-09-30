import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { bootApp, WS, OTHER_WS } from './app.js'
import { cleanContact } from '../../../src/lib/email/contacts.js'

// ─── Cold outreach, end to end ─────────────────────────────────────────────
// The real /api/email handler, the real engine, the real schema (PGlite, from
// the migration files) and a fake Microsoft 365 tenant. Each block is one
// part of the checklist in api/email/_e2e/README.md, run the way a person and
// n8n would run it: connect mailboxes, add prospects, group them, launch,
// let the 10-minute runs send, answer, bounce, fail, recover.
//
// Time is frozen with fake Dates (timers stay real) and moved by hand, so a
// "sending run on Sunday at 10:00 Riyadh" is exactly that.

// Sunday 4 October 2026, 10:00 in Riyadh (07:00 UTC): inside the window.
const SUN_10 = Date.parse('2026-10-04T07:00:00Z')
const MIN = 60_000
const DAY = 86_400_000

let app
let clock = SUN_10
const at = ms => { clock = ms; vi.setSystemTime(ms) }
const later = ms => at(clock + ms)

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(SUN_10)
  app = await bootApp()
}, 60_000)
afterAll(() => vi.useRealTimers())

// ── What the browser does with its own session (RLS insert), done directly ──
async function addContact(input) {
  const row = { ...cleanContact(input), workspace_id: input.workspace_id || WS }
  const [c] = await app.q(
    `insert into email_contacts (workspace_id,email,first_name,last_name,company,job_title,city,country,contact_type,notes,audience,language,consent,source,status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
    [row.workspace_id, row.email, row.first_name, row.last_name, row.company, row.job_title, row.city, row.country, row.contact_type, row.notes, row.audience, row.language, row.consent, row.source, input.status || 'active'],
  )
  return c
}
async function addGroup(name, audience, members = []) {
  const [g] = await app.q('insert into email_groups (workspace_id,name,audience) values ($1,$2,$3) returning *', [WS, name, audience])
  for (const c of members) await app.q('insert into email_group_members (group_id,contact_id,workspace_id) values ($1,$2,$3)', [g.id, c.id, WS])
  return g
}
async function addCampaign(over = {}) {
  const [c] = await app.q(
    `insert into email_campaigns (workspace_id,audience,name,subject,body,language,group_ids,follow_ups,mailbox_ids,language_only)
     values ($1,'cold',$2,$3,$4,$5,$6::uuid[],$7::jsonb,$8::uuid[],$9) returning *`,
    [WS, over.name || 'Outreach', over.subject || 'Lighting for {{company}}',
      over.body || 'Hi {{first_name|there}},\n\nA quick question about {{company}}.',
      over.language || 'en', `{${(over.group_ids || []).join(',')}}`,
      JSON.stringify(over.follow_ups ?? [{ delay_days: 3, subject: '', body: 'Following up on my note.' }]),
      `{${(over.mailbox_ids || []).join(',')}}`, over.language_only || false],
  )
  return c
}
const mailboxes = () => app.q('select * from email_mailboxes where workspace_id = $1 order by email', [WS])
const sends = campaignId => app.q('select * from email_sends where campaign_id = $1 order by email, step', [campaignId])
const contactOf = email => app.q('select * from email_contacts where workspace_id = $1 and email = $2', [WS, email]).then(r => r[0])
const setSwitch = on => app.q('update email_settings set cold_sending_enabled = $2 where workspace_id = $1', [WS, on])
const dbErrors = () => app.world.log.filter(l => l.kind === 'db-error')

// ═══ A. Connecting mailboxes ═══════════════════════════════════════════════

describe('A. connecting Microsoft 365 mailboxes', () => {
  beforeAll(() => {
    app.world.account('sales1@arak-sa.com', { displayName: 'Sales One' })
    app.world.account('sales2@arak-sa.com', { displayName: 'Sales Two' })
    app.world.account('nolicence@arak-sa.com', { licensed: false })
    app.world.account('someone@outlook.com')
  })

  it('A1 signing in as a mailbox stores it, active, with its sign-in sealed', async () => {
    const r = await app.connectMicrosoft('sales1@arak-sa.com')
    expect(r.status).toBe(302)
    expect(r.headers.location).toBe('https://app.test/email?tab=settings&ms=connected')
    const [mb] = await mailboxes()
    expect(mb).toMatchObject({ provider: 'microsoft', email: 'sales1@arak-sa.com', status: 'active', from_name: 'Sales One', daily_limit: 15 })
    const [secret] = await app.q('select secret from email_mailbox_secrets where mailbox_id = $1', [mb.id])
    expect(secret.secret).not.toContain('at-sales1')   // sealed, not plain
  })

  it('A2 a second mailbox', async () => {
    const r = await app.connectMicrosoft('sales2@arak-sa.com')
    expect(r.headers.location).toMatch(/ms=connected/)
    expect((await mailboxes()).map(m => m.email)).toEqual(['sales1@arak-sa.com', 'sales2@arak-sa.com'])
  })

  it('A3 connecting the same account again updates it, never duplicates it', async () => {
    await app.connectMicrosoft('sales1@arak-sa.com')
    expect(await mailboxes()).toHaveLength(2)
  })

  it('A4 reconnecting a mailbox must be done as that same account', async () => {
    const [mb] = await mailboxes()
    const r = await app.connectMicrosoft('sales2@arak-sa.com', { mailboxId: mb.id })
    expect(r.headers.location).toMatch(/ms_error=wrong_account/)
  })

  it('A5 a personal Outlook.com account is refused', async () => {
    const r = await app.connectMicrosoft('someone@outlook.com')
    expect(r.headers.location).toMatch(/ms_error=personal/)
  })

  it('A6 an account with no Exchange licence is refused, and says why', async () => {
    const r = await app.connectMicrosoft('nolicence@arak-sa.com')
    expect(r.headers.location).toMatch(/ms_error=no_mailbox/)
    expect(await mailboxes()).toHaveLength(2)
  })

  it('A7 a sign-in finished in another browser, or with a forged state, is refused', async () => {
    const start = await app.call('ms_connect_start', { body: {} })
    const state = new URL(start.body.url).searchParams.get('state')
    const code = app.world.signInCode('sales1@arak-sa.com')
    const noCookie = await app.call('ms-callback', { method: 'GET', token: null, query: { code, state } })
    expect(noCookie.headers.location).toMatch(/ms_error=browser/)
    const forged = await app.call('ms-callback', { method: 'GET', token: null, headers: { cookie: 'ms_oauth=x' }, query: { code, state: state.slice(0, -2) + 'xx' } })
    expect(forged.headers.location).toMatch(/ms_error=expired/)
  })

  it('A8 a test email goes to the person asking, from that mailbox only', async () => {
    const [mb] = await mailboxes()
    const r = await app.call('mailbox_test', { body: { mailbox_id: mb.id, to: 'hafeez@arak-sa.com' } })
    expect(r.status).toBe(200)
    const sent = app.world.accounts.get('sales1@arak-sa.com').sent.at(-1)
    expect(sent.to).toEqual(['hafeez@arak-sa.com'])
    expect(sent.subject).toMatch(/^\[TEST\]/)
  })

  it('A9 the name and signature can be edited; the address and login cannot', async () => {
    const [mb] = await mailboxes()
    const r = await app.call('mailbox_save', { body: { mailbox: { id: mb.id, from_name: 'Ahmed, ARAK', signature: 'Ahmed\nARAK Lighting', daily_limit: 20, email: 'evil@x.com' } } })
    expect(r.status).toBe(200)
    const [after] = await app.q('select * from email_mailboxes where id = $1', [mb.id])
    expect(after).toMatchObject({ from_name: 'Ahmed, ARAK', signature: 'Ahmed\nARAK Lighting', daily_limit: 20, email: 'sales1@arak-sa.com' })
  })

  it('A10 someone outside the workspace cannot touch its mailboxes', async () => {
    const stranger = await app.world.user('stranger@else.com')
    const [mb] = await mailboxes()
    const r = await app.call('mailbox_pause', { token: stranger.token, body: { mailbox_id: mb.id, paused: true } })
    expect(r.status).toBe(403)
    const r2 = await app.call('mailbox_pause', { body: { workspace_id: OTHER_WS, mailbox_id: mb.id, paused: true } })
    expect(r2.status).toBe(403)
  })
})

// ═══ B + C. Prospects, groups, launching ═══════════════════════════════════

const P = {}
const G = {}

describe('B/C. prospects, groups and launching a campaign', () => {
  beforeAll(async () => {
    P.hotel = await addContact({ email: 'khalid@riyadhhotels.sa', first_name: 'Khalid', company: 'Riyadh Hotels', audience: 'cold', language: 'ar' })
    P.fitout = await addContact({ email: 'anna@fitout.sa', first_name: 'Anna', company: 'Fitout Co', audience: 'cold' })
    P.mep = await addContact({ email: 'omar@mep.sa', first_name: 'Omar', company: 'MEP Ltd', audience: 'cold' })
    P.noName = await addContact({ email: 'info@tower.sa', company: 'Tower', audience: 'cold' })
    P.gone = await addContact({ email: 'old@gone.sa', company: 'Gone', audience: 'cold', status: 'unsubscribed' })
    P.customer = await addContact({ email: 'sara@customer.sa', first_name: 'Sara', company: 'Customer', audience: 'marketing' })
    G.hotels = await addGroup('Riyadh hotels', 'cold', [P.hotel, P.fitout, P.gone])
    G.mep = await addGroup('MEP contractors', 'cold', [P.mep, P.fitout, P.noName])
    G.customers = await addGroup('Customers', 'marketing', [P.customer])
  })

  it('C1 a cold campaign cannot target a marketing group', async () => {
    const c = await addCampaign({ group_ids: [G.customers.id] })
    const r = await app.call('launch', { body: { campaign_id: c.id } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/cold group/)
    expect(await sends(c.id)).toHaveLength(0)
  })

  it('C2 an unfinished follow-up or an unknown merge tag stops the launch', async () => {
    const c = await addCampaign({ group_ids: [G.hotels.id], follow_ups: [{ delay_days: 3, body: '' }] })
    expect((await app.call('launch', { body: { campaign_id: c.id } })).body.error).toMatch(/Follow-up 1 is empty/)
    const d = await addCampaign({ group_ids: [G.hotels.id], body: 'Hi {{firstname}}' })
    expect((await app.call('launch', { body: { campaign_id: d.id } })).status).toBe(400)
  })

  it('C3 two overlapping groups: everyone once, the unsubscribed never', async () => {
    const c = await addCampaign({ name: 'Hotels + MEP', group_ids: [G.hotels.id, G.mep.id], body: 'Hi {{first_name|there}},\n\nA quick question about {{company}}.\n\n[Get the lighting guide]({{subscribe_url}})' })
    const r = await app.call('launch', { body: { campaign_id: c.id } })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ queued: 4, mailboxes: 2, perDay: 10 })
    const rows = await sends(c.id)
    expect(rows.map(s => s.email)).toEqual(['anna@fitout.sa', 'info@tower.sa', 'khalid@riyadhhotels.sa', 'omar@mep.sa'])
    expect(rows.every(s => s.status === 'queued' && s.step === 0 && s.mailbox_id === null)).toBe(true)
    G.campaign = c
  })

  it('C4 the same people cannot be put in a second campaign while in one (90-day rule)', async () => {
    const c = await addCampaign({ name: 'Second try', group_ids: [G.mep.id] })
    const r = await app.call('launch', { body: { campaign_id: c.id } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/90 days/)
  })

  it('C5 with outreach switched off, nothing goes out, however many runs', async () => {
    await setSwitch(false)
    const t = await app.tick()
    expect(t.status).toBe(200)
    expect(t.body.sent).toBe(0)
    expect(app.world.log.filter(l => l.kind === 'sent' && l.to[0] !== 'hafeez@arak-sa.com')).toHaveLength(0)
  })

  it('C6 "What goes out next" says what each mailbox would do, sending nothing', async () => {
    await setSwitch(true)
    const r = await app.call('cold_preview')
    const lines = r.body.preview.workspaces[0].mailboxes
    expect(lines.map(l => l.action)).toEqual(['send', 'send'])
    expect(lines[0].next).toMatchObject({ step: 0, campaign: 'Hotels + MEP' })
    expect(app.world.log.filter(l => l.kind === 'sent')).toHaveLength(1)   // only A8's test
  })
})

// ═══ D. Sending runs ═══════════════════════════════════════════════════════

describe('D. the 10-minute sending runs', () => {
  it('D1 one run sends one email per mailbox, spread across both', async () => {
    const t = await app.tick()
    expect(t.body.sent).toBe(2)
    const rows = (await sends(G.campaign.id)).filter(s => s.status === 'sent')
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(s => s.mailbox_id)).size).toBe(2)
    expect(dbErrors()).toEqual([])
  })

  it('D2 the next run ten minutes later waits for each mailbox\'s gap', async () => {
    later(10 * MIN)
    const t = await app.tick()
    expect(t.body.sent).toBe(0)
    expect(t.body.workspaces[0].mailboxes.every(m => /gap/.test(m.reason))).toBe(true)
  })

  it('D3 the email is personal: merge tags, signature, the sign-up link, no tracking', async () => {
    const sent = app.world.accounts.get('sales1@arak-sa.com').sent.at(-1)
    expect(sent.subject).toMatch(/^Lighting for /)
    expect(sent.text).not.toMatch(/\{\{/)
    expect(sent.html).toContain('https://app.test/api/email/subscribe?t=')
    expect(sent.html).not.toMatch(/<img[^>]+(open|pixel|track)/i)
    expect(sent.text).toContain('ARAK Lighting')   // sales1's signature from A9
  })

  it('D4 over the day, the rest go out; nobody gets two first emails', async () => {
    for (let i = 0; i < 12; i++) { later(40 * MIN); await app.tick() }
    const rows = await sends(G.campaign.id)
    const first = rows.filter(s => s.step === 0)
    expect(first.every(s => s.status === 'sent')).toBe(true)
    const log = app.world.log.filter(l => l.kind === 'sent' && l.to[0] !== 'hafeez@arak-sa.com')
    expect(log).toHaveLength(4)
    expect(new Set(log.map(l => l.to[0])).size).toBe(4)
    // Each sent first email queued its follow-up, on the same mailbox, 3 days on.
    const fu = rows.filter(s => s.step === 1)
    expect(fu).toHaveLength(4)
    for (const f of fu) {
      const parent = first.find(s => s.contact_id === f.contact_id)
      expect(f.mailbox_id).toBe(parent.mailbox_id)
      expect(Date.parse(f.due_at) - Date.parse(parent.sent_at)).toBe(3 * DAY)
    }
    expect(dbErrors()).toEqual([])
  })

  it('D5 nothing at night (Friday is checked at the end: time only moves forward)', async () => {
    at(Date.parse('2026-10-04T19:00:00Z'))   // Sunday 22:00
    expect((await app.tick()).body).toMatchObject({ sent: 0, window: false })
  })
})

// ═══ E. What comes back: replies, stops, bounces, out-of-office ═════════════

const FORGED_DUPLICATES = new Set()
const outreachLog = () => app.world.log.filter(l => l.kind === 'sent' && l.to[0] !== 'hafeez@arak-sa.com')
/** Our first email to this address, as Microsoft holds it in Sent Items. */
function firstEmailTo(address) {
  for (const a of app.world.accounts.values()) {
    const m = a.sent.find(x => x.to.includes(address) && !x.inReplyTo)
    if (m) return { mailbox: a.email, messageId: m.internetMessageId, subject: m.subject }
  }
  throw new Error(`nothing sent to ${address}`)
}

describe('E. the inbox, read at the start of every run', () => {
  beforeAll(() => at(Date.parse('2026-10-06T07:00:00Z')))   // Tuesday 10:00, before the follow-ups are due

  it('E1 a real reply (quoting our "reply stop" line) stops the follow-up and moves them to marketing', async () => {
    const m = firstEmailTo('khalid@riyadhhotels.sa')
    app.world.reply({
      to: m.mailbox, from: 'khalid@riyadhhotels.sa', inReplyTo: m.messageId, subject: `RE: ${m.subject}`,
      text: 'Yes, please send the catalogue. From: Sales One Sent: Sunday If this is not relevant to you, just reply "stop"',
    })
    const t = await app.tick()
    expect(t.body.inbox).toMatchObject({ replies: 1, optOuts: 0, movedToMarketing: 1 })
    const c = await contactOf('khalid@riyadhhotels.sa')
    expect(c).toMatchObject({ audience: 'marketing', consent: 'business_contact', status: 'active' })
    expect(c.replied_at).toBeTruthy()
    const [fu] = (await sends(G.campaign.id)).filter(s => s.email === 'khalid@riyadhhotels.sa' && s.step === 1)
    expect(fu.status).toBe('cancelled')
    const groups = await app.q('select g.name, g.audience from email_group_members m join email_groups g on g.id = m.group_id where m.contact_id = $1', [c.id])
    expect(groups).toEqual([{ name: 'Replied to outreach', audience: 'marketing' }])
  })

  it('E2 "please stop" unsubscribes them, in every lane', async () => {
    const m = firstEmailTo('anna@fitout.sa')
    app.world.reply({ to: m.mailbox, from: 'anna@fitout.sa', inReplyTo: m.messageId, text: 'Please stop emailing me.' })
    later(10 * MIN)
    const t = await app.tick()
    expect(t.body.inbox).toMatchObject({ replies: 1, optOuts: 1 })
    expect(await contactOf('anna@fitout.sa')).toMatchObject({ status: 'unsubscribed', audience: 'cold' })
    const [fu] = (await sends(G.campaign.id)).filter(s => s.email === 'anna@fitout.sa' && s.step === 1)
    expect(fu.status).toBe('cancelled')
  })

  it('E3 a delivery failure notice bounces the address', async () => {
    const m = firstEmailTo('info@tower.sa')
    app.world.reply({ to: m.mailbox, from: 'postmaster@tower.sa', inReplyTo: m.messageId, subject: 'Undeliverable: ' + m.subject, text: 'Your message could not be delivered.' })
    later(10 * MIN)
    const t = await app.tick()
    expect(t.body.inbox.bounces).toBe(1)
    expect(await contactOf('info@tower.sa')).toMatchObject({ status: 'bounced' })
    const rows = (await sends(G.campaign.id)).filter(s => s.email === 'info@tower.sa')
    expect(rows.map(s => s.status)).toEqual(['bounced', 'cancelled'])
  })

  it('E4 an out-of-office changes nothing: the follow-up still goes, in the same thread', async () => {
    const m = firstEmailTo('omar@mep.sa')
    app.world.reply({ to: m.mailbox, from: 'omar@mep.sa', inReplyTo: m.messageId, subject: 'Automatic reply: ' + m.subject, text: 'I am out of the office until Sunday.' })
    later(10 * MIN)
    await app.tick()
    expect((await contactOf('omar@mep.sa')).replied_at).toBeNull()

    // Wednesday: the follow-up is due.
    at(Date.parse('2026-10-07T12:00:00Z'))
    await app.tick()
    const fu = outreachLog().find(l => l.to[0] === 'omar@mep.sa' && l.inReplyTo)
    expect(fu).toBeTruthy()
    expect(fu.mailbox).toBe(m.mailbox)
    expect(fu.inReplyTo).toBe(m.messageId)
    expect(fu.subject).toBe(`Re: ${m.subject}`)
    expect(app.world.accounts.get(m.mailbox).sent.at(-1).conversationId)
      .toBe(app.world.accounts.get(m.mailbox).sent.find(x => x.internetMessageId === m.messageId).conversationId)
  })

  it('E5 with every sequence finished, the campaign closes as sent', async () => {
    const [c] = await app.q('select status, completed_at from email_campaigns where id = $1', [G.campaign.id])
    expect(c.status).toBe('sent')
    const [st] = await app.q('select * from email_campaign_stats where campaign_id = $1', [G.campaign.id])
    expect(Number(st.replied)).toBe(2)          // Khalid and Anna
    expect(Number(st.bounced)).toBe(1)
    expect(outreachLog().filter(l => l.to[0] === 'khalid@riyadhhotels.sa')).toHaveLength(1)   // never followed up
  })
})

// ═══ F. When Microsoft or the run fails ════════════════════════════════════

const F = {}
const mb = email => app.q('select * from email_mailboxes where email = $1', [email]).then(r => r[0])
const acct = email => app.world.accounts.get(email)

describe('F. failures', () => {
  beforeAll(async () => {
    at(Date.parse('2026-10-11T06:00:00Z'))   // Sunday 11 October, 09:00
    const people = []
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) people.push(await addContact({ email: `${n}@jeddah.sa`, first_name: n.toUpperCase(), company: `Jeddah ${n}`, audience: 'cold' }))
    F.people = people
    F.group = await addGroup('Jeddah', 'cold', people)
    F.campaign = await addCampaign({ name: 'Jeddah', group_ids: [F.group.id], follow_ups: [{ delay_days: 2, body: 'Any thoughts?' }] })
    expect((await app.call('launch', { body: { campaign_id: F.campaign.id } })).status).toBe(200)
  })

  it('F1 a missing Mail.ReadWrite permission: the mailbox stops with the reason, the email waits, the other mailbox carries on', async () => {
    acct('sales1@arak-sa.com').denyDrafts = true
    const t = await app.tick()
    expect(t.body.sent).toBe(1)
    const m1 = await mb('sales1@arak-sa.com')
    expect(m1.status).toBe('error')
    expect(m1.status_reason).toMatch(/Mail\.ReadWrite/)
    const rows = await sends(F.campaign.id)
    expect(rows.filter(s => s.status === 'queued' && s.step === 0)).toHaveLength(7)
    expect(rows.filter(s => s.status === 'sending')).toHaveLength(0)
  })

  it('F2 once the permission is granted, signing in again brings the mailbox back', async () => {
    acct('sales1@arak-sa.com').denyDrafts = false
    const m1 = await mb('sales1@arak-sa.com')
    const r = await app.connectMicrosoft('sales1@arak-sa.com', { mailboxId: m1.id })
    expect(r.headers.location).toMatch(/ms=connected/)
    expect(await mb('sales1@arak-sa.com')).toMatchObject({ status: 'active', status_reason: '' })
    later(10 * MIN)
    const t2 = await app.tick()
    // Found here: the failed attempt used to keep its claimed gap, so a
    // reconnected mailbox sat idle up to three hours having sent nothing.
    expect(t2.body.workspaces[0].mailboxes.find(m => m.mailbox === 'sales1@arak-sa.com').action).toBe('sent')
  })

  it('F3 throttling: that mailbox pauses a few minutes (not until tomorrow), nothing is lost or doubled', async () => {
    acct('sales2@arak-sa.com').throttle = true
    later(3 * 60 * MIN)
    const before = outreachLog().length
    await app.tick()
    const m2 = await mb('sales2@arak-sa.com')
    expect(m2.status).toBe('active')
    // Found here: a 429 used to park the mailbox until the next morning.
    expect(Date.parse(m2.next_send_at) - clock).toBe(15 * MIN)
    expect((await sends(F.campaign.id)).filter(s => s.status === 'sending')).toHaveLength(0)
    acct('sales2@arak-sa.com').throttle = false
    expect(outreachLog().length - before).toBeLessThanOrEqual(1)   // only sales1 could send
  })

  it('F4 an address Microsoft refuses bounces that contact only', async () => {
    const [row] = (await sends(F.campaign.id)).filter(s => s.status === 'queued' && s.step === 0)
    acct('sales1@arak-sa.com').rejectRecipient = row.email
    acct('sales2@arak-sa.com').rejectRecipient = row.email
    // Run until that row has been tried.
    for (let i = 0; i < 120; i++) {
      later(30 * MIN)
      await app.tick()
      const [now] = await app.q('select status from email_sends where id = $1', [row.id])
      if (now.status !== 'queued') break
    }
    const [after] = await app.q('select status, bounced_at from email_sends where id = $1', [row.id])
    expect(after.status).toBe('bounced')
    expect((await contactOf(row.email)).status).toBe('bounced')
    expect((await mb('sales1@arak-sa.com')).status).toBe('active')
    acct('sales1@arak-sa.com').rejectRecipient = null
    acct('sales2@arak-sa.com').rejectRecipient = null
  })
})

describe('F. failures: runs that die mid-send, revoked sign-ins, blocks', () => {
  const H = {}
  beforeAll(async () => {
    at(Date.parse('2026-10-18T06:30:00Z'))   // Sunday 18 October, 09:30
    const people = []
    for (const n of ['p', 'q', 'r', 's']) people.push(await addContact({ email: `${n}@dammam.sa`, first_name: n.toUpperCase(), company: `Dammam ${n}`, audience: 'cold' }))
    H.group = await addGroup('Dammam', 'cold', people)
    const s1 = await mb('sales1@arak-sa.com')
    // One mailbox only, so every step below is on a known account.
    H.campaign = await addCampaign({ name: 'Dammam', group_ids: [H.group.id], mailbox_ids: [s1.id], follow_ups: [{ delay_days: 2, body: 'Checking in.' }] })
    expect((await app.call('launch', { body: { campaign_id: H.campaign.id } })).body.mailboxes).toBe(1)
    // Clear sales1's gap left by earlier blocks.
    await app.q('update email_mailboxes set next_send_at = null')
  })

  it('F5 Microsoft took the email, then the run died: it is recorded as sent from Sent Items, never sent twice', async () => {
    acct('sales1@arak-sa.com').dieAfterSend = true
    // Earlier campaigns are done with sales1, so only Dammam is due on it.
    await app.q("update email_sends set status = 'cancelled' where status = 'queued' and campaign_id <> $1", [H.campaign.id])
    const t0 = await app.tick()
    // Found here: one mailbox's crash used to abort the whole run, so every
    // other mailbox skipped it too. Now it is reported, and the rest carry on.
    const line = t0.body.workspaces[0].mailboxes.find(m => m.mailbox === 'sales1@arak-sa.com')
    expect(line.action).toBe('failed')
    expect(t0.body.workspaces[0].error).toBeUndefined()
    expect(t0.body.workspaces[0].mailboxes.map(m => m.mailbox)).toContain('sales2@arak-sa.com')
    const [stuck] = (await sends(H.campaign.id)).filter(s => s.status === 'sending')
    expect(stuck).toBeTruthy()
    H.first = stuck.email
    // A run 10 minutes later leaves it alone: it may still be in flight.
    later(10 * MIN)
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect((await app.q('select status from email_sends where id = $1', [stuck.id]))[0].status).toBe('sending')
    // 31 minutes on, the run asks the mailbox.
    later(21 * MIN)
    const t = await app.tick()
    expect(t.body.stuck).toMatchObject({ checked: 1, sent: 1 })
    const [row] = await app.q('select * from email_sends where id = $1', [stuck.id])
    expect(row.status).toBe('sent')
    expect(row.thread_id).toBeTruthy()
    const fu = (await sends(H.campaign.id)).find(s => s.email === stuck.email && s.step === 1)
    expect(fu).toMatchObject({ status: 'queued', mailbox_id: row.mailbox_id })
    expect(outreachLog().filter(l => l.to[0] === stuck.email)).toHaveLength(1)
  })

  it('F6 the run died after making the draft, before sending: the draft is deleted and it goes out once, later', async () => {
    acct('sales1@arak-sa.com').dieBeforeSend = true
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    const [stuck] = (await sends(H.campaign.id)).filter(s => s.status === 'sending')
    expect(stuck).toBeTruthy()
    expect(acct('sales1@arak-sa.com').drafts).toHaveLength(1)
    later(31 * MIN)
    await app.q('update email_mailboxes set next_send_at = null')
    const t = await app.tick()
    expect(t.body.stuck).toMatchObject({ requeued: 1 })
    expect(acct('sales1@arak-sa.com').drafts).toHaveLength(0)
    // It goes back in the queue and is sent by a later run, exactly once.
    for (let i = 0; i < 10 && outreachLog().filter(l => l.to[0] === stuck.email).length === 0; i++) {
      later(10 * MIN)
      await app.q('update email_mailboxes set next_send_at = null')
      await app.tick()
    }
    expect(outreachLog().filter(l => l.to[0] === stuck.email)).toHaveLength(1)
  })

  it('F7 in neither folder: never resent by itself; a person answers "send again" and it goes once', async () => {
    acct('sales1@arak-sa.com').dieAfterSend = true
    await app.q('update email_mailboxes set next_send_at = null')
    // A follow-up this time: the stuck path for step 1 too.
    await app.q("update email_sends set due_at = now() - interval '1 minute' where id = (select id from email_sends where campaign_id = $1 and step = 1 and status = 'queued' order by email limit 1)", [H.campaign.id])
    await app.tick()
    const [stuck] = (await sends(H.campaign.id)).filter(s => s.status === 'sending')
    // Someone tidied Sent Items: now nothing proves it left. A person then
    // presses "Send again", so this one address really gets it twice: the
    // case Z2 knows about, and the reason nothing resends by itself.
    FORGED_DUPLICATES.add(stuck.email)
    // Someone tidied Sent Items: now nothing proves it left.
    const a = acct('sales1@arak-sa.com')
    a.sent = a.sent.filter(m => !m.to.includes(stuck.email))
    const logged = outreachLog().filter(l => l.to[0] === stuck.email).length
    later(31 * MIN)
    const t = await app.tick()
    expect(t.body.stuck).toMatchObject({ needsPerson: 1 })
    const [row] = await app.q('select status, error from email_sends where id = $1', [stuck.id])
    expect(row.status).toBe('sending')
    expect(row.error).toMatch(/most likely never left/)
    // A run later still does not resend it.
    later(10 * MIN)
    await app.tick()
    expect(outreachLog().filter(l => l.to[0] === stuck.email)).toHaveLength(logged)

    const r = await app.call('stuck_resolve', { body: { send_id: stuck.id, outcome: 'retry' } })
    expect(r.status).toBe(200)
    expect((await app.call('stuck_resolve', { body: { send_id: stuck.id, outcome: 'retry' } })).status).toBe(409)
    for (let i = 0; i < 10 && outreachLog().filter(l => l.to[0] === stuck.email).length === logged; i++) {
      later(10 * MIN)
      await app.q('update email_mailboxes set next_send_at = null')
      await app.tick()
    }
    expect(outreachLog().filter(l => l.to[0] === stuck.email)).toHaveLength(logged + 1)
  })

  it('F8 a revoked sign-in (password changed): the mailbox asks to be reconnected, nothing is lost', async () => {
    const a = acct('sales1@arak-sa.com')
    a.revoked = true
    a.tokens.clear()              // the cached access token is refused too
    await app.q('update email_mailboxes set next_send_at = null')
    later(10 * MIN)
    await app.tick()
    const m1 = await mb('sales1@arak-sa.com')
    expect(m1.status).toBe('error')
    expect(m1.status_reason).toMatch(/Reconnect/)
    expect((await sends(H.campaign.id)).filter(s => s.status === 'sending')).toHaveLength(0)
    a.revoked = false
    const r = await app.connectMicrosoft('sales1@arak-sa.com', { mailboxId: m1.id })
    expect(r.headers.location).toMatch(/ms=connected/)
    expect((await mb('sales1@arak-sa.com')).status).toBe('active')
  })

  it('F9 Microsoft blocks the mailbox for spam: it stops with instructions for the admin', async () => {
    acct('sales1@arak-sa.com').blocked = true
    await app.q("update email_mailboxes set next_send_at = null")
    // A follow-up or first email must be due for this mailbox.
    await app.q("update email_sends set due_at = now() - interval '1 minute' where campaign_id = $1 and status = 'queued'", [H.campaign.id])
    later(10 * MIN)
    await app.tick()
    const m1 = await mb('sales1@arak-sa.com')
    expect(m1.status).toBe('error')
    expect(m1.status_reason).toMatch(/Restricted entities/)
    acct('sales1@arak-sa.com').blocked = false
    expect(dbErrors()).toEqual([])
  })
})

// ═══ G. Controls, links, scheduling, the brake, the other lane ═════════════

describe('G. controls, links and the rest', () => {
  const K = {}
  beforeAll(async () => {
    at(Date.parse('2026-10-25T06:30:00Z'))   // Sunday 25 October, 09:30
    await app.q("update email_sends set status = 'cancelled' where status = 'queued'")
    await app.q('update email_mailboxes set next_send_at = null')
    K.en = await addContact({ email: 'lee@abha.sa', first_name: 'Lee', company: 'Abha', audience: 'cold', language: 'en' })
    K.ar = await addContact({ email: 'faisal@abha.sa', first_name: 'فيصل', company: 'أبها', audience: 'cold', language: 'ar' })
    K.ar2 = await addContact({ email: 'noura@abha.sa', first_name: 'نورة', company: 'أبها', audience: 'cold', language: 'ar' })
    K.group = await addGroup('Abha', 'cold', [K.en, K.ar, K.ar2])
  })

  it('G1 "Arabic speakers only" queues only them, and the email is right-to-left', async () => {
    const c = await addCampaign({ name: 'Abha AR', language: 'ar', language_only: true, group_ids: [K.group.id], subject: 'إضاءة {{company}}', body: 'مرحباً {{first_name}}،\n\nسؤال سريع عن مشروعكم.', follow_ups: [] })
    const r = await app.call('launch', { body: { campaign_id: c.id } })
    expect(r.body).toMatchObject({ queued: 2 })
    K.ar_campaign = c
    await app.tick()
    const sent = [...acct('sales1@arak-sa.com').sent, ...acct('sales2@arak-sa.com').sent].find(m => m.to.includes('faisal@abha.sa') || m.to.includes('noura@abha.sa'))
    expect(sent.html).toMatch(/dir="rtl"/)
    expect(sent.subject).toBe('إضاءة أبها')
  })

  it('G2 pause stops a campaign between runs, resume carries on, cancel drops the rest', async () => {
    const c = K.ar_campaign
    expect((await app.call('pause', { body: { campaign_id: c.id } })).status).toBe(200)
    const before = outreachLog().length
    later(3 * 60 * MIN)
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect(outreachLog().length).toBe(before)
    await app.call('resume', { body: { campaign_id: c.id } })
    await app.tick()
    expect(outreachLog().length).toBe(before + 1)
    const d = await addCampaign({ name: 'Abha EN', group_ids: [K.group.id], follow_ups: [] })
    // Everyone in Abha is in an outreach already, except Lee.
    expect((await app.call('launch', { body: { campaign_id: d.id } })).body).toMatchObject({ queued: 1 })
    await app.call('cancel', { body: { campaign_id: d.id } })
    expect((await sends(d.id)).map(s => s.status)).toEqual(['cancelled'])
    expect((await app.q('select status from email_campaigns where id = $1', [d.id]))[0].status).toBe('cancelled')
  })

  it('G3 a scheduled campaign waits for its day, then starts by itself', async () => {
    const x = await addContact({ email: 'sched@tabuk.sa', first_name: 'Sam', company: 'Tabuk', audience: 'cold' })
    const g = await addGroup('Tabuk', 'cold', [x])
    const c = await addCampaign({ name: 'Tabuk', group_ids: [g.id], follow_ups: [] })
    const r = await app.call('launch', { body: { campaign_id: c.id, when: 'schedule', date: '2026-10-27' } })
    expect(r.body).toMatchObject({ scheduled: true, queued: 1 })
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect((await sends(c.id))[0].status).toBe('queued')
    at(Date.parse('2026-10-27T06:30:00Z'))   // Tuesday 09:30
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect((await sends(c.id))[0].status).toBe('sent')
  })

  it('G4 the sign-up link: opening it changes nothing, confirming moves the prospect to the newsletter', async () => {
    const c = await contactOf('lee@abha.sa')
    const look = await app.call('subscribe', { method: 'GET', token: null, query: { t: c.unsubscribe_token } })
    expect(look.status).toBe(200)
    expect((await contactOf('lee@abha.sa')).audience).toBe('cold')
    const yes = await app.call('subscribe', { method: 'POST', token: null, query: { t: c.unsubscribe_token }, raw: true, body: '' })
    expect(yes.status).toBe(200)
    expect(await contactOf('lee@abha.sa')).toMatchObject({ audience: 'marketing', consent: 'opted_in' })
    const bad = await app.call('subscribe', { method: 'POST', token: null, query: { t: '00000000-0000-0000-0000-000000000000' }, raw: true, body: '' })
    expect(bad.status).toBe(404)
  })

  it('G5 pausing a mailbox holds its follow-ups; deleting it cancels them', async () => {
    const y = await addContact({ email: 'y@hail.sa', first_name: 'Y', company: 'Hail', audience: 'cold' })
    const g = await addGroup('Hail', 'cold', [y])
    const s2 = await mb('sales2@arak-sa.com')
    const c = await addCampaign({ name: 'Hail', group_ids: [g.id], mailbox_ids: [s2.id], follow_ups: [{ delay_days: 1, body: 'Checking in.' }] })
    await app.call('launch', { body: { campaign_id: c.id } })
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect((await sends(c.id)).map(s => s.status)).toEqual(['sent', 'queued'])
    await app.call('mailbox_pause', { body: { mailbox_id: s2.id, paused: true } })
    later(DAY + 60 * MIN)
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect((await sends(c.id)).map(s => s.status)).toEqual(['sent', 'queued'])
    await app.call('mailbox_delete', { body: { mailbox_id: s2.id } })
    expect((await sends(c.id)).map(s => s.status)).toEqual(['sent', 'cancelled'])
  })

  it('G6 the bounce brake pauses a mailbox whose week is 5% bounces', async () => {
    // Still blocked from F9: an admin released it, and it was signed in again.
    await app.connectMicrosoft('sales1@arak-sa.com', { mailboxId: (await mb('sales1@arak-sa.com')).id })
    const s1 = await mb('sales1@arak-sa.com')
    const [camp] = await app.q('select id from email_campaigns where name = $1', ['Dammam'])
    const [who] = await app.q("select id from email_contacts where email = 'p@dammam.sa'")
    // Twenty sends this week, two of them bounced: history, as the runs left it.
    for (let i = 0; i < 20; i++) {
      await app.q(`insert into email_sends (workspace_id,campaign_id,contact_id,email,step,status,mailbox_id,sent_at,bounced_at)
        values ($1,$2,$3,$4,$5,$6,$7, now() - interval '1 day', $8)`,
      [WS, camp.id, who.id, `hist${i}@x.sa`, 10 + i, i < 2 ? 'bounced' : 'sent', s1.id, i < 2 ? new Date(clock - DAY).toISOString() : null])
    }
    const x = await addContact({ email: 'z@qassim.sa', company: 'Qassim', audience: 'cold' })
    const g = await addGroup('Qassim', 'cold', [x])
    const c = await addCampaign({ name: 'Qassim', group_ids: [g.id], follow_ups: [] })
    await app.call('launch', { body: { campaign_id: c.id } })
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    const after = await mb('sales1@arak-sa.com')
    expect(after.status).toBe('paused')
    expect(after.status_reason).toMatch(/bounce brake/)
    expect((await sends(c.id))[0].status).toBe('queued')
  })

  it('G7 the marketing lane goes through Resend, to marketing contacts only, never a prospect', async () => {
    const g = await app.q("select id from email_groups where name = 'Customers'")
    const [c] = await app.q(`insert into email_campaigns (workspace_id,audience,name,subject,body,group_ids)
      values ($1,'marketing','Newsletter','News from ARAK','Hi {{first_name|there}},\n\nNew projects.',$2::uuid[]) returning *`, [WS, `{${g[0].id}}`])
    const r = await app.call('launch', { body: { campaign_id: c.id } })
    expect(r.status).toBe(200)
    const to = app.world.resendSent.flatMap(m => m.to)
    expect(to).toEqual(['sara@customer.sa'])
    // And a cold campaign is never handed to Resend.
    const cold = await addCampaign({ name: 'never via resend', group_ids: [K.group.id] })
    await app.call('launch', { body: { campaign_id: cold.id } })
    expect(app.world.resendSent.flatMap(m => m.to)).toEqual(['sara@customer.sa'])
  })

  it('G8 a website enquiry with the box ticked becomes a marketing contact; a cold prospect moves over', async () => {
    await app.q("update email_settings set website_signup_key = 'site_key_e2e_0123456789' where workspace_id = $1", [WS])
    const post = body => app.call('website-signup', { token: null, headers: { origin: 'https://arak-sa.com' }, raw: true, body: JSON.stringify({ key: 'site_key_e2e_0123456789', consent: true, ...body }) })
    expect((await post({ email: 'New@Visitor.sa', name: 'New Visitor' })).body).toEqual({ ok: true, added: true })
    expect(await contactOf('new@visitor.sa')).toMatchObject({ audience: 'marketing', consent: 'opted_in', source: 'website' })
    await post({ email: 'faisal@abha.sa', name: 'Faisal' })
    expect(await contactOf('faisal@abha.sa')).toMatchObject({ audience: 'marketing', consent: 'opted_in' })
    // Anna said stop in E2: a ticked box on the website does not undo that.
    expect((await post({ email: 'anna@fitout.sa' })).body).toEqual({ ok: true, added: false })
    expect((await contactOf('anna@fitout.sa')).status).toBe('unsubscribed')
    const evil = await app.call('website-signup', { token: null, headers: { origin: 'https://evil.test' }, raw: true, body: '{}' })
    expect(evil.status).toBe(403)
  })

  it('G9 nothing goes out on a Friday', async () => {
    at(Date.parse('2026-10-30T08:00:00Z'))   // Friday 11:00
    expect((await app.tick()).body).toMatchObject({ sent: 0, window: false })
    expect(dbErrors()).toEqual([])
  })
})

// ═══ H. Edges: another company, colleagues, edits after launch ═════════════

describe('H. edges', () => {
  beforeAll(async () => {
    at(Date.parse('2026-11-01T06:30:00Z'))   // Sunday 1 November, 09:30
    await app.q("update email_sends set status = 'cancelled' where status = 'queued'")
    await app.q("update email_mailboxes set status = 'active', status_reason = '', next_send_at = null")
    await app.q("delete from email_sends where email like 'hist%'")   // G6's staged history
  })

  it('H1 another company\'s mailboxes and campaigns never mix with ours', async () => {
    const theirs = await app.world.user('owner@other.sa')
    await app.q('insert into workspace_members (workspace_id, user_id) values ($1, $2)', [OTHER_WS, theirs.id])
    await app.q("insert into email_settings (workspace_id, cold_sending_enabled) values ($1, true)", [OTHER_WS])
    app.world.account('rep@other.sa', { displayName: 'Other rep' })
    // Their owner connects their mailbox into their workspace.
    const start = await app.call('ms_connect_start', { token: theirs.token, body: { workspace_id: OTHER_WS } })
    const state = new URL(start.body.url).searchParams.get('state')
    const cookie = String(start.headers['set-cookie']).split(';')[0]
    const cb = await app.call('ms-callback', { method: 'GET', token: null, headers: { cookie }, query: { code: app.world.signInCode('rep@other.sa'), state } })
    expect(cb.headers.location).toMatch(/ms=connected/)
    const [c1] = await app.q(`insert into email_contacts (workspace_id,email,audience,consent) values ($1,'lead@theirs.sa','cold','none') returning id`, [OTHER_WS])
    const [g1] = await app.q(`insert into email_groups (workspace_id,name,audience) values ($1,'Theirs','cold') returning id`, [OTHER_WS])
    await app.q('insert into email_group_members (group_id,contact_id,workspace_id) values ($1,$2,$3)', [g1.id, c1.id, OTHER_WS])
    const [camp] = await app.q(`insert into email_campaigns (workspace_id,audience,name,subject,body,group_ids) values ($1,'cold','Theirs','Hello','Hi.',$2::uuid[]) returning id`, [OTHER_WS, `{${g1.id}}`])
    // Our owner cannot launch it; theirs can.
    expect((await app.call('launch', { body: { workspace_id: OTHER_WS, campaign_id: camp.id } })).status).toBe(403)
    expect((await app.call('launch', { token: theirs.token, body: { workspace_id: OTHER_WS, campaign_id: camp.id } })).status).toBe(200)
    await app.tick()
    const sentTheirs = app.world.log.filter(l => l.kind === 'sent' && l.to[0] === 'lead@theirs.sa')
    expect(sentTheirs.map(l => l.mailbox)).toEqual(['rep@other.sa'])
    // And their mailbox never sends ours: its only sends are to their lead.
    expect(app.world.log.filter(l => l.kind === 'sent' && l.mailbox === 'rep@other.sa').map(l => l.to[0])).toEqual(['lead@theirs.sa'])
  })

  it('H2 a colleague answering on the thread counts as the prospect\'s reply', async () => {
    const x = await addContact({ email: 'boss@najran.sa', first_name: 'Boss', company: 'Najran', audience: 'cold' })
    const g = await addGroup('Najran', 'cold', [x])
    const c = await addCampaign({ name: 'Najran', group_ids: [g.id] })
    await app.call('launch', { body: { campaign_id: c.id } })
    await app.tick()
    const m = firstEmailTo('boss@najran.sa')
    app.world.reply({ to: m.mailbox, from: 'assistant@najran.sa', inReplyTo: m.messageId, text: 'Forwarding to our MEP lead, please send pricing.' })
    later(10 * MIN)
    await app.tick()
    expect((await contactOf('boss@najran.sa')).replied_at).toBeTruthy()
    expect((await sends(c.id)).find(s => s.step === 1).status).toBe('cancelled')
  })

  it('H3 a reply that lands the same run its follow-up falls due: the follow-up never goes', async () => {
    const x = await addContact({ email: 'late@jizan.sa', first_name: 'Late', company: 'Jizan', audience: 'cold' })
    const g = await addGroup('Jizan', 'cold', [x])
    const c = await addCampaign({ name: 'Jizan', group_ids: [g.id], follow_ups: [{ delay_days: 1, body: 'Following up.' }] })
    await app.call('launch', { body: { campaign_id: c.id } })
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    const m = firstEmailTo('late@jizan.sa')
    later(DAY + 10 * MIN)
    app.world.reply({ to: m.mailbox, from: 'late@jizan.sa', inReplyTo: m.messageId, text: 'Interested, call me.' })
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect(outreachLog().filter(l => l.to[0] === 'late@jizan.sa')).toHaveLength(1)
    expect((await sends(c.id)).find(s => s.step === 1).status).toBe('cancelled')
  })

  it('H4 a prospect deleted, or moved to marketing, while queued is skipped, not emailed', async () => {
    const a = await addContact({ email: 'del@tabuk.sa', company: 'T', audience: 'cold' })
    const b = await addContact({ email: 'moved@tabuk.sa', company: 'T', audience: 'cold' })
    const g = await addGroup('Tabuk 2', 'cold', [a, b])
    const c = await addCampaign({ name: 'Tabuk 2', group_ids: [g.id], follow_ups: [] })
    await app.call('launch', { body: { campaign_id: c.id } })
    await app.q('delete from email_contacts where id = $1', [a.id])
    await app.q("update email_contacts set audience = 'marketing', consent = 'business_contact' where id = $1", [b.id])
    for (let i = 0; i < 4; i++) { later(40 * MIN); await app.q('update email_mailboxes set next_send_at = null'); await app.tick() }
    const rows = await sends(c.id)
    expect(outreachLog().filter(l => ['del@tabuk.sa', 'moved@tabuk.sa'].includes(l.to[0]))).toHaveLength(0)
    // Found here: the deleted contact's row was claimed, the lookup of contact
    // "null" failed, and it stuck in 'sending' with "send it again" advice.
    expect(rows.find(s => s.email === 'del@tabuk.sa')).toMatchObject({ status: 'cancelled', error: 'Contact deleted' })
    expect(rows.find(s => s.email === 'moved@tabuk.sa').status).toBe('skipped')
    expect(dbErrors()).toEqual([])
  })

  it('H5 a follow-up removed from the campaign after launch is dropped, not sent blank', async () => {
    const x = await addContact({ email: 'edit@baha.sa', first_name: 'E', company: 'Baha', audience: 'cold' })
    const g = await addGroup('Baha', 'cold', [x])
    const c = await addCampaign({ name: 'Baha', group_ids: [g.id], follow_ups: [{ delay_days: 1, body: 'Follow-up.' }] })
    await app.call('launch', { body: { campaign_id: c.id } })
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    await app.q("update email_campaigns set follow_ups = '[]'::jsonb where id = $1", [c.id])
    later(DAY + 10 * MIN)
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect(outreachLog().filter(l => l.to[0] === 'edit@baha.sa')).toHaveLength(1)
    expect((await sends(c.id)).find(s => s.step === 1)).toMatchObject({ status: 'cancelled' })
  })

  it('H6 a mailbox with a daily limit of 0 sends nothing', async () => {
    await app.q('update email_mailboxes set daily_limit = 0')
    const x = await addContact({ email: 'zero@arar.sa', company: 'Arar', audience: 'cold' })
    const g = await addGroup('Arar', 'cold', [x])
    const c = await addCampaign({ name: 'Arar', group_ids: [g.id], follow_ups: [] })
    await app.call('launch', { body: { campaign_id: c.id } })
    await app.q('update email_mailboxes set next_send_at = null')
    await app.tick()
    expect((await sends(c.id))[0].status).toBe('queued')
    await app.q('update email_mailboxes set daily_limit = 15')
  })
})

describe('Z. over the whole run', () => {
  it('Z1 not one database request was refused, even ones the app swallowed', () => {
    expect(dbErrors()).toEqual([])
  })
  it('Z2 no prospect ever got the same step twice', () => {
    const seen = new Map()
    for (const l of outreachLog()) {
      const key = `${l.to[0]}|${l.inReplyTo ? 're' : 'first'}|${l.subject}`
      seen.set(key, (seen.get(key) || 0) + 1)
    }
    expect([...seen].filter(([k, n]) => n > 1 && !FORGED_DUPLICATES.has(k.split('|')[0]))).toEqual([])
  })
})
