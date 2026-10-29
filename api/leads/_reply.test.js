import { describe, it, expect } from 'vitest'
import { sendAfterFor, repeatOf, alreadyAnswered, replyMailbox, runAutoReplies, copySignature, DELAY_MIN, DELAY_MAX } from './_reply.js'

// Auto-replies (2026-10-29): queue a qualified lead's acknowledgement, send it
// 15–20 minutes later from the mailbox it came to, with that mailbox's
// signature. Fake PostgREST, fake Microsoft Graph, fake model. Made-up people
// and companies only (this repo is public).

const WS = '11111111-1111-4111-8111-111111111111'
const SINCE = '2026-10-29T08:00:00.000Z'
const MB = { id: 'mb-1', workspace_id: WS, email: 'a.box@example.com', label: 'info@example.com', tenant: '', status: 'active', can_send: true, created_at: '2026-10-01',
  reply_signature: { html: '<table><tr><td><img src="cid:logo-1">Customer Care</td></tr></table>', images: [{ cid: 'logo-1', name: 'image.png', type: 'image/png', bytes: 'AAAA' }] } }

const lead = (over) => ({
  workspace_id: WS, source: 'email', mailbox: 'info@example.com', source_ref: `<${over.id}@client.example>`, name: 'Khalid Nasser', company: 'Example Dev',
  email: 'khalid@client.example', phone: '', subject: 'RFQ – Lighting – Nour Towers', message: 'Please quote the fixtures in the attached BOQ.', summary: 'Quote fixtures for Nour Towers.',
  language: 'en', received_at: '2026-10-29T09:00:00.000Z', verdict: 'qualified', human_verdict: null, duplicate_of: null, ...over,
})

function world({ since = SINCE, leads, conversation = [], mailboxes = [MB], modelText = '{"topic":"the lighting fixtures for Nour Towers"}' } = {}) {
  const state = {
    now: '2026-10-29T09:05:00.000Z',
    since, leads, replies: [], mailboxes, sent: [], usage: [], conversation, modelCalls: 0, nextId: 1,
  }
  const pick = (path, key) => decodeURIComponent((path.match(new RegExp(`${key.replace(/[.()]/g, '\\$&')}([^&]+)`)) || [])[1] || '')
  const db = async (path, { method = 'GET', body } = {}) => {
    if (path.startsWith('lead_agent_settings?')) return [{ auto_reply_since: state.since }]
    if (path.startsWith('workspaces?')) return [{ name: 'Example Lighting' }]
    if (path === 'agent_usage') { state.usage.push(body); return null }
    if (path.startsWith('leads?')) {
      if (/[?&]id=eq\./.test(path)) return state.leads.filter((l) => path.includes(`id=eq.${l.id}`)).map((l) => ({ ...l }))
      const from = pick(path, 'received_at=gte.')
      return state.leads.filter((l) => l.received_at >= from && !l.duplicate_of && (l.verdict === 'qualified' || l.human_verdict === 'qualified')).map((l) => ({ ...l }))
    }
    if (path.startsWith('lead_mailboxes?')) return state.mailboxes.filter((m) => !/[?&]id=eq\./.test(path) || path.includes(`id=eq.${m.id}`))
    if (path.startsWith('lead_mailbox_secrets?')) return [{ mailbox_id: MB.id, secret: JSON.stringify({ rt: 'r', at: 'tok', exp: Date.parse(state.now) + 3_600_000 }) }]
    if (path === 'lead_replies' && method === 'POST') {
      if (state.replies.some((r) => r.lead_id === body.lead_id && r.status !== 'test')) throw new Error('Supabase 409: duplicate key')
      state.replies.push({ id: `r${state.nextId++}`, sent_at: null, error: '', skip_reason: '', ...body })
      return null
    }
    if (path.startsWith('lead_replies?')) {
      if (path.includes('lead_id=in.')) return state.replies.filter((r) => r.status !== 'test' && path.includes(r.lead_id)).map((r) => ({ lead_id: r.lead_id }))
      if (path.includes('status=in.(due,sent)')) return state.replies.filter((r) => ['due', 'sent'].includes(r.status)).map((r) => ({ id: r.id, lead: state.leads.find((l) => l.id === r.lead_id) }))
      if (method === 'PATCH' && path.includes('sent_at=lt.')) {
        const before = pick(path, 'sent_at=lt.')
        state.replies.filter((r) => r.status === 'due' && r.sent_at && r.sent_at < before).forEach((r) => Object.assign(r, body))
        return null
      }
      if (method === 'PATCH') {
        const rows = state.replies.filter((r) => path.includes(`id=eq.${r.id}`) && (!path.includes('status=eq.due') || r.status === 'due') && (!path.includes('sent_at=is.null') || !r.sent_at))
        rows.forEach((r) => Object.assign(r, body))
        return rows.map((r) => ({ ...r }))
      }
      const until = pick(path, 'send_after=lte.')
      return state.replies.filter((r) => r.status === 'due' && !r.sent_at && r.send_after <= until).map((r) => ({ ...r }))
    }
    throw new Error(`fake db: ${method} ${path}`)
  }
  const fetchFn = async (url, init = {}) => {
    const u = decodeURIComponent(String(url))
    if (u.includes('/me/messages?') && u.includes('internetMessageId')) return new Response(JSON.stringify({ value: [{ id: 'graph-id-1', conversationId: 'conv-1' }] }))
    if (u.includes('/me/messages?') && u.includes('conversationId')) return new Response(JSON.stringify({ value: state.conversation }))
    if (u.endsWith('/reply') || u.endsWith('/me/sendMail')) {
      state.sent.push({ url: u, body: JSON.parse(init.body) })
      return new Response(null, { status: 202 })
    }
    throw new Error(`fake fetch: ${u}`)
  }
  const deps = {
    db, fetch: fetchFn, now: () => new Date(state.now), open: (s) => s, seal: (s) => s,
    ms: { configured: true, clientId: 'c', secret: 's', tenant: 't' },
    model: async () => { state.modelCalls++; return { text: modelText, usage: { cost: 0.0004 } } },
  }
  return { state, deps }
}

const run = (w) => runAutoReplies(w.deps, { workspaceId: WS })

describe('the helpers', () => {
  it('waits 15–20 minutes after the email, or after a person approved it', () => {
    const now = new Date('2026-10-29T12:00:00Z')
    const agent = sendAfterFor({ verdict: 'qualified', received_at: '2026-10-29T11:00:00Z' }, now, 0)
    expect(agent.toISOString()).toBe(`2026-10-29T11:${DELAY_MIN}:00.000Z`)
    expect(sendAfterFor({ verdict: 'qualified', received_at: '2026-10-29T11:00:00Z' }, now, 1).toISOString()).toBe(`2026-10-29T11:${DELAY_MAX}:00.000Z`)
    const approved = sendAfterFor({ verdict: 'needs_review', human_verdict: 'qualified', received_at: '2026-10-29T08:00:00Z' }, now, 0)
    expect(approved.toISOString()).toBe('2026-10-29T12:15:00.000Z')
  })
  it('finds the same request again within 14 days, by sender and subject', () => {
    const earlier = [{ lead: { email: 'k@client.example', subject: 'RFQ – Towers', received_at: '2026-10-20T09:00:00Z' } }]
    expect(repeatOf({ email: 'K@client.example', subject: 'RE: RFQ – Towers', received_at: '2026-10-29T09:00:00Z' }, earlier)).toBe(earlier[0])
    expect(repeatOf({ email: 'k@client.example', subject: 'RFQ – Villas', received_at: '2026-10-29T09:00:00Z' }, earlier)).toBeNull()
    expect(repeatOf({ email: 'k@client.example', subject: 'RFQ – Towers', received_at: '2026-11-10T09:00:00Z' }, earlier)).toBeNull()
  })
  it('counts a real answer to the customer, not a forward inside the company', () => {
    const at = { receivedAt: '2026-10-29T09:00:00Z', ownDomains: ['example.com'] }
    const forward = { from: { emailAddress: { address: 'info@example.com' } }, toRecipients: [{ emailAddress: { address: 'omar@example.com' } }], sentDateTime: '2026-10-29T09:02:00Z' }
    const answer = { from: { emailAddress: { address: 'omar@example.com' } }, toRecipients: [{ emailAddress: { address: 'khalid@client.example' } }], sentDateTime: '2026-10-29T09:03:00Z' }
    const theirs = { from: { emailAddress: { address: 'khalid@client.example' } }, toRecipients: [{ emailAddress: { address: 'info@example.com' } }], receivedDateTime: '2026-10-29T09:00:00Z' }
    expect(alreadyAnswered([theirs, forward], at)).toBe(false)
    expect(alreadyAnswered([theirs, forward, answer], at)).toBe(true)
  })
  it('replies from the mailbox the email came to; a website enquiry from the first that may send', () => {
    const other = { ...MB, id: 'mb-2', label: 'info@other.example', email: 'info@other.example' }
    expect(replyMailbox({ source: 'email', mailbox: 'info@other.example' }, [MB, other])).toBe(other)
    expect(replyMailbox({ source: 'website_form' }, [{ ...MB, can_send: false }, other])).toBe(other)
  })
})

describe('queueing', () => {
  it('is off until the company switches it on', async () => {
    const w = world({ since: null, leads: [lead({ id: 'l1' })] })
    expect(await run(w)).toEqual({ off: true })
    expect(w.state.replies).toEqual([])
  })
  it('queues a qualified lead with its reply, 15–20 minutes after it arrived', async () => {
    const w = world({ leads: [lead({ id: 'l1' })] })
    const out = await run(w)
    expect(out).toMatchObject({ queued: 1, skipped: 0, sent: 0 })
    const [r] = w.state.replies
    expect(r).toMatchObject({ lead_id: 'l1', status: 'due', format: 'acknowledge', subject: 'RE: RFQ – Lighting – Nour Towers', model: 'deepseek/deepseek-v4.1-flash' })
    expect(r.body).toBe('Dear Khalid Nasser,\n\nThank you for your enquiry regarding the lighting fixtures for Nour Towers.\n\nWe have received your request, and our sales team is reviewing it now. A sales engineer will contact you as soon as possible.')
    const wait = (Date.parse(r.send_after) - Date.parse('2026-10-29T09:00:00Z')) / 60_000
    expect(wait).toBeGreaterThanOrEqual(15)
    expect(wait).toBeLessThanOrEqual(20)
    expect(w.state.usage[0]).toMatchObject({ surface: 'lead_auto_reply', cost_usd: 0.0004 })
  })
  it('never answers a lead from before it was switched on, an unqualified one or a duplicate', async () => {
    const w = world({ leads: [
      lead({ id: 'old', received_at: '2026-10-29T07:00:00.000Z' }),
      lead({ id: 'no', verdict: 'unqualified' }),
      lead({ id: 'nr', verdict: 'needs_review' }),
      lead({ id: 'dup', duplicate_of: 'l0' }),
    ] })
    expect(await run(w)).toMatchObject({ queued: 0 })
    expect(w.state.replies).toEqual([])
  })
  it('answers a needs-review lead once a person approves it', async () => {
    const w = world({ leads: [lead({ id: 'nr', verdict: 'needs_review', human_verdict: 'qualified' })] })
    await run(w)
    expect(w.state.replies[0]).toMatchObject({ lead_id: 'nr', status: 'due' })
  })
  it('skips the same request again, and a lead with no address, without a model call', async () => {
    const w = world({ leads: [
      lead({ id: 'a', received_at: '2026-10-29T09:00:00.000Z' }),
      lead({ id: 'b', received_at: '2026-10-29T09:30:00.000Z', subject: 'RE: RFQ – Lighting – Nour Towers' }),
      lead({ id: 'c', source: 'website_form', email: '', received_at: '2026-10-29T09:40:00.000Z' }),
    ] })
    w.state.now = '2026-10-29T09:41:00.000Z'
    await run(w)
    // 'a' is already past its 15–20 minutes at 09:41, so it goes in the same round.
    expect(w.state.replies.map((r) => [r.lead_id, r.status])).toEqual([['a', 'sent'], ['b', 'skipped'], ['c', 'skipped']])
    expect(w.state.replies[1].skip_reason).toMatch(/^Same request again/)
    expect(w.state.modelCalls).toBe(1)
  })
  it('queues a lead only once, round after round', async () => {
    const w = world({ leads: [lead({ id: 'l1' })] })
    await run(w)
    await run(w)
    expect(w.state.replies).toHaveLength(1)
    expect(w.state.modelCalls).toBe(1)
  })
})

describe('sending', () => {
  it('waits for its time, then replies on the thread with the signature and its pictures', async () => {
    const w = world({ leads: [lead({ id: 'l1' })] })
    await run(w)
    expect(w.state.sent).toEqual([])
    w.state.now = '2026-10-29T09:21:00.000Z'
    expect(await run(w)).toMatchObject({ sent: 1, failed: 0 })
    const [s] = w.state.sent
    expect(s.url).toBe('https://graph.microsoft.com/v1.0/me/messages/graph-id-1/reply')
    expect(s.body.message.from).toEqual({ emailAddress: { address: 'info@example.com' } })
    expect(s.body.message.body.content).toContain('Thank you for your enquiry regarding the lighting fixtures for Nour Towers.')
    expect(s.body.message.body.content).toContain('Customer Care')
    expect(s.body.message.attachments).toEqual([{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'image.png', contentType: 'image/png', contentBytes: 'AAAA', contentId: 'logo-1', isInline: true }])
    expect(w.state.replies[0]).toMatchObject({ status: 'sent', error: '' })
    // Never twice.
    w.state.now = '2026-10-29T09:30:00.000Z'
    await run(w)
    expect(w.state.sent).toHaveLength(1)
  })
  it('answers a website enquiry with a new email to the address it gave', async () => {
    const w = world({ leads: [lead({ id: 'w1', source: 'website_form', mailbox: '', email: 'nora@client.example', name: 'Nora', subject: 'Hotel' })] })
    await run(w)
    w.state.now = '2026-10-29T09:21:00.000Z'
    await run(w)
    const [s] = w.state.sent
    expect(s.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail')
    expect(s.body.message).toMatchObject({ subject: 'Your enquiry to Example Lighting', toRecipients: [{ emailAddress: { address: 'nora@client.example', name: 'Nora' } }], from: { emailAddress: { address: 'info@example.com' } } })
  })
  it('skips when someone at the company answered first', async () => {
    const answer = { from: { emailAddress: { address: 'omar@example.com' } }, toRecipients: [{ emailAddress: { address: 'khalid@client.example' } }], sentDateTime: '2026-10-29T09:10:00Z' }
    const w = world({ leads: [lead({ id: 'l1' })], conversation: [answer] })
    await run(w)
    w.state.now = '2026-10-29T09:21:00.000Z'
    expect(await run(w)).toMatchObject({ sent: 0, skipped: 1 })
    expect(w.state.sent).toEqual([])
    expect(w.state.replies[0]).toMatchObject({ status: 'skipped', skip_reason: 'Someone at the company already replied on this thread.' })
  })
  it('skips a lead a person turned down before its time came', async () => {
    const w = world({ leads: [lead({ id: 'l1' })] })
    await run(w)
    w.state.leads[0].human_verdict = 'unqualified'
    w.state.now = '2026-10-29T09:21:00.000Z'
    await run(w)
    expect(w.state.sent).toEqual([])
    expect(w.state.replies[0]).toMatchObject({ status: 'skipped', skip_reason: 'No longer a qualified lead.' })
  })
  it('marks a send that never finished as failed and never retries it', async () => {
    const w = world({ leads: [lead({ id: 'l1' })] })
    await run(w)
    Object.assign(w.state.replies[0], { sent_at: '2026-10-29T09:20:00.000Z' })
    w.state.now = '2026-10-29T09:40:00.000Z'
    await run(w)
    expect(w.state.sent).toEqual([])
    expect(w.state.replies[0]).toMatchObject({ status: 'failed' })
  })
  it('ends with the plain signature when the mailbox has none copied', async () => {
    const w = world({ leads: [lead({ id: 'l1' })], mailboxes: [{ ...MB, reply_signature: {} }] })
    await run(w)
    w.state.now = '2026-10-29T09:21:00.000Z'
    await run(w)
    expect(w.state.sent[0].body.message.body.content).toContain('>ARAK Lighting</div>')
    expect(w.state.sent[0].body.message.attachments).toEqual([])
  })
})

describe('copying the Outlook signature', () => {
  it('takes it from the newest draft that has one, pictures included', async () => {
    const w = world({ leads: [] })
    let saved = null
    const db0 = w.deps.db
    w.deps.db = async (path, opts = {}) => {
      if (path.startsWith('lead_mailboxes?') && opts.method === 'PATCH') { saved = opts.body.reply_signature; return null }
      return db0(path, opts)
    }
    w.deps.fetch = async (url) => {
      const u = decodeURIComponent(String(url))
      if (u.includes('/mailFolders/drafts/messages')) {
        return new Response(JSON.stringify({ value: [
          { id: 'd-old', subject: '', lastModifiedDateTime: '2026-10-01T00:00:00Z', body: { content: '<body><div id="Signature"><p>Old</p></div></body>' } },
          { id: 'd-new', subject: '', lastModifiedDateTime: '2026-10-29T00:00:00Z', body: { content: '<body><div id="Signature"><img src="cid:logo-1"><p>Customer Care</p></div></body>' } },
        ] }))
      }
      if (u.includes('/messages/d-new/attachments')) return new Response(JSON.stringify({ value: [{ contentId: 'logo-1', name: 'image.png', contentType: 'image/png', contentBytes: 'AAAA' }] }))
      throw new Error(`fake fetch: ${u}`)
    }
    const out = await copySignature(w.deps, { workspaceId: WS, mailboxId: MB.id })
    expect(out).toEqual({ ok: true, from: 'Drafts: (no subject)', pictures: 1 })
    expect(saved.html).toBe('<img src="cid:logo-1"><p>Customer Care</p>')
    expect(saved.images).toEqual([{ cid: 'logo-1', name: 'image.png', type: 'image/png', bytes: 'AAAA' }])
  })
})

