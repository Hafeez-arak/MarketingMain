import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { dispatch, eventEffects, fromHeader, launchCampaign, verifySvix, applyEvent } from './_engine.js'

const WS = '11111111-1111-1111-1111-111111111111'
const CAMPAIGN = { id: 'camp-1', workspace_id: WS, audience: 'marketing', status: 'sending', subject: 'Hello {{first_name}}', body: 'Body', preheader: '', language: 'en', from_name: 'Arak', from_email: 'news@email.arak-sa.com', reply_to: '', group_ids: ['g1'] }
const SETTINGS = { workspace_id: WS, from_name: 'Arak', from_email: 'news@email.arak-sa.com', company_address: 'Riyadh', warmup_enabled: true, warmup_started_on: '2026-09-01', provider_daily_limit: 100, provider_monthly_limit: 3000 }

/** A PostgREST stand-in: first route whose method and pattern match answers. */
function stubDb(routes) {
  const calls = []
  const db = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    calls.push({ method, path, body: opts.body })
    for (const r of routes) {
      if (r.method === method && r.match.test(path)) return typeof r.reply === 'function' ? r.reply(path, opts) : r.reply
    }
    return method === 'GET' ? [] : null
  }
  return { db, calls }
}

describe('dispatch', () => {
  function world({ sends, contacts, sentToday = 0, resendOk = true, campaign = CAMPAIGN }) {
    let served = false
    const { db, calls } = stubDb([
      { method: 'GET', match: /^email_settings/, reply: [SETTINGS] },
      { method: 'GET', match: /^email_sends\?workspace_id=.*status=eq\.queued/, reply: () => (served ? [] : ((served = true), sends)) },
      { method: 'PATCH', match: /^email_sends\?id=in\..*status=eq\.queued/, reply: () => sends.map(s => ({ ...s, status: 'sending' })) },
      { method: 'GET', match: /^email_contacts/, reply: contacts },
      { method: 'GET', match: /^email_campaigns\?id=eq/, reply: [campaign] },
    ])
    const batches = []
    const resend = {
      async batch(emails, opts) {
        batches.push({ emails, opts })
        return resendOk ? { ok: true, ids: emails.map((_, i) => `re_${i}`) } : { ok: false, retryable: true, status: 429, error: 'rate' }
      },
    }
    const count = async path => (/sent_at=gte/.test(path) && !/bounced|complained/.test(path) ? sentToday : 0)
    return { deps: { db, count, resend }, calls, batches }
  }
  const contact = (id, over = {}) => ({ id, workspace_id: WS, email: `${id}@x.com`, first_name: id.toUpperCase(), audience: 'marketing', consent: 'customer', status: 'active', language: 'en', unsubscribe_token: `tok-${id}`, ...over })
  const send = id => ({ id: `s-${id}`, campaign_id: 'camp-1', contact_id: id, email: `${id}@x.com`, step: 0, subject: '', body: '' })
  const now = new Date('2026-09-27T07:00:00Z')

  it('sends claimed rows with one-click unsubscribe and records the provider id', async () => {
    const w = world({ sends: [send('a'), send('b')], contacts: [contact('a'), contact('b')] })
    const out = await dispatch(w.deps, { workspaceId: WS, baseUrl: 'https://app.test', now })
    expect(out.sent).toBe(2)
    const [first] = w.batches[0].emails
    expect(first.to).toEqual(['a@x.com'])
    expect(first.subject).toBe('Hello A')
    expect(first.from).toBe('Arak <news@email.arak-sa.com>')
    expect(first.headers['List-Unsubscribe']).toBe('<https://app.test/api/email/unsubscribe?t=tok-a>')
    expect(first.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const marked = w.calls.filter(c => c.method === 'PATCH' && /^email_sends\?id=eq\.s-a/.test(c.path))
    expect(marked.at(-1).body).toMatchObject({ status: 'sent', provider_id: 're_0' })
  })

  it('lays the email out in the campaign\'s language, not the contact\'s preference', async () => {
    // An English letter to an Arabic-preferring contact must not come out
    // right-to-left with an Arabic footer.
    const w = world({ sends: [send('a')], contacts: [contact('a', { language: 'ar' })] })
    await dispatch(w.deps, { workspaceId: WS, baseUrl: 'https://app.test', now })
    const html = w.batches[0].emails[0].html
    expect(html).toContain('dir="ltr"')
    expect(html).toContain('Unsubscribe')
  })

  it('sends the drag-and-drop design when the campaign has one', async () => {
    const design = { blocks: [
      { id: 'h', type: 'heading', text: 'Designed for {{first_name}}' },
      { id: 'b', type: 'button', label: 'Open', href: 'https://arak-sa.com' },
    ] }
    const w = world({ sends: [send('a')], contacts: [contact('a')], campaign: { ...CAMPAIGN, design } })
    await dispatch(w.deps, { workspaceId: WS, baseUrl: 'https://app.test', now })
    const email = w.batches[0].emails[0]
    expect(email.html).toContain('Designed for A')
    expect(email.html).toContain('href="https://arak-sa.com"')
    expect(email.html).toContain('unsubscribe?t=tok-a')
    expect(email.text).toContain('Open: https://arak-sa.com')
  })

  it('skips someone who unsubscribed after launch instead of emailing them', async () => {
    const w = world({ sends: [send('a'), send('b')], contacts: [contact('a'), contact('b', { status: 'unsubscribed' })] })
    const out = await dispatch(w.deps, { workspaceId: WS, baseUrl: 'https://app.test', now })
    expect(out).toMatchObject({ sent: 1, skipped: 1 })
    expect(w.batches[0].emails.map(e => e.to[0])).toEqual(['a@x.com'])
  })

  it('sends nothing once today\'s cap is spent', async () => {
    // Day 26 of warm-up → 400/day, but the provider allows 100 and 100 went out.
    const w = world({ sends: [send('a')], contacts: [contact('a')], sentToday: 100 })
    const out = await dispatch(w.deps, { workspaceId: WS, baseUrl: 'https://app.test', now })
    expect(out.sent).toBe(0)
    expect(w.batches).toHaveLength(0)
    expect(out.stoppedBy).toMatch(/limit/)
  })

  it('puts rows back in the queue when Resend is rate-limiting', async () => {
    const w = world({ sends: [send('a')], contacts: [contact('a')], resendOk: false })
    const out = await dispatch(w.deps, { workspaceId: WS, baseUrl: 'https://app.test', now })
    expect(out.sent).toBe(0)
    const back = w.calls.find(c => c.method === 'PATCH' && /^email_sends\?id=in/.test(c.path) && c.body.status === 'queued')
    expect(back).toBeTruthy()
  })

  it('does nothing without a sender address', async () => {
    const { db } = stubDb([{ method: 'GET', match: /^email_settings/, reply: [{ ...SETTINGS, from_email: '' }] }])
    const out = await dispatch({ db, count: async () => 0, resend: {} }, { workspaceId: WS, baseUrl: '', now })
    expect(out.stoppedBy).toMatch(/sender/)
  })
})

describe('launch', () => {
  it('refuses to send a cold campaign through Resend', async () => {
    const { db } = stubDb([{ method: 'GET', match: /^email_campaigns/, reply: [{ ...CAMPAIGN, audience: 'cold', status: 'draft' }] }])
    const out = await launchCampaign({ db }, { workspaceId: WS, campaignId: 'camp-1', when: 'now', settings: SETTINGS })
    expect(out.status).toBe(409)
  })

  it('queues only marketing contacts from marketing groups', async () => {
    const { db, calls } = stubDb([
      { method: 'GET', match: /^email_campaigns/, reply: [{ ...CAMPAIGN, status: 'draft', group_ids: ['g1', 'g2'] }] },
      { method: 'GET', match: /^email_groups/, reply: [{ id: 'g1', audience: 'marketing' }, { id: 'g2', audience: 'cold' }] },
      { method: 'GET', match: /^email_group_members/, reply: [{ group_id: 'g1', contact_id: 'a' }, { group_id: 'g1', contact_id: 'b' }] },
      { method: 'GET', match: /^email_contacts/, reply: [
        { id: 'a', email: 'a@x.com', audience: 'marketing', consent: 'customer', status: 'active' },
        { id: 'b', email: 'b@x.com', audience: 'cold', consent: 'none', status: 'active' },
      ] },
    ])
    const out = await launchCampaign({ db }, { workspaceId: WS, campaignId: 'camp-1', when: 'now', settings: SETTINGS, now: new Date('2026-09-27T07:00:00Z') })
    expect(out).toMatchObject({ queued: 1, skipped: 1, scheduled: false })
    const members = calls.find(c => /^email_group_members/.test(c.path))
    expect(members.path).toContain('group_id=in.("g1")')
    const insert = calls.find(c => c.method === 'POST' && /^email_sends/.test(c.path))
    expect(insert.body.map(r => r.contact_id)).toEqual(['a'])
  })

  it('schedules for 9:00 Riyadh on the chosen day', async () => {
    const { db } = stubDb([
      { method: 'GET', match: /^email_campaigns/, reply: [{ ...CAMPAIGN, status: 'draft' }] },
      { method: 'GET', match: /^email_groups/, reply: [{ id: 'g1', audience: 'marketing' }] },
      { method: 'GET', match: /^email_group_members/, reply: [{ group_id: 'g1', contact_id: 'a' }] },
      { method: 'GET', match: /^email_contacts/, reply: [{ id: 'a', email: 'a@x.com', audience: 'marketing', consent: 'customer', status: 'active' }] },
    ])
    const out = await launchCampaign({ db }, { workspaceId: WS, campaignId: 'camp-1', when: 'schedule', scheduleDate: '2026-10-01', settings: SETTINGS, now: new Date('2026-09-27T07:00:00Z') })
    expect(out.scheduled).toBe(true)
    expect(out.dueAt).toBe('2026-10-01T06:00:00.000Z')
  })
})

describe('webhooks', () => {
  const secretBytes = crypto.randomBytes(24)
  const secret = `whsec_${secretBytes.toString('base64')}`
  const sign = (id, ts, body) => `v1,${crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64')}`

  it('accepts a correctly signed event and refuses a tampered or stale one', () => {
    const now = 1_790_000_000_000
    const ts = String(Math.floor(now / 1000))
    const body = '{"type":"email.opened"}'
    const signature = sign('msg_1', ts, body)
    expect(verifySvix({ secret, id: 'msg_1', timestamp: ts, signature, body, now })).toBe(true)
    expect(verifySvix({ secret, id: 'msg_1', timestamp: ts, signature, body: body.replace('opened', 'clicked'), now })).toBe(false)
    expect(verifySvix({ secret, id: 'msg_1', timestamp: ts, signature, body, now: now + 3_600_000 })).toBe(false)
    expect(verifySvix({ secret: '', id: 'msg_1', timestamp: ts, signature, body, now })).toBe(false)
  })

  it('never moves a send backwards', () => {
    expect(eventEffects('email.opened', { status: 'clicked' }).send.status).toBeUndefined()
    expect(eventEffects('email.clicked', { status: 'opened' }).send.status).toBe('clicked')
  })

  it('retires an address on a hard bounce or a complaint, not on a soft bounce', () => {
    expect(eventEffects('email.bounced', {}, { bounce: { type: 'Permanent' } }).contact).toEqual({ status: 'bounced' })
    expect(eventEffects('email.bounced', {}, { bounce: { type: 'Transient' } }).contact).toBeNull()
    expect(eventEffects('email.complained', {}).contact).toEqual({ status: 'complained' })
  })

  it('logs events for emails that are not ours without touching anything', async () => {
    const { db, calls } = stubDb([])
    const out = await applyEvent({ db }, { type: 'email.opened', data: { email_id: 're_x' } })
    expect(out.ignored).toBe('not one of ours')
    expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(0)
    expect(calls.find(c => c.method === 'POST' && c.path === 'email_events')).toBeTruthy()
  })
})

describe('sender header', () => {
  it('strips characters that would break the From line', () => {
    expect(fromHeader({ from_name: 'Arak "Lighting" <x>', from_email: 'a@b.com' })).toBe('Arak Lighting x <a@b.com>')
    expect(fromHeader({ from_name: '', from_email: 'a@b.com' })).toBe('a@b.com')
  })
})
