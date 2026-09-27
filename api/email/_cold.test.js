import { describe, it, expect } from 'vitest'
import { coldTick, launchColdCampaign, coldProblems } from './_cold.js'
import { sealSecret, openSecret } from './_secrets.js'

const WS = '11111111-1111-1111-1111-111111111111'
// Sunday 27 September 2026, 11:00 Riyadh: inside the sending window.
const SUNDAY_11 = new Date('2026-09-27T08:00:00Z')
// Friday 2 October 2026, 11:00 Riyadh: the weekend.
const FRIDAY_11 = new Date('2026-10-02T08:00:00Z')

const MAILBOX = {
  id: 'mb-1', workspace_id: WS, provider: 'smtp', email: 'ahmed@araklighting.com', from_name: 'Ahmed',
  signature: 'Ahmed\nARAK Lighting', smtp_host: 'smtp.gmail.com', smtp_port: 465, imap_host: 'imap.gmail.com', imap_port: 993,
  username: 'ahmed@araklighting.com', daily_limit: 15, warmup_started_on: '2026-09-01', first_sent_on: null,
  last_sent_at: null, next_send_at: null, status: 'active', status_reason: '',
}
const CAMPAIGN = {
  id: 'camp-1', workspace_id: WS, audience: 'cold', status: 'sending', name: 'Riyadh hotels',
  subject: 'Lighting for {{company}}', body: 'Hi {{first_name}},\n\nA question about your project.', language: 'en',
  group_ids: ['g1'], mailbox_ids: [],
  follow_ups: [{ delay_days: 3, subject: '', body: 'Following up.' }, { delay_days: 5, subject: '', body: 'Last note.' }],
}
const contact = (id, over = {}) => ({ id, workspace_id: WS, email: `${id}@hotel.sa`, first_name: id.toUpperCase(), company: 'Hotel Co', audience: 'cold', consent: 'none', status: 'active', language: 'en', replied_at: null, ...over })

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

/** A workspace with one mailbox, one running campaign, and one row due. */
function world({
  mailbox = MAILBOX, campaign = CAMPAIGN, row = { id: 's-a', campaign_id: 'camp-1', contact_id: 'a', email: 'a@hotel.sa', step: 0, subject: '', body: '', mailbox_id: null },
  person = contact('a'), counts = {}, sendResult = { ok: true, messageId: '<m1@araklighting.com>' },
  mailboxClaim = true, prior = [], secret = 'sealed',
} = {}) {
  const { db, calls } = stubDb([
    { method: 'GET', match: /^email_settings\?cold_sending_enabled/, reply: [{ workspace_id: WS }] },
    { method: 'GET', match: /^email_campaigns\?workspace_id=.*audience=eq\.cold&status=eq\.sending/, reply: [campaign] },
    { method: 'GET', match: /^email_mailboxes\?workspace_id=/, reply: [mailbox] },
    { method: 'GET', match: /^email_sends\?workspace_id=.*mailbox_id=eq\..*step=gt\.0/, reply: row && row.step > 0 ? [row] : [] },
    { method: 'GET', match: /^email_sends\?workspace_id=.*mailbox_id=is\.null&step=eq\.0/, reply: row && row.step === 0 ? [row] : [] },
    { method: 'GET', match: /^email_sends\?campaign_id=.*step=lt\./, reply: prior },
    { method: 'PATCH', match: /^email_mailboxes\?id=eq\..*or=\(next_send_at/, reply: mailboxClaim ? [{ ...mailbox }] : [] },
    { method: 'PATCH', match: /^email_sends\?id=eq\..*status=eq\.queued/, reply: [{ ...row, status: 'sending' }] },
    { method: 'GET', match: /^email_contacts\?id=eq\./, reply: [person] },
    { method: 'GET', match: /^email_mailbox_secrets/, reply: secret ? [{ secret }] : [] },
    { method: 'GET', match: /^email_campaigns\?workspace_id=.*status=eq\.sending&select=id/, reply: [] },
  ])
  const sent = []
  const deps = {
    db, calls,
    count: async path => {
      if (/bounced_at=not\.is\.null/.test(path)) return counts.bounced7 ?? 0
      // The week's window starts 2026-09-20; today's starts at Riyadh midnight.
      if (/mailbox_id=eq\./.test(path)) return /sent_at=gte\.2026-09-20/.test(path) ? (counts.sent7 ?? 0) : (counts.today ?? 0)
      return counts.workspace ?? 0
    },
    mail: { async send(mb, pw, msg) { sent.push({ mb, pw, msg }); return typeof sendResult === 'function' ? sendResult() : sendResult } },
    open: s => (s === 'sealed' ? 'app-password' : null),
    uuid: () => 'uuid-1',
    random: () => 0.5,
  }
  return { deps, calls, sent }
}

const patches = (calls, re) => calls.filter(c => c.method === 'PATCH' && re.test(c.path))
const posts = (calls, re) => calls.filter(c => c.method === 'POST' && re.test(c.path))

describe('coldTick: when it sends', () => {
  it('does nothing at all outside Sunday–Thursday working hours', async () => {
    const w = world()
    const out = await coldTick(w.deps, { now: FRIDAY_11 })
    expect(out.window).toBe(false)
    expect(out.nextWindow).toBe('2026-10-04T06:00:00.000Z')  // Sunday 09:00 Riyadh
    expect(w.calls).toEqual([])
    expect(w.sent).toEqual([])
  })

  it('sends one first email, threaded for later, with the signature and the opt-out line', async () => {
    const w = world()
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(out.sent).toBe(1)
    expect(w.sent).toHaveLength(1)
    const { msg, pw } = w.sent[0]
    expect(pw).toBe('app-password')
    expect(msg.from).toEqual({ name: 'Ahmed', address: 'ahmed@araklighting.com' })
    expect(msg.to).toEqual({ name: 'A', address: 'a@hotel.sa' })
    expect(msg.subject).toBe('Lighting for Hotel Co')
    expect(msg.messageId).toBe('<uuid-1@araklighting.com>')
    expect(msg.inReplyTo).toBeUndefined()
    expect(msg.text).toContain('Hi A,')
    expect(msg.text).toContain('Ahmed\nARAK Lighting')
    expect(msg.text).toContain('reply "stop"')

    // Claimed before sending, then marked sent with the rendered subject kept
    // for the follow-ups' "Re:".
    const rowPatches = patches(w.calls, /^email_sends\?id=eq\.s-a/)
    expect(rowPatches[0].body).toMatchObject({ status: 'sending', mailbox_id: 'mb-1', message_id: '<uuid-1@araklighting.com>' })
    expect(rowPatches.at(-1).body).toMatchObject({ status: 'sent', subject: 'Lighting for Hotel Co' })

    // The next step is queued on the same mailbox, three days on.
    const [queued] = posts(w.calls, /^email_sends\?on_conflict/)
    expect(queued.body[0]).toMatchObject({ step: 1, mailbox_id: 'mb-1', status: 'queued', due_at: '2026-09-30T08:00:00.000Z' })

    // The ramp starts today; the next send is a gap ahead (5/day → 96 min average).
    const mbPatches = patches(w.calls, /^email_mailboxes\?id=eq\.mb-1/)
    expect(mbPatches[0].body.next_send_at).toBe('2026-09-27T09:36:00.000Z')
    expect(mbPatches.at(-1).body).toMatchObject({ first_sent_on: '2026-09-27' })
  })

  it('sends a follow-up in the same thread, as "Re:" the first subject', async () => {
    const row = { id: 's-a1', campaign_id: 'camp-1', contact_id: 'a', email: 'a@hotel.sa', step: 1, subject: '', body: '', mailbox_id: 'mb-1' }
    const w = world({ row, prior: [{ step: 0, subject: 'Lighting for Hotel Co', message_id: '<first@araklighting.com>', status: 'sent' }] })
    await coldTick(w.deps, { now: SUNDAY_11 })
    const { msg } = w.sent[0]
    expect(msg.subject).toBe('Re: Lighting for Hotel Co')
    expect(msg.inReplyTo).toBe('<first@araklighting.com>')
    expect(msg.references).toEqual(['<first@araklighting.com>'])
    expect(msg.text).toContain('Following up.')
    // Step 2 is queued after it.
    expect(posts(w.calls, /^email_sends\?on_conflict/)[0].body[0]).toMatchObject({ step: 2 })
  })

  it('never writes to someone who replied, and ends their other sequences', async () => {
    const w = world({ person: contact('a', { replied_at: '2026-09-26T10:00:00Z' }) })
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(w.sent).toEqual([])
    expect(out.skipped).toBe(1)
    expect(patches(w.calls, /^email_sends\?id=eq\.s-a/).at(-1).body).toMatchObject({ status: 'skipped', error: 'Already replied' })
    expect(patches(w.calls, /^email_sends\?workspace_id=.*contact_id=eq\.a&status=eq\.queued/)[0].body).toMatchObject({ status: 'cancelled' })
    // The gap is handed back: nothing was sent.
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-1$/).at(-1).body).toMatchObject({ next_send_at: null })
  })

  it('waits two weeks after warm-up starts', async () => {
    const w = world({ mailbox: { ...MAILBOX, warmup_started_on: '2026-09-20' } })
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(w.sent).toEqual([])
    expect(out.workspaces[0].mailboxes[0].reason).toMatch(/Ready for outreach on 2026-10-04/)
  })

  it('stops at the ramp: 5 a day in the first week, whatever the limit says', async () => {
    const w = world({ mailbox: { ...MAILBOX, first_sent_on: '2026-09-24', daily_limit: 40 }, counts: { today: 5 } })
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(w.sent).toEqual([])
    expect(out.workspaces[0].mailboxes[0].reason).toMatch(/Today's 5 sent/)
  })

  it('does not send when another run holds the mailbox', async () => {
    const w = world({ mailboxClaim: false })
    await coldTick(w.deps, { now: SUNDAY_11 })
    expect(w.sent).toEqual([])
    expect(patches(w.calls, /^email_sends\?id=eq/)).toEqual([])
  })

  it('respects the gap after the last send', async () => {
    const w = world({ mailbox: { ...MAILBOX, next_send_at: '2026-09-27T08:30:00Z' } })
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(w.sent).toEqual([])
    expect(out.workspaces[0].mailboxes[0].reason).toMatch(/Waiting for its gap/)
  })
})

describe('coldTick: when a send fails', () => {
  it('a rejected address bounces the contact', async () => {
    const err = Object.assign(new Error('550 5.1.1 user unknown'), { command: 'RCPT TO', responseCode: 550 })
    const w = world({ sendResult: { ok: false, error: err } })
    await coldTick(w.deps, { now: SUNDAY_11 })
    expect(patches(w.calls, /^email_sends\?id=eq\.s-a/).at(-1).body).toMatchObject({ status: 'bounced' })
    expect(patches(w.calls, /^email_contacts\?id=eq\.a.*status=eq\.active/)[0].body).toMatchObject({ status: 'bounced' })
    expect(posts(w.calls, /^email_sends\?on_conflict/)).toEqual([])
  })

  it('a refused login stops the mailbox and hands the email back to the queue', async () => {
    const err = Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 })
    const w = world({ sendResult: { ok: false, error: err } })
    await coldTick(w.deps, { now: SUNDAY_11 })
    expect(patches(w.calls, /^email_sends\?id=eq\.s-a/).at(-1).body).toMatchObject({ status: 'queued', mailbox_id: null })
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-1$/).at(-1).body).toMatchObject({ status: 'error' })
  })

  it('an unreadable password stops the mailbox before anything is sent', async () => {
    const w = world({ secret: 'garbage' })
    await coldTick(w.deps, { now: SUNDAY_11 })
    expect(w.sent).toEqual([])
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-1$/).at(-1).body).toMatchObject({ status: 'error' })
  })

  it('the bounce brake pauses a mailbox at 5% over the week', async () => {
    const w = world({ counts: { sent7: 40, bounced7: 2 } })
    await coldTick(w.deps, { now: SUNDAY_11 })
    expect(w.sent).toEqual([])
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-1$/)[0].body).toMatchObject({ status: 'paused' })
  })
})

describe('coldTick: dry run (What goes out next)', () => {
  it('decides but sends and writes nothing, even on a Friday', async () => {
    const w = world()
    const out = await coldTick(w.deps, { now: FRIDAY_11, dryRun: true, workspaceId: WS })
    expect(w.sent).toEqual([])
    expect(w.calls.filter(c => c.method !== 'GET')).toEqual([])
    const line = out.workspaces[0].mailboxes[0]
    expect(line.next).toMatchObject({ email: 'a@hotel.sa', step: 0 })
    expect(line.reason).toMatch(/Outside sending hours/)
  })

  it('says "would send now" inside the window', async () => {
    const w = world()
    const out = await coldTick(w.deps, { now: SUNDAY_11, dryRun: true, workspaceId: WS })
    expect(out.workspaces[0].mailboxes[0]).toMatchObject({ action: 'send', reason: 'Would send now.' })
    expect(w.sent).toEqual([])
  })
})

describe('launchColdCampaign', () => {
  function launchWorld({ mailboxes = [MAILBOX], campaign = { ...CAMPAIGN, status: 'draft' }, contacts = [contact('a'), contact('b')], busy = [] } = {}) {
    return stubDb([
      { method: 'GET', match: /^email_campaigns\?id=eq/, reply: [campaign] },
      { method: 'GET', match: /^email_mailboxes/, reply: mailboxes },
      { method: 'GET', match: /^email_groups/, reply: [{ id: 'g1', audience: 'cold' }] },
      { method: 'GET', match: /^email_group_members/, reply: contacts.map(c => ({ group_id: 'g1', contact_id: c.id })) },
      { method: 'GET', match: /^email_contacts/, reply: contacts },
      { method: 'GET', match: /^email_sends\?workspace_id=.*campaign_id=neq/, reply: busy.map(id => ({ contact_id: id })) },
    ])
  }

  it('queues first emails with no mailbox yet, and starts the campaign', async () => {
    const { db, calls } = launchWorld()
    const out = await launchColdCampaign({ db }, { workspaceId: WS, campaignId: 'camp-1', now: SUNDAY_11 })
    expect(out).toMatchObject({ queued: 2, mailboxes: 1, perDay: 5, scheduled: false })
    const [insert] = posts(calls, /^email_sends\?on_conflict/)
    expect(insert.body.map(r => [r.step, r.mailbox_id, r.status])).toEqual([[0, undefined, 'queued'], [0, undefined, 'queued']])
    expect(patches(calls, /^email_campaigns\?id=eq/)[0].body).toMatchObject({ status: 'sending', recipients: 2, from_email: 'ahmed@araklighting.com' })
  })

  it('leaves out anyone another outreach campaign wrote to in 90 days', async () => {
    const { db, calls } = launchWorld({ busy: ['a'] })
    const out = await launchColdCampaign({ db }, { workspaceId: WS, campaignId: 'camp-1', now: SUNDAY_11 })
    expect(out).toMatchObject({ queued: 1, recontact: 1 })
    expect(posts(calls, /^email_sends\?on_conflict/)[0].body.map(r => r.contact_id)).toEqual(['b'])
  })

  it('refuses when no mailbox has finished warming up, and queues nothing', async () => {
    const { db, calls } = launchWorld({ mailboxes: [{ ...MAILBOX, warmup_started_on: '2026-09-25' }] })
    const out = await launchColdCampaign({ db }, { workspaceId: WS, campaignId: 'camp-1', now: SUNDAY_11 })
    expect(out.status).toBe(409)
    expect(out.error).toMatch(/Ready for outreach on 2026-10-09/)
    expect(posts(calls, /^email_sends/)).toEqual([])
  })

  it('refuses a marketing campaign', async () => {
    const { db } = launchWorld({ campaign: { ...CAMPAIGN, audience: 'marketing', status: 'draft' } })
    const out = await launchColdCampaign({ db }, { workspaceId: WS, campaignId: 'camp-1', now: SUNDAY_11 })
    expect(out.status).toBe(409)
  })

  it('refuses an empty follow-up', () => {
    expect(coldProblems({ ...CAMPAIGN, follow_ups: [{ delay_days: 3, body: '' }] })).toContain('Follow-up 1 is empty: write it or remove it.')
    expect(coldProblems(CAMPAIGN)).toEqual([])
  })
})

describe('sealed mailbox passwords', () => {
  it('open with the same server key and not with another', () => {
    const sealed = sealSecret('abcd efgh ijkl mnop', 'service-key-1')
    expect(sealed).not.toContain('abcd')
    expect(openSecret(sealed, 'service-key-1')).toBe('abcd efgh ijkl mnop')
    expect(openSecret(sealed, 'service-key-2')).toBeNull()
    const [v, iv, tag, ct] = sealed.split(':')
    const flipped = Buffer.from(tag, 'base64'); flipped[0] ^= 1
    expect(openSecret([v, iv, flipped.toString('base64'), ct].join(':'), 'service-key-1')).toBeNull()
    expect(openSecret('', 'service-key-1')).toBeNull()
  })
})
