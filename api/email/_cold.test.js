import { describe, it, expect } from 'vitest'
import { coldTick, launchColdCampaign, coldProblems, readReplies, resolveStuck, resolveStuckByHand } from './_cold.js'
import { STUCK_NEEDS_PERSON } from '../../src/lib/email/cold.js'
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
  mailboxClaim = true, prior = [], secret = 'sealed', mailboxes = null,
} = {}) {
  const { db, calls } = stubDb([
    { method: 'GET', match: /^email_settings\?cold_sending_enabled/, reply: [{ workspace_id: WS }] },
    { method: 'GET', match: /^email_campaigns\?workspace_id=.*audience=eq\.cold&status=eq\.sending/, reply: [campaign] },
    // Fresh copies each time, as the database gives: the run updates its rows in place.
    { method: 'GET', match: /^email_mailboxes\?workspace_id=/, reply: () => (mailboxes || [mailbox]).map(m => ({ ...m })) },
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

describe('coldTick: the run\'s rhythm', () => {
  const three = ['mb-1', 'mb-2', 'mb-3'].map((id, i) => ({ ...MAILBOX, id, email: `rep${i + 1}@araklighting.com` }))

  it('sends at most two emails a run, however many mailboxes are ready', async () => {
    const w = world({ mailboxes: three })
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(out.sent).toBe(2)
    expect(w.sent.map(s => s.mb.id)).toEqual(['mb-1', 'mb-2'])
    expect(out.workspaces[0].mailboxes[2].reason).toMatch(/next run/)
  })

  it('waits a random 0–2 minutes before the first email and 40–100 seconds before the next', async () => {
    const waits = []
    const w = world({ mailboxes: three })
    w.deps.sleep = async ms => { waits.push(ms) }
    await coldTick(w.deps, { now: SUNDAY_11 })
    expect(waits).toEqual([60_000, 70_000])   // random() = 0.5
    // Each email carries the moment it actually left, not the run's start.
    const sentAt = patches(w.calls, /^email_sends\?id=eq\./).filter(p => p.body.status === 'sent').map(p => p.body.sent_at)
    expect(sentAt).toEqual(['2026-09-27T08:01:00.000Z', '2026-09-27T08:02:10.000Z'])
  })

  it('starts nothing that would run past the run\'s time budget', async () => {
    const waits = []
    const w = world({ mailboxes: three })
    w.deps.random = () => 1   // the longest pauses: 120 s, then 100 s → 220 s > 200 s
    w.deps.sleep = async ms => { waits.push(ms) }
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(waits).toEqual([120_000])
    expect(out.sent).toBe(1)
    expect(out.workspaces[0].mailboxes[1].reason).toMatch(/time is used up/)
  })

  it('does not send if the pause runs past 17:00', async () => {
    const w = world()
    w.deps.random = () => 1
    w.deps.sleep = async () => {}
    const out = await coldTick(w.deps, { now: new Date('2026-09-27T13:59:00Z') })  // 16:59 Riyadh
    expect(out.sent).toBe(0)
    expect(w.sent).toEqual([])
    expect(out.workspaces[0].mailboxes[0].reason).toMatch(/hours ended/)
  })

  it('a check (dry run) never waits, and says which mailbox goes on the next run', async () => {
    const w = world({ mailboxes: three })
    let waited = false
    w.deps.sleep = async () => { waited = true }
    const out = await coldTick(w.deps, { now: SUNDAY_11, dryRun: true, workspaceId: WS })
    expect(waited).toBe(false)
    expect(out.workspaces[0].mailboxes.map(m => m.action)).toEqual(['send', 'send', 'wait'])
  })
})

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

describe('Microsoft 365 mailboxes in the sending run', () => {
  const MS_MAILBOX = {
    ...MAILBOX, id: 'mb-1', provider: 'microsoft', email: 'sales1@arak-sa.com', from_name: 'Sales',
    smtp_host: '', imap_host: '', warmup_started_on: null,
  }

  it('the run asks for both kinds of mailbox', async () => {
    const w = world({ mailbox: MS_MAILBOX })
    await coldTick(w.deps, { now: SUNDAY_11 })
    const read = w.calls.find(c => c.method === 'GET' && /^email_mailboxes\?workspace_id=/.test(c.path))
    expect(read.path).toContain('provider=in.(smtp,microsoft)')
  })

  it('sends from a company mailbox with no warm-up date, and keeps Microsoft\'s own Message-ID and thread', async () => {
    const w = world({ mailbox: MS_MAILBOX, sendResult: { ok: true, messageId: '<real@arak-sa.com>', threadId: 'conv-9' } })
    const out = await coldTick(w.deps, { now: SUNDAY_11 })
    expect(out.sent).toBe(1)
    expect(w.sent[0].msg.from).toEqual({ name: 'Sales', address: 'sales1@arak-sa.com' })
    const sent = patches(w.calls, /^email_sends\?id=eq\.s-a$/).at(-1).body
    expect(sent).toMatchObject({ status: 'sent', message_id: '<real@arak-sa.com>', thread_id: 'conv-9', provider_id: '<real@arak-sa.com>' })
  })

  it('a mailbox Microsoft blocked stops with Microsoft\'s reason, and the email waits', async () => {
    const err = Object.assign(new Error('ErrorMessageSubmissionBlocked'), { kind: 'auth', reason: 'Microsoft has blocked this mailbox from sending.' })
    const w = world({ mailbox: MS_MAILBOX, sendResult: { ok: false, error: err } })
    await coldTick(w.deps, { now: SUNDAY_11 })
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-1$/).at(-1).body).toMatchObject({ status: 'error', status_reason: 'Microsoft has blocked this mailbox from sending.' })
    expect(patches(w.calls, /^email_sends\?id=eq\.s-a$/).at(-1).body).toMatchObject({ status: 'queued', mailbox_id: null })
  })
})

describe('readReplies', () => {
  const MB = { id: 'mb-ms', workspace_id: WS, provider: 'microsoft', email: 'sales1@arak-sa.com', status: 'active', inbox_checked_at: '2026-09-27T07:50:00.000Z', created_at: '2026-09-20T00:00:00Z' }
  const ROW = { id: 's-a', workspace_id: WS, contact_id: 'a', thread_id: 'conv/+1=', step: 1 }

  function inboxWorld(messages, { rows = [ROW], inbox } = {}) {
    const { db, calls } = stubDb([
      { method: 'GET', match: /^email_mailboxes\?provider=eq\.microsoft/, reply: [MB] },
      { method: 'GET', match: /^email_mailbox_secrets/, reply: [{ secret: 'sealed' }] },
      { method: 'GET', match: /^email_sends\?mailbox_id=eq\.mb-ms&thread_id=in\./, reply: rows },
      { method: 'PATCH', match: /^email_sends\?id=eq\..*(replied_at|bounced_at)=is\.null/, reply: [{ id: 's-a' }] },
      { method: 'PATCH', match: /^email_contacts\?id=eq\.a&.*status=eq\.active/, reply: [{ id: 'a' }] },
      { method: 'GET', match: /^email_contacts\?id=eq\.a/, reply: [contact('a')] },
      { method: 'GET', match: /^email_groups\?/, reply: [{ id: 'g-cold', name: 'Hotels', audience: 'cold' }] },
      { method: 'POST', match: /^email_groups$/, reply: [{ id: 'g-replied' }] },
    ])
    const asked = []
    const deps = {
      db, open: s => (s === 'sealed' ? '{"rt":"x"}' : null),
      mail: { inbox: async (mb, pw, since) => { asked.push(since); return inbox || { ok: true, messages } } },
    }
    return { deps, calls, asked }
  }
  const msg = over => ({ id: 'm', threadId: 'conv/+1=', from: 'a@hotel.sa', subject: 'RE: Lighting', receivedAt: '2026-09-27T08:05:00Z', ...over })

  it('a reply marks the send and the contact, and cancels everything still queued for them', async () => {
    const w = inboxWorld([msg()])
    const out = await readReplies(w.deps, { now: SUNDAY_11 })
    expect(out).toMatchObject({ mailboxes: 1, replies: 1, bounces: 0 })
    // Read from a minute before the last mark, so nothing on the boundary is missed.
    expect(w.asked[0]).toBe('2026-09-27T07:49:00.000Z')
    // The thread id is URL-encoded inside the filter.
    expect(w.calls.find(c => /thread_id=in/.test(c.path)).path).toContain('thread_id=in.("conv%2F%2B1%3D")')
    expect(patches(w.calls, /^email_sends\?id=eq\.s-a&replied_at=is\.null/)[0].body).toMatchObject({ replied_at: '2026-09-27T08:05:00Z' })
    expect(patches(w.calls, /^email_contacts\?id=eq\.a&.*replied_at=is\.null/)[0].body).toMatchObject({ replied_at: '2026-09-27T08:05:00Z' })
    expect(patches(w.calls, /^email_sends\?workspace_id=.*contact_id=eq\.a&status=eq\.queued/)[0].body).toMatchObject({ status: 'cancelled', error: 'Replied' })
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-ms/).at(-1).body).toEqual({ inbox_checked_at: SUNDAY_11.toISOString() })
  })

  it('a reply moves the prospect to marketing, into "Replied to outreach", out of cold groups', async () => {
    const w = inboxWorld([msg({ preview: 'Yes please, send the guide. Thanks, Sara' })])
    const out = await readReplies(w.deps, { now: SUNDAY_11 })
    expect(out).toMatchObject({ replies: 1, optOuts: 0, movedToMarketing: 1 })
    expect(patches(w.calls, /^email_contacts\?id=eq\.a&workspace_id=eq\.[^&]+$/)[0].body).toMatchObject({ audience: 'marketing', consent: 'business_contact' })
    expect(w.calls.find(c => c.method === 'DELETE').path).toContain('group_id=in.("g-cold")')
    expect(posts(w.calls, /^email_groups$/)[0].body).toMatchObject({ name: 'Replied to outreach', audience: 'marketing' })
    expect(posts(w.calls, /^email_group_members/)[0].body).toEqual([{ group_id: 'g-replied', contact_id: 'a', workspace_id: WS }])
  })

  it('a "stop" reply unsubscribes the prospect and never moves them to marketing', async () => {
    for (const preview of ['Stop emailing me.', 'please remove me from your list', 'Not interested, thanks', 'توقف عن مراسلتي', 'نحن غير مهتمين']) {
      const w = inboxWorld([msg({ preview })])
      const out = await readReplies(w.deps, { now: SUNDAY_11 })
      expect(out, preview).toMatchObject({ replies: 1, optOuts: 1, movedToMarketing: 0 })
      expect(patches(w.calls, /^email_contacts\?id=eq\.a&.*status=eq\.active/)[0].body).toMatchObject({ status: 'unsubscribed' })
      expect(w.calls.some(c => c.method === 'POST' && /^email_group/.test(c.path))).toBe(false)
    }
  })

  it('our own "reply stop" line in the quoted email is not read as the prospect saying stop', async () => {
    const preview = 'Sounds good, call me Sunday. From: Hafeez <hafeez@arak-sa.com> Sent: Sunday Hi Sara, ... If this is not relevant to you, just reply "stop"'
    const w = inboxWorld([msg({ preview })])
    const out = await readReplies(w.deps, { now: SUNDAY_11 })
    expect(out).toMatchObject({ optOuts: 0, movedToMarketing: 1 })
  })

  it('a non-delivery report bounces the send and the contact', async () => {
    const w = inboxWorld([msg({ from: 'postmaster@araksa.onmicrosoft.com', subject: 'Undeliverable: Lighting for Hotel Co' })])
    const out = await readReplies(w.deps, { now: SUNDAY_11 })
    expect(out).toMatchObject({ replies: 0, bounces: 1 })
    expect(patches(w.calls, /^email_sends\?id=eq\.s-a&bounced_at=is\.null/)[0].body).toMatchObject({ status: 'bounced' })
    expect(patches(w.calls, /^email_contacts\?id=eq\.a&.*status=eq\.active/)[0].body).toMatchObject({ status: 'bounced' })
  })

  it('an out-of-office changes nothing, and mail outside our threads is left alone', async () => {
    const w = inboxWorld([msg({ subject: 'Automatic reply: Lighting' }), msg({ threadId: 'someone-else' })], { rows: [ROW] })
    const out = await readReplies(w.deps, { now: SUNDAY_11 })
    expect(out).toMatchObject({ replies: 0, bounces: 0 })
    expect(patches(w.calls, /^email_(sends|contacts)/)).toEqual([])
  })

  it('a refused login stops the mailbox with the reason, and the error is reported', async () => {
    const err = Object.assign(new Error('invalid_grant'), { kind: 'auth', reason: 'Microsoft no longer accepts this mailbox\'s sign-in. Reconnect it.' })
    const w = inboxWorld([], { inbox: { ok: false, error: err } })
    const out = await readReplies(w.deps, { now: SUNDAY_11 })
    expect(out.errors[0]).toMatch(/sales1@arak-sa\.com/)
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-ms/)[0].body).toMatchObject({ status: 'error' })
  })

  it('a full page carries on next time from its last message', async () => {
    const page = Array.from({ length: 50 }, (_, i) => msg({ id: `m${i}`, threadId: `t${i}`, receivedAt: `2026-09-27T08:${String(i).padStart(2, '0')}:00Z` }))
    const w = inboxWorld(page, { rows: [] })
    await readReplies(w.deps, { now: SUNDAY_11 })
    expect(patches(w.calls, /^email_mailboxes\?id=eq\.mb-ms/).at(-1).body).toEqual({ inbox_checked_at: '2026-09-27T08:49:00Z' })
  })
})


describe('resolveStuck: emails a dead run left in sending', () => {
  const NOW = new Date('2026-09-27T09:00:00Z')
  const MS_MB = { ...MAILBOX, id: 'mb-ms', provider: 'microsoft', email: 'sales1@arak-sa.com' }
  const stuckRow = (over = {}) => ({
    id: 's-1', workspace_id: WS, campaign_id: 'camp-1', contact_id: 'a', email: 'a@hotel.sa', step: 0,
    mailbox_id: 'mb-ms', message_id: '<u1@arak-sa.com>', subject: null, updated_at: '2026-09-27T08:00:00+00:00', error: '', ...over,
  })
  function stuckWorld({ rows = [stuckRow()], mailbox = MS_MB, found = { ok: true, state: 'sent', messageId: '<u1@arak-sa.com>', threadId: 'conv-1', subject: 'Lighting', sentAt: '2026-09-27T08:00:04Z' } } = {}) {
    const { db, calls } = stubDb([
      { method: 'GET', match: /^email_sends\?status=eq\.sending&updated_at=lt\./, reply: rows },
      { method: 'GET', match: /^email_mailboxes\?id=in\./, reply: [mailbox] },
      { method: 'GET', match: /^email_campaigns\?id=in\./, reply: [CAMPAIGN] },
      { method: 'GET', match: /^email_mailbox_secrets/, reply: [{ secret: 'sealed' }] },
    ])
    const asked = []
    const deps = {
      db, open: s => (s === 'sealed' ? 'tokens' : null),
      mail: { findSent: async (mb, pw, q) => { asked.push(q); return found } },
    }
    return { deps, calls, asked }
  }

  it('only looks at rows claimed more than 30 minutes ago', async () => {
    const w = stuckWorld({ rows: [] })
    await resolveStuck(w.deps, { now: NOW })
    expect(w.calls[0].path).toContain('updated_at=lt.2026-09-27T08:30:00.000Z')
  })

  it('found in Sent Items: recorded as sent, and its follow-up queued from the real send time', async () => {
    const w = stuckWorld()
    const out = await resolveStuck(w.deps, { now: NOW })
    expect(out.sent).toBe(1)
    expect(w.asked[0]).toEqual({ messageId: '<u1@arak-sa.com>', to: 'a@hotel.sa', since: '2026-09-27T08:00:00+00:00' })
    const sent = patches(w.calls, /^email_sends\?id=eq\.s-1/)[0].body
    expect(sent).toMatchObject({ status: 'sent', sent_at: '2026-09-27T08:00:04Z', thread_id: 'conv-1', error: '' })
    const [next] = posts(w.calls, /^email_sends\?on_conflict/)[0].body
    expect(next).toMatchObject({ step: 1, status: 'queued', mailbox_id: 'mb-ms', due_at: '2026-09-30T08:00:04.000Z' })
  })

  it('still a draft: it never left, so it goes back in the queue for any mailbox', async () => {
    const w = stuckWorld({ found: { ok: true, state: 'draft' } })
    const out = await resolveStuck(w.deps, { now: NOW })
    expect(out.requeued).toBe(1)
    expect(patches(w.calls, /^email_sends\?id=eq\.s-1/)[0].body).toMatchObject({ status: 'queued', mailbox_id: null, message_id: null })
    expect(posts(w.calls, /^email_sends\?on_conflict/)).toHaveLength(0)
  })

  it('a stuck follow-up that never left keeps its thread\'s mailbox', async () => {
    const w = stuckWorld({ rows: [stuckRow({ step: 1 })], found: { ok: true, state: 'draft' } })
    await resolveStuck(w.deps, { now: NOW })
    expect(patches(w.calls, /^email_sends\?id=eq\.s-1/)[0].body).toMatchObject({ status: 'queued', mailbox_id: 'mb-ms' })
  })

  it('in neither folder: never resent by itself; a person is asked, once', async () => {
    const w = stuckWorld({ found: { ok: true, state: 'none' } })
    expect((await resolveStuck(w.deps, { now: NOW })).needsPerson).toBe(1)
    const p = patches(w.calls, /^email_sends\?id=eq\.s-1/)
    expect(p).toHaveLength(1)
    expect(p[0].body).toEqual({ error: STUCK_NEEDS_PERSON.microsoft })

    const again = stuckWorld({ rows: [stuckRow({ error: STUCK_NEEDS_PERSON.microsoft })], found: { ok: true, state: 'none' } })
    await resolveStuck(again.deps, { now: NOW })
    expect(patches(again.calls, /^email_sends/)).toHaveLength(0)
  })

  it('an SMTP mailbox cannot be asked, so a person decides', async () => {
    const w = stuckWorld({ mailbox: MAILBOX, rows: [stuckRow({ mailbox_id: 'mb-1' })] })
    await resolveStuck(w.deps, { now: NOW })
    expect(w.asked).toHaveLength(0)
    expect(patches(w.calls, /^email_sends\?id=eq\.s-1/)[0].body).toEqual({ error: STUCK_NEEDS_PERSON.smtp })
  })

  it('a failed look changes nothing', async () => {
    const w = stuckWorld({ found: { ok: false, error: new Error('503') } })
    const out = await resolveStuck(w.deps, { now: NOW })
    expect(out.errors).toHaveLength(1)
    expect(patches(w.calls, /^email_sends/)).toHaveLength(0)
  })
})

describe('resolveStuckByHand', () => {
  const NOW = new Date('2026-09-27T09:00:00Z')
  const row = (over = {}) => ({
    id: 's-1', workspace_id: WS, campaign_id: 'camp-1', contact_id: 'a', email: 'a@hotel.sa', step: 0, status: 'sending',
    mailbox_id: 'mb-1', message_id: '<u1@x>', updated_at: '2026-09-27T08:00:00+00:00', error: '', ...over,
  })
  function handWorld({ found = row(), claimed = true } = {}) {
    const { db, calls } = stubDb([
      { method: 'GET', match: /^email_sends\?id=eq\.s-1&workspace_id/, reply: found ? [found] : [] },
      { method: 'PATCH', match: /status=eq\.sending&updated_at=eq\./, reply: claimed ? [{ id: 's-1' }] : [] },
      { method: 'GET', match: /^email_campaigns\?id=eq\./, reply: [CAMPAIGN] },
      { method: 'GET', match: /^email_mailboxes\?id=eq\./, reply: [{ id: 'mb-1' }] },
    ])
    return { deps: { db }, calls }
  }
  const run = (w, outcome) => resolveStuckByHand(w.deps, { workspaceId: WS, sendId: 's-1', outcome, by: 'hafeez@arak-sa.com', now: NOW })

  it('refuses a row that is not stuck: a send in progress is never second-guessed', async () => {
    const w = handWorld({ found: row({ updated_at: '2026-09-27T08:50:00+00:00' }) })
    expect(await run(w, 'retry')).toMatchObject({ status: 409 })
    expect(patches(w.calls, /^email_sends/)).toHaveLength(0)
  })

  it('send again: back in the queue, guarded so only one answer wins', async () => {
    const w = handWorld()
    expect(await run(w, 'retry')).toEqual({ send_id: 's-1', outcome: 'retry' })
    const [p] = patches(w.calls, /^email_sends/)
    expect(p.path).toContain('updated_at=eq.2026-09-27T08%3A00%3A00%2B00%3A00')
    expect(p.body).toMatchObject({ status: 'queued', mailbox_id: null, message_id: null })
  })

  it('drop: skipped, and says who dropped it', async () => {
    const w = handWorld()
    await run(w, 'drop')
    expect(patches(w.calls, /^email_sends/)[0].body).toMatchObject({ status: 'skipped', error: 'Dropped by hafeez@arak-sa.com: not sent.' })
  })

  it('it went out: recorded as sent at the claim time, and the follow-up queued', async () => {
    const w = handWorld()
    await run(w, 'sent')
    const p = patches(w.calls, /^email_sends\?id=eq\.s-1/)
    expect(p.at(-1).body).toMatchObject({ status: 'sent', sent_at: '2026-09-27T08:00:00+00:00' })
    expect(posts(w.calls, /^email_sends\?on_conflict/)[0].body[0]).toMatchObject({ step: 1, mailbox_id: 'mb-1' })
  })

  it('two answers at once: the second is told someone else answered', async () => {
    const w = handWorld({ claimed: false })
    expect(await run(w, 'sent')).toMatchObject({ status: 409 })
    expect(posts(w.calls, /^email_sends/)).toHaveLength(0)
  })
})

describe('coldTick: the sending domain\'s DNS check', () => {
  const GOOD = { domain: 'araklighting.com', blocking: [], warnings: [], checked_at: '2026-09-27T08:00:00.000Z' }
  const BAD = { domain: 'araklighting.com', blocking: ['araklighting.com has no DKIM record, so its emails are unsigned.'], warnings: [], checked_at: '2026-09-27T08:00:00.000Z' }

  it('looks the domain up before the first send, stores it, and sends when it passes', async () => {
    const { deps, calls, sent } = world()
    const asked = []
    deps.dns = async (domain, kind) => { asked.push([domain, kind]); return GOOD }
    await coldTick(deps, { now: SUNDAY_11 })
    expect(asked).toEqual([['araklighting.com', 'google']])
    expect(patches(calls, /^email_mailboxes\?id=eq\.mb-1$/).some(c => c.body.dns_check === GOOD && c.body.dns_checked_at)).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('a domain with no DKIM sends nothing, and says why', async () => {
    const { deps, sent } = world()
    deps.dns = async () => BAD
    const out = await coldTick(deps, { now: SUNDAY_11 })
    expect(sent).toHaveLength(0)
    expect(out.workspaces[0].mailboxes[0].reason).toMatch(/not ready for outreach: araklighting\.com has no DKIM/)
  })

  it('a check from the last 12 hours is trusted, not repeated', async () => {
    const { deps, sent } = world({ mailbox: { ...MAILBOX, dns_check: GOOD, dns_checked_at: '2026-09-27T02:00:00Z' } })
    let asked = 0
    deps.dns = async () => { asked++; return BAD }
    await coldTick(deps, { now: SUNDAY_11 })
    expect(asked).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('a lookup that fails outright keeps the last verdict, so a slow resolver never clears a bad domain', async () => {
    const { deps, sent } = world({ mailbox: { ...MAILBOX, dns_check: BAD, dns_checked_at: '2026-09-25T02:00:00Z' } })
    deps.dns = async () => { throw new Error('fetch failed') }
    await coldTick(deps, { now: SUNDAY_11 })
    expect(sent).toHaveLength(0)
  })

  it('three mailboxes on one domain: one lookup', async () => {
    const three = ['mb-1', 'mb-2', 'mb-3'].map((id, i) => ({ ...MAILBOX, id, email: `rep${i + 1}@araklighting.com` }))
    const { deps } = world({ mailboxes: three })
    let asked = 0
    deps.dns = async () => { asked++; return GOOD }
    await coldTick(deps, { now: SUNDAY_11 })
    expect(asked).toBe(1)
  })

  it('a dry run checks but stores nothing', async () => {
    const { deps, calls } = world()
    deps.dns = async () => BAD
    const out = await coldTick(deps, { now: SUNDAY_11, dryRun: true, workspaceId: WS })
    expect(out.workspaces[0].mailboxes[0].reason).toMatch(/not ready for outreach/)
    expect(patches(calls, /^email_mailboxes\?id=eq\.mb-1$/)).toHaveLength(0)
  })
})

describe('coldTick: a warm-up service on the mailbox', () => {
  it('warm-up emails count against the day: 20 warm-up and a limit of 40 leave 30', async () => {
    const mb = { ...MAILBOX, daily_limit: 40, first_sent_on: '2026-08-01', warmup_per_day: 20 }
    const { deps, sent } = world({ mailbox: mb, counts: { today: 30 } })
    const out = await coldTick(deps, { now: SUNDAY_11 })
    expect(sent).toHaveLength(0)
    expect(out.workspaces[0].mailboxes[0]).toMatchObject({ capToday: 30, reason: 'Today\'s 30 sent. More tomorrow.' })
  })
})
