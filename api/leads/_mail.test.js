import { describe, it, expect } from 'vitest'
import { skipReason, stripQuoted, messageToEnvelope, checkMailbox, finishConnect, MAIL_MAX_MODEL_CALLS } from './_mail.js'
import { intakeWebsite } from './_intake.js'

// Made-up mail only: this repo is public.
const WS = '00000000-0000-0000-0000-0000000000bb'
const MB = { id: '00000000-0000-0000-0000-0000000000c1', workspace_id: WS, email: 'info@example-co.sa', status: 'active', read_from: '2026-10-01T00:00:00Z' }
const NOW = new Date('2026-10-06T12:00:00Z')

const msg = (n, over = {}) => ({
  id: `m${n}`, internetMessageId: `<msg-${n}@mail.example.com>`, conversationId: `conv-${n}`,
  subject: `Enquiry ${n}`, from: { emailAddress: { name: 'Sara Ali', address: `buyer${n}@client.example` } },
  receivedDateTime: `2026-10-06T0${n}:00:00Z`, body: { contentType: 'text', content: `Please quote 30 downlights for our villa, request ${n}.` },
  internetMessageHeaders: [], webLink: `https://outlook.office.com/m${n}`, isDraft: false, ...over,
})

describe('skipReason', () => {
  const own = { ownDomain: 'example-co.sa' }
  it('lets a real enquiry through', () => expect(skipReason(msg(1), own)).toBe(''))
  it('skips colleagues, automatic senders, newsletters, auto-replies and the website form copy', () => {
    expect(skipReason(msg(1, { from: { emailAddress: { address: 'hani@example-co.sa' } } }), own)).toBe('colleague')
    expect(skipReason(msg(1, { from: { emailAddress: { address: 'no-reply@shop.example' } } }), own)).toBe('automatic sender')
    expect(skipReason(msg(1, { internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:x>' }] }), own)).toBe('newsletter')
    expect(skipReason(msg(1, { subject: 'Automatic reply: Enquiry' }), own)).toBe('automatic reply')
    expect(skipReason(msg(1, { subject: 'Undeliverable: Hello' }), own)).toBe('automatic reply')
    expect(skipReason(msg(1, { internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'auto-generated' }] }), own)).toBe('automatic')
    expect(skipReason(msg(1, { subject: 'Lighting enquiry — Omar (Nour)', from: { emailAddress: { name: 'ARAK website', address: 'site@gmail.com' } } }), own)).toBe('website form copy')
  })
  it('a normal "Auto-Submitted: no" header is not automatic', () => {
    expect(skipReason(msg(1, { internetMessageHeaders: [{ name: 'auto-submitted', value: 'no' }] }), own)).toBe('')
  })
})

describe('stripQuoted', () => {
  it('keeps only the new part of a reply, in Outlook, Gmail and Arabic styles', () => {
    expect(stripQuoted('Yes, 40 units please.\n\nFrom: Sales <s@x.sa>\nSent: Monday\nOld text')).toBe('Yes, 40 units please.')
    expect(stripQuoted('Thanks!\nOn Mon, 5 Oct 2026 at 10:00, Sales <s@x.sa> wrote:\n> old')).toBe('Thanks!')
    expect(stripQuoted('نعم\nمن: المبيعات\nالتاريخ: الاثنين\nقديم')).toBe('نعم')
  })
  it('caps a very long body', () => expect(stripQuoted('a'.repeat(10_000))).toHaveLength(6000))
})

describe('messageToEnvelope', () => {
  it('uses the Message-ID as the stable reference and detects Arabic', () => {
    const e = messageToEnvelope(msg(1, { subject: 'طلب عرض سعر' }))
    expect(e).toMatchObject({ source: 'email', sourceRef: '<msg-1@mail.example.com>', email: 'buyer1@client.example', language: 'ar' })
  })
})

/** Fake Microsoft (sign-in + Graph) and a fake PostgREST for the paths used. */
function world({ messages = [], graphStatus = 200, tokenExpired = true, leads = [] } = {}) {
  const state = { leads: [...leads], usage: [], mailboxes: [{ ...MB }], secrets: [{ mailbox_id: MB.id, secret: 'sealed' }], tokenCalls: [], graphCalls: [] }
  const tokens = { rt: 'refresh-1', at: 'old', exp: tokenExpired ? 0 : NOW.getTime() + 3_600_000 }
  const db = async (path, init = {}) => {
    const method = init.method || 'GET'
    if (path.startsWith('lead_mailbox_secrets?mailbox_id=eq.')) return state.secrets
    if (path.startsWith('lead_mailbox_secrets?on_conflict')) { state.secrets = [{ mailbox_id: init.body.mailbox_id, secret: init.body.secret }]; return [] }
    if (path.startsWith('lead_mailboxes?id=eq.') && method === 'PATCH') { Object.assign(state.mailboxes[0], init.body); return [state.mailboxes[0]] }
    if (path.startsWith('lead_mailboxes?workspace_id=eq.') && path.includes('&email=eq.')) return state.mailboxes.filter((m) => path.includes(encodeURIComponent(m.email)))
    if (path === 'lead_mailboxes' && method === 'POST') { const row = { id: 'new-mb', ...init.body }; state.mailboxes.push(row); return [row] }
    if (path.startsWith('leads?workspace_id=eq.') && path.includes('source_ref=in.')) return state.leads
    if (path.startsWith('leads?workspace_id=eq.') && path.includes('conversation_id=in.')) return state.leads.filter((l) => l.conversation_id)
    if (path.startsWith('leads?workspace_id=eq.') && path.includes('received_at=gte.')) return []
    if (path.startsWith('leads?on_conflict=')) {
      const i = state.leads.findIndex((l) => l.source_ref === init.body.source_ref)
      const row = i >= 0 ? Object.assign(state.leads[i], init.body) : { id: `lead-${state.leads.length}`, ...init.body }
      if (i < 0) state.leads.push(row)
      return [row]
    }
    if (path.startsWith('agent_usage?')) return []
    if (path === 'agent_usage') { state.usage.push(init.body); return [] }
    if (path.startsWith('workspaces?')) return [{ name: 'Example Co', agent_monthly_cap_usd: 15 }]
    if (path.startsWith('brand_profile?')) return [{ product_index: 'Indoor lighting, KNX' }]
    throw new Error(`fake db: ${method} ${path}`)
  }
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    if (u.includes('/oauth2/v2.0/token')) {
      state.tokenCalls.push(Object.fromEntries(new URLSearchParams(init.body)))
      return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'refresh-2', expires_in: 3600 }), { status: 200 })
    }
    state.graphCalls.push({ url: u, headers: init.headers })
    if (u.includes('/me/mailFolders/inbox/messages')) {
      if (graphStatus !== 200) return new Response(JSON.stringify({ error: { code: 'InvalidAuthenticationToken', message: 'expired' } }), { status: graphStatus })
      return new Response(JSON.stringify({ value: messages }), { status: 200 })
    }
    if (u.endsWith('/me?$select=displayName,mail,userPrincipalName')) return new Response(JSON.stringify({ displayName: 'Info', mail: 'Info@Example-Co.sa' }), { status: 200 })
    if (u.includes('/me/mailFolders/inbox?$select=id')) return new Response(JSON.stringify({ id: 'inbox' }), { status: 200 })
    throw new Error(`fake fetch: ${u}`)
  }
  const replies = []
  const deps = {
    db, fetch: fetchImpl, now: () => NOW,
    ms: { clientId: 'c', tenant: 't', secret: 's', configured: true },
    seal: (plain) => `sealed:${plain}`, open: () => JSON.stringify(tokens),
    model: async () => replies.shift() || { text: JSON.stringify({ category: 'quotation_request', confidence: 'high', reason: 'Asks for a quote.', summary: 's', details: {}, ask_next: [] }), usage: { prompt_tokens: 800, completion_tokens: 120, cost: 0.00015 } },
  }
  return { state, deps, replies }
}

const run = (w, budget = { calls: MAIL_MAX_MODEL_CALLS, deadline: Infinity }) =>
  checkMailbox(w.deps, { mb: w.state.mailboxes[0], brand: { companyName: 'Example Co', offering: 'Lighting', cap: 15 }, budget })

describe('checkMailbox', () => {
  it('qualifies only what passes the filters, stores it with its mailbox and link, and moves the read point', async () => {
    const w = world({ messages: [
      msg(1),
      msg(2, { internetMessageHeaders: [{ name: 'List-Id', value: 'news' }] }),
      msg(3, { from: { emailAddress: { address: 'hani@example-co.sa' } } }),
      msg(4, { conversationId: 'conv-1', subject: 'RE: Enquiry 1' }),
    ] })
    const out = await run(w)
    expect(out.counts).toMatchObject({ seen: 4, skipped: 3, qualified: 1 })
    expect(w.state.leads).toHaveLength(1)
    expect(w.state.leads[0]).toMatchObject({ source: 'email', mailbox: 'info@example-co.sa', link: 'https://outlook.office.com/m1', conversation_id: 'conv-1', verdict: 'qualified' })
    expect(w.state.usage).toHaveLength(1)
    expect(w.state.mailboxes[0]).toMatchObject({ read_from: '2026-10-06T04:00:00Z', status: 'active', last_error: '' })
    // Graph was asked for text bodies; nothing but a GET on the inbox.
    expect(w.state.graphCalls[0].headers.Prefer).toBe('outlook.body-content-type="text"')
  })

  it('renews its token asking for READ ONLY, never send or write', async () => {
    const w = world({ messages: [] })
    await run(w)
    expect(w.state.tokenCalls).toHaveLength(1)
    const scope = w.state.tokenCalls[0].scope
    expect(scope).toContain('Mail.Read')
    expect(scope).not.toMatch(/Mail\.Send|Mail\.ReadWrite/)
    expect(w.state.secrets[0].secret).toMatch(/^sealed:/)
  })

  it('a failed model call is stored without a verdict and asked again next time', async () => {
    const w = world({ messages: [msg(1), msg(2)] })
    w.replies.push({ error: 'Provider overloaded' })
    const first = await run(w)
    expect(first.counts.failed).toBe(1)
    expect(w.state.leads[0]).toMatchObject({ error: 'Provider overloaded' })
    expect(w.state.leads[0].verdict).toBeUndefined()
    expect(w.state.mailboxes[0].read_from).toBe('2026-10-01T00:00:00Z')
    const second = await run(w)
    expect(second.counts.qualified).toBe(2)
    expect(w.state.leads[0].verdict).toBe('qualified')
  })

  it('a refused sign-in marks the mailbox for reconnecting', async () => {
    const w = world({ graphStatus: 401 })
    const out = await run(w)
    expect(out.error).toBeTruthy()
    expect(w.state.mailboxes[0].status).toBe('reconnect')
  })

  it('stops at the per-round limit and leaves the rest for the next round', async () => {
    const w = world({ messages: [msg(1), msg(2), msg(3, { from: { emailAddress: { address: 'c3@client.example' } } })] })
    const out = await run(w, { calls: 2, deadline: Infinity })
    expect(out.counts).toMatchObject({ qualified: 2, waiting: 1 })
    expect(w.state.mailboxes[0].read_from).toBe('2026-10-06T02:00:00Z')
  })
})

describe('finishConnect', () => {
  it('exchanges the code for a read-only token, adds the mailbox reading back a week, and seals the token', async () => {
    const w = world()
    w.state.mailboxes = []
    const out = await finishConnect(w.deps, { claims: { ws: WS, uid: 'u1' }, code: 'abc', redirectUri: 'https://app/api/email/ms-callback' })
    expect(out).toEqual({ ok: true, email: 'info@example-co.sa' })
    expect(w.state.tokenCalls[0].scope).not.toMatch(/Mail\.Send|Mail\.ReadWrite/)
    expect(w.state.mailboxes[0]).toMatchObject({ email: 'info@example-co.sa', status: 'active', read_from: '2026-09-29T12:00:00.000Z' })
    expect(w.state.secrets[0].secret).toMatch(/^sealed:/)
  })
})

describe('the Sheet call is the mailboxes\' heartbeat', () => {
  it('intakeWebsite runs the mail check and returns what it did', async () => {
    const calls = []
    const db = async (path, init = {}) => {
      if (path.startsWith('lead_agent_settings?intake_key=eq.')) return [{ workspace_id: WS, enabled: true }]
      if (init.method === 'PATCH') return []
      throw new Error(path)
    }
    const out = await intakeWebsite({ db, now: () => NOW, model: async () => ({}), checkMail: async (a) => { calls.push(a); return { mailboxes: [{ email: 'info@example-co.sa', counts: { qualified: 1 } }] } } },
      { key: '11111111-2222-3333-4444-555555555555', rows: [] })
    expect(calls[0].workspaceId).toBe(WS)
    expect(out.mail.mailboxes[0].counts.qualified).toBe(1)
  })
})
