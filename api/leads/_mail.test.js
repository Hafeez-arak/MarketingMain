import { describe, it, expect } from 'vitest'
import { skipReason, stripQuoted, requestKey, messageToEnvelope, checkMailbox, checkMail, finishConnect, tenantOf, NEW_LEADS_FROM, isWarmupEmail, emailFile, leadPhones } from './_mail.js'
import { intakeWebsite } from './_intake.js'

// Made-up mail only: this repo is public.
const WS = '00000000-0000-0000-0000-0000000000bb'
const MB = {
  id: '00000000-0000-0000-0000-0000000000c1', workspace_id: WS, email: 'a.box@example-co.sa', label: 'info@example-co.sa', tenant: '',
  status: 'active', read_from: '2026-10-01T00:00:00Z',
  history_from: '2026-07-01T00:00:00Z', history_until: '2026-10-01T00:00:00Z', history_cursor: null, history_done: true,
}
const NOW = new Date('2026-10-06T12:00:00Z')

const msg = (n, over = {}) => ({
  id: `m${n}`, internetMessageId: `<msg-${n}@mail.example.com>`, conversationId: `conv-${n}`,
  subject: `Enquiry ${n}`, from: { emailAddress: { name: 'Sara Ali', address: `buyer${n}@client.example` } },
  receivedDateTime: `2026-10-06T0${n}:00:00Z`, body: { contentType: 'text', content: `Please quote 30 downlights for our villa, request ${n}.` },
  internetMessageHeaders: [], webLink: `https://outlook.office.com/m${n}`, isDraft: false, ...over,
})

describe('skipReason', () => {
  const own = { ownDomains: ['example-co.sa', 'sister-co.sa'] }
  it('lets a real enquiry through', () => expect(skipReason(msg(1), own)).toBe(''))
  it('colleagues on EITHER company domain are skipped (that also drops Sent and Outbox)', () => {
    expect(skipReason(msg(1, { from: { emailAddress: { address: 'hani@example-co.sa' } } }), own)).toBe('colleague')
    expect(skipReason(msg(1, { from: { emailAddress: { address: 'sales@sister-co.sa' } } }), own)).toBe('colleague')
  })
  it('skips automatic senders, newsletters, auto-replies, drafts and the website form copy', () => {
    expect(skipReason(msg(1, { from: { emailAddress: { address: 'no-reply@shop.example' } } }), own)).toBe('automatic sender')
    expect(skipReason(msg(1, { internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:x>' }] }), own)).toBe('newsletter')
    expect(skipReason(msg(1, { subject: 'Automatic reply: Enquiry' }), own)).toBe('automatic reply')
    expect(skipReason(msg(1, { subject: 'Undeliverable: Hello' }), own)).toBe('automatic reply')
    expect(skipReason(msg(1, { internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'auto-generated' }] }), own)).toBe('automatic')
    expect(skipReason(msg(1, { isDraft: true }), own)).toBe('draft')
    expect(skipReason(msg(1, { subject: 'Lighting enquiry — Omar (Nour)', from: { emailAddress: { name: 'ARAK website', address: 'site@gmail.com' } } }), own)).toBe('website form copy')
  })
  it('a normal "Auto-Submitted: no" header is not automatic', () => {
    expect(skipReason(msg(1, { internetMessageHeaders: [{ name: 'auto-submitted', value: 'no' }] }), own)).toBe('')
  })
  it('skips a warm-up service\'s email by its tag, in the subject or the body, any case', () => {
    const tags = { ...own, warmupTags: ['K7QZ2 MX9'] }
    expect(skipReason(msg(1, { subject: 'Quick catch-up k7qz2 mx9' }), tags)).toBe('warm-up email')
    expect(skipReason(msg(1, { body: { content: 'Hope your week is going well.\n\nK7QZ2 MX9' } }), tags)).toBe('warm-up email')
    expect(skipReason(msg(1), tags)).toBe('')
  })
  it('a tag shorter than 4 characters is ignored, so it cannot hide real enquiries', () => {
    expect(isWarmupEmail(msg(1), ['a'])).toBe(false)
    expect(isWarmupEmail(msg(1), ['', '  '])).toBe(false)
  })
})

describe('stripQuoted', () => {
  it('keeps only the new part of a reply, in Outlook, Gmail and Arabic styles', () => {
    expect(stripQuoted('Yes, 40 units please.\n\nFrom: Sales <s@x.sa>\nSent: Monday\nOld text')).toBe('Yes, 40 units please.')
    expect(stripQuoted('Thanks!\nOn Mon, 5 Oct 2026 at 10:00, Sales <s@x.sa> wrote:\n> old')).toBe('Thanks!')
    expect(stripQuoted('نعم\nمن: المبيعات\nالتاريخ: الاثنين\nقديم')).toBe('نعم')
  })
  it('caps a very long body', () => expect(stripQuoted('a'.repeat(10_000))).toHaveLength(6000))
  it('keeps the whole text when everything looks quoted, instead of sending nothing', () => {
    const fwd = 'From: Factory <f@x.cn>\nSent: Monday\nWe make rechargeable LED lamps, MOQ 500.'
    expect(stripQuoted(fwd)).toContain('rechargeable LED lamps')
  })
})

describe('requestKey', () => {
  it('matches the same referenced request from the same company, through Re:/FW:', () => {
    const a = requestKey('waseem@condor.example', 'REQUEST FOR QUOTATION # CA-26-1618')
    expect(a).toBe('condor.example|request for quotation # ca-26-1618')
    expect(requestKey('other@condor.example', 'FW: Re: REQUEST FOR QUOTATION # CA-26-1618')).toBe(a)
  })
  it('never keys a generic subject, a different reference, or another company', () => {
    expect(requestKey('a@ritz.example', 'Request for Quotation')).toBe('')
    expect(requestKey('a@x.example', 'RFQ')).toBe('')
    expect(requestKey('a@condor.example', 'REQUEST FOR QUOTATION # CA-26-1619')).not.toBe(requestKey('a@condor.example', 'REQUEST FOR QUOTATION # CA-26-1618'))
    expect(requestKey('a@other.example', 'REQUEST FOR QUOTATION # CA-26-1618')).not.toBe(requestKey('a@condor.example', 'REQUEST FOR QUOTATION # CA-26-1618'))
  })
})

describe('messageToEnvelope', () => {
  it('uses the Message-ID as the stable reference and detects Arabic', () => {
    const e = messageToEnvelope(msg(1, { subject: 'طلب عرض سعر' }))
    expect(e).toMatchObject({ source: 'email', sourceRef: '<msg-1@mail.example.com>', email: 'buyer1@client.example', language: 'ar' })
  })
})

/** Fake Microsoft (sign-in + Graph, honouring the date filter) and a fake PostgREST. */
function world({ messages = [], graphStatus = 200, tokenExpired = true, leads = [], mailboxes = [{ ...MB }], proxy = [], grantSend = true } = {}) {
  const state = { leads: [...leads], usage: [], mailboxes, secrets: [{ mailbox_id: MB.id, secret: 'sealed' }], tokenCalls: [], graphCalls: [], modelCalls: 0, inFlight: 0, maxInFlight: 0 }
  const tokens = { rt: 'refresh-1', at: 'old', exp: tokenExpired ? 0 : NOW.getTime() + 3_600_000 }
  const db = async (path, init = {}) => {
    const method = init.method || 'GET'
    if (path.startsWith('lead_mailbox_secrets?mailbox_id=eq.')) return state.secrets
    if (path.startsWith('lead_mailbox_secrets?on_conflict')) { state.secrets = [{ mailbox_id: init.body.mailbox_id, secret: init.body.secret }]; return [] }
    if (path.startsWith('lead_mailboxes?id=eq.') && method === 'PATCH') {
      const mb = state.mailboxes.find((m) => path.includes(m.id)) || state.mailboxes[0]
      Object.assign(mb, init.body); return [mb]
    }
    if (path.startsWith('lead_mailboxes?workspace_id=eq.') && path.includes('&email=eq.')) return state.mailboxes.filter((m) => path.includes(encodeURIComponent(m.email)))
    if (path.startsWith('lead_mailboxes?workspace_id=eq.')) return state.mailboxes.filter((m) => m.status === 'active')
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
      state.tokenCalls.push({ url: u, ...Object.fromEntries(new URLSearchParams(init.body)) })
      const idToken = `x.${Buffer.from(JSON.stringify({ tid: 'tenant-of-other-org' })).toString('base64url')}.y`
      // Microsoft names what it granted; an admin may have allowed less than was asked.
      const asked = new URLSearchParams(init.body).get('scope') || ''
      const scope = asked.split(' ').filter((x) => grantSend || x !== 'Mail.Send').map((x) => (x.startsWith('Mail.') || x === 'User.Read' ? `https://graph.microsoft.com/${x}` : x)).join(' ')
      return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'refresh-2', expires_in: 3600, id_token: idToken, scope }), { status: 200 })
    }
    state.graphCalls.push({ url: u, headers: init.headers })
    if (u.includes('/me/messages?')) {
      if (graphStatus !== 200) return new Response(JSON.stringify({ error: { code: 'InvalidAuthenticationToken', message: 'expired' } }), { status: graphStatus })
      const filter = new URL(u).searchParams.get('$filter')
      const ge = filter.match(/ge (\S+)/)[1]
      const lt = filter.match(/lt (\S+)/)?.[1]
      const value = messages.filter((m) => m.receivedDateTime >= ge.replace('.000Z', 'Z') && (!lt || m.receivedDateTime < lt.replace('.000Z', 'Z')))
      return new Response(JSON.stringify({ value }), { status: 200 })
    }
    if (u.endsWith('/me?$select=displayName,mail,userPrincipalName')) return new Response(JSON.stringify({ displayName: 'Info', mail: 'A.Box@Example-Co.sa' }), { status: 200 })
    if (u.endsWith('/me?$select=proxyAddresses')) return new Response(JSON.stringify({ proxyAddresses: proxy }), { status: 200 })
    const folder = u.match(/\/me\/mailFolders\/(\w+)\?\$select=id$/)?.[1]
    if (folder) return new Response(JSON.stringify({ id: `${folder}-id` }), { status: 200 })
    throw new Error(`fake fetch: ${u}`)
  }
  const replies = []
  const deps = {
    db, fetch: fetchImpl, now: () => NOW,
    ms: { clientId: 'c', tenant: 'our-tenant', secret: 's', configured: true },
    seal: (plain) => `sealed:${plain}`, open: () => JSON.stringify(tokens),
    model: async () => {
      state.modelCalls++; state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      await new Promise((r) => setTimeout(r, 2))
      state.inFlight--
      return replies.shift() || { text: JSON.stringify({ category: 'quotation_request', confidence: 'high', reason: 'Asks for a quote.', summary: 's', details: {}, ask_next: [], source_check: 'verified', sender_type: 'contractor', sender_confidence: 'high' }), usage: { prompt_tokens: 800, completion_tokens: 120, cost: 0.00015 } }
    },
  }
  return { state, deps, replies }
}

const brand = { companyName: 'Example Co', offering: 'Lighting', cap: 15 }
const run = (w, budget = { calls: 40, deadline: Infinity }, mb = w.state.mailboxes[0]) => checkMailbox(w.deps, { mb, brand, budget })

describe('checkMailbox: new mail', () => {
  it('reads every folder (/me/messages), qualifies only what passes the filters, labels it, and moves the read point', async () => {
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
    expect(w.state.mailboxes[0]).toMatchObject({ read_from: '2026-10-06T04:00:00Z', status: 'active', last_error: '' })
    const list = w.state.graphCalls.find((c) => c.url.includes('/me/messages?'))
    expect(list.headers.Prefer).toBe('outlook.body-content-type="text"')
    expect(new URL(list.url).searchParams.get('$select')).toContain('parentFolderId')
  })

  it('says which folder each email sat in, so a real enquiry in Junk stands out', async () => {
    const w = world({ messages: [
      msg(1, { parentFolderId: 'junkemail-id' }),
      msg(2, { parentFolderId: 'inbox-id' }),
      msg(3, { parentFolderId: 'some-user-folder' }),
    ] })
    await run(w)
    expect(w.state.leads.map((l) => l.folder)).toEqual(['junk', 'inbox', 'other'])
    expect(w.state.leads[0]).toMatchObject({ email_kind: 'company', criteria_version: 2, sender_type: 'contractor', source_check: 'verified' })
  })

  it('a reminder for the same referenced RFQ is not a new lead, even in a new conversation', async () => {
    const w = world({ messages: [
      msg(1, { subject: 'REQUEST FOR QUOTATION # CA-26-1618', from: { emailAddress: { address: 'waseem@condor.example' } } }),
      msg(2, { subject: 'FW: REQUEST FOR QUOTATION # CA-26-1618', conversationId: 'conv-other', from: { emailAddress: { address: 'waseem@condor.example' } }, body: { content: 'Soft reminder!' } }),
    ] })
    const out = await run(w)
    expect(out.counts).toMatchObject({ qualified: 1, skipped: 1 })
    expect(w.state.modelCalls).toBe(1)
  })

  it('renews its token asking for READ ONLY, never send or write', async () => {
    const w = world({ messages: [] })
    await run(w)
    const scope = w.state.tokenCalls[0].scope
    expect(scope).toContain('Mail.Read')
    expect(scope).not.toMatch(/Mail\.Send|Mail\.ReadWrite/)
    expect(w.state.tokenCalls[0].url).toContain('/our-tenant/')
  })

  it('another organisation\'s mailbox renews against its own tenant', async () => {
    const w = world({ messages: [], mailboxes: [{ ...MB, tenant: 'clb-tenant-id' }] })
    await run(w)
    expect(w.state.tokenCalls[0].url).toContain('/clb-tenant-id/')
  })

  it('asks the model several at a time, never more than four', async () => {
    const msgs = Array.from({ length: 9 }, (_, i) => msg(i + 1, { from: { emailAddress: { address: `p${i}@client${i}.example` } }, body: { content: `Different request about item ${i * 13} for project ${i}` } }))
    const w = world({ messages: msgs })
    const out = await run(w)
    expect(out.counts.qualified).toBe(9)
    expect(w.state.maxInFlight).toBeGreaterThan(1)
    expect(w.state.maxInFlight).toBeLessThanOrEqual(4)
  })

  it('a failed model call is stored without a verdict and asked again next time', async () => {
    const w = world({ messages: [msg(1), msg(2)] })
    w.replies.push({ error: 'Provider overloaded' })
    const first = await run(w)
    expect(first.counts.failed).toBe(1)
    expect(w.state.leads.find((l) => l.source_ref === '<msg-1@mail.example.com>')).toMatchObject({ error: 'Provider overloaded' })
    expect(w.state.mailboxes[0].read_from).toBe('2026-10-01T00:00:00Z')
    const second = await run(w)
    expect(second.counts.qualified).toBe(2)
  })

  it('a refused sign-in marks the mailbox for reconnecting', async () => {
    const w = world({ graphStatus: 401 })
    const out = await run(w)
    expect(out.error).toBeTruthy()
    expect(w.state.mailboxes[0].status).toBe('reconnect')
  })

  it('stops at the round\'s limit and leaves the rest for the next round', async () => {
    const w = world({ messages: [msg(1), msg(2), msg(3, { from: { emailAddress: { address: 'c3@client.example' } } })] })
    const out = await run(w, { calls: 2, deadline: Infinity })
    expect(out.counts).toMatchObject({ qualified: 2, waiting: 1 })
    expect(w.state.mailboxes[0].read_from).toBe('2026-10-06T02:00:00Z')
  })
})

describe('checkMailbox: July–September history', () => {
  const old = (n, day) => msg(n, { receivedDateTime: `2026-0${day}T09:00:00Z`, from: { emailAddress: { address: `h${n}@client${n}.example` } }, body: { content: `Old request ${n} for item ${n * 7}` } })

  it('walks 1 Jul → 1 Oct once, after new mail, then marks itself done', async () => {
    const w = world({ messages: [old(1, '7-15'), old(2, '8-20'), old(3, '9-29'), msg(5)], mailboxes: [{ ...MB, history_done: false }] })
    const out = await run(w)
    expect(out.counts.qualified).toBe(1) // new mail: 6 Oct only
    expect(out.history).toMatchObject({ done: true })
    expect(out.history.counts.qualified).toBe(3)
    expect(w.state.mailboxes[0]).toMatchObject({ history_done: true, history_cursor: '2026-09-29T09:00:00Z' })
    // The history pass asked Graph for the July–September window only.
    const historyCall = w.state.graphCalls.find((c) => c.url.includes('lt+2026-10-01'))
    expect(historyCall).toBeTruthy()
  })

  it('history waits while new mail uses up the round, and resumes from its cursor', async () => {
    const w = world({ messages: [old(1, '7-15'), old(2, '8-20'), msg(5), msg(6, { from: { emailAddress: { address: 'z@client.example' } } })], mailboxes: [{ ...MB, history_done: false }] })
    const first = await run(w, { calls: 3, deadline: Infinity })
    expect(first.counts.qualified).toBe(2)
    expect(first.history.done).toBe(false)
    expect(w.state.mailboxes[0].history_cursor).toBe('2026-07-15T09:00:00Z')
    const second = await run(w)
    expect(second.history.done).toBe(true)
    expect(w.state.leads.filter((l) => l.verdict === 'qualified')).toHaveLength(4)
  })
})

describe('checkMail', () => {
  it('skips warm-up emails before any model call, with any connected mailbox\'s tag', async () => {
    const other = { ...MB, id: '00000000-0000-0000-0000-0000000000c2', email: 'info@sister-co.sa', label: 'info@sister-co.sa', tenant: 'sister-tenant', warmup_tag: 'K7QZ2 MX9' }
    const w = world({ mailboxes: [{ ...MB }, other], messages: [msg(1, { subject: 'Following up K7QZ2 MX9' })] })
    const out = await checkMail(w.deps, { workspaceId: WS })
    expect(out.mailboxes[0].counts.skipped).toBe(1)
    expect(w.state.modelCalls).toBe(0)
    expect(w.state.leads).toHaveLength(0)
  })

  it('treats every connected mailbox\'s domain as a colleague\'s', async () => {
    const other = { ...MB, id: '00000000-0000-0000-0000-0000000000c2', email: 'info@sister-co.sa', label: 'info@sister-co.sa', tenant: 'sister-tenant' }
    const w = world({ mailboxes: [{ ...MB }, other], messages: [msg(1, { from: { emailAddress: { address: 'ali@sister-co.sa' } } })] })
    const out = await checkMail(w.deps, { workspaceId: WS })
    expect(out.mailboxes[0].counts.skipped).toBe(1)
    expect(w.state.modelCalls).toBe(0)
  })
})

describe('finishConnect', () => {
  it('our own mailbox: read-only token, labelled by its info@ alias, reading new mail from 1 October', async () => {
    const w = world({ mailboxes: [], proxy: ['SMTP:a.box@example-co.sa', 'smtp:info@example-co.sa'] })
    const out = await finishConnect(w.deps, { claims: { ws: WS, uid: 'u1' }, code: 'abc', redirectUri: 'https://app/api/email/ms-callback' })
    expect(out).toEqual({ ok: true, email: 'info@example-co.sa', canSend: false })
    expect(w.state.tokenCalls[0].scope).not.toMatch(/Mail\.Send|Mail\.ReadWrite/)
    expect(w.state.tokenCalls[0].url).toContain('/our-tenant/')
    expect(w.state.mailboxes[0]).toMatchObject({ email: 'a.box@example-co.sa', label: 'info@example-co.sa', tenant: '', read_from: NEW_LEADS_FROM })
    expect(w.state.secrets[0].secret).toMatch(/^sealed:/)
  })
  it('another organisation\'s mailbox signs in at "organizations" and keeps its own tenant', async () => {
    const w = world({ mailboxes: [] })
    await finishConnect(w.deps, { claims: { ws: WS, uid: 'u1', o: 1 }, code: 'abc', redirectUri: 'https://app/api/email/ms-callback' })
    expect(w.state.tokenCalls[0].url).toContain('/organizations/')
    expect(w.state.mailboxes[0].tenant).toBe('tenant-of-other-org')
  })
})

describe('"Allow forwarding" (2026-10-13)', () => {
  it('signs in asking for Mail.Send too, and records that it was granted', async () => {
    const w = world({ mailboxes: [{ ...MB }] })
    const out = await finishConnect(w.deps, { claims: { ws: WS, uid: 'u1', s: 1 }, code: 'abc', redirectUri: 'https://app/api/email/ms-callback' })
    expect(out.canSend).toBe(true)
    expect(w.state.tokenCalls[0].scope).toMatch(/Mail\.Read .*Mail\.Send/)
    expect(w.state.tokenCalls[0].scope).not.toMatch(/ReadWrite/)
    expect(w.state.mailboxes[0].can_send).toBe(true)
  })
  it('asked but not granted (an admin allowed reading only): it stays read only', async () => {
    const w = world({ mailboxes: [{ ...MB }], grantSend: false })
    const out = await finishConnect(w.deps, { claims: { ws: WS, uid: 'u1', s: 1 }, code: 'abc', redirectUri: 'https://app/api/email/ms-callback' })
    expect(out.canSend).toBe(false)
    expect(w.state.mailboxes[0].can_send).toBe(false)
  })
  it('signing in again without it takes forwarding away, so renewals never ask for more than the token holds', async () => {
    const w = world({ mailboxes: [{ ...MB, can_send: true }] })
    await finishConnect(w.deps, { claims: { ws: WS, uid: 'u1' }, code: 'abc', redirectUri: 'https://app/api/email/ms-callback' })
    expect(w.state.mailboxes[0].can_send).toBe(false)
  })
  it('a mailbox allowed to forward renews with Mail.Send; the others never do', async () => {
    const w = world({ messages: [], mailboxes: [{ ...MB, can_send: true }] })
    await run(w)
    expect(w.state.tokenCalls[0].scope).toMatch(/Mail\.Send/)
  })
})

describe('tenantOf', () => {
  it('reads tid from an id_token, or nothing', () => {
    expect(tenantOf(`a.${Buffer.from('{"tid":"t-1"}').toString('base64url')}.b`)).toBe('t-1')
    expect(tenantOf('nonsense')).toBe('')
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

describe('emailFile', () => {
  const lead = { id: 'lead-1', mailbox: 'info@example-co.sa', source_ref: "<rfq-o'brien@client.example>", subject: 'RFQ: Hotel / lobby lights', received_at: '2026-10-06T08:00:00Z' }
  function fake({ found = true, size = 10 } = {}) {
    const calls = []
    const deps = {
      now: () => NOW, ms: { clientId: 'c', tenant: 't', secret: 's', configured: true },
      open: () => JSON.stringify({ rt: 'r', at: 'live', exp: NOW.getTime() + 3_600_000 }), seal: (x) => x,
      db: async (path) => {
        if (path.startsWith('leads?id=eq.lead-1')) return [lead]
        if (path.startsWith('leads?')) return []
        if (path.startsWith('lead_mailboxes?')) return [MB]
        if (path.startsWith('lead_mailbox_secrets?')) return [{ secret: 'x' }]
        throw new Error(path)
      },
      fetch: async (url, init) => {
        calls.push({ url: String(url), auth: init?.headers?.Authorization })
        if (String(url).includes('/me/messages?')) return new Response(JSON.stringify({ value: found ? [{ id: 'AAMk/1' }] : [] }), { status: 200 })
        if (String(url).endsWith('/$value')) return new Response('x'.repeat(size), { status: 200 })
        throw new Error(String(url))
      },
    }
    return { deps, calls }
  }
  it('finds the email by its Message-ID in the mailbox that read it and returns the original file', async () => {
    const { deps, calls } = fake()
    const out = await emailFile(deps, { workspaceId: WS, leadId: 'lead-1' })
    expect(out.filename).toBe('RFQ Hotel lobby lights.eml')
    expect(out.bytes.length).toBe(10)
    expect(new URL(calls[0].url).searchParams.get('$filter')).toBe("internetMessageId eq '<rfq-o''brien@client.example>'")
    expect(calls[1].url).toContain('/me/messages/AAMk%2F1/$value')
    expect(calls.every((c) => c.auth === 'Bearer live')).toBe(true)
  })
  it('says so plainly when the email is gone, another company\'s, or too large', async () => {
    expect(await emailFile(fake({ found: false }).deps, { workspaceId: WS, leadId: 'lead-1' })).toMatchObject({ status: 404 })
    expect(await emailFile(fake().deps, { workspaceId: WS, leadId: 'lead-2' })).toMatchObject({ status: 404 })
    expect(await emailFile(fake({ size: 5_000_000 }).deps, { workspaceId: WS, leadId: 'lead-1' })).toMatchObject({ status: 413 })
  })
})

describe('leadPhones', () => {
  const deps = (calls, reply = '{"phones":["+966 55 111 2222"]}') => ({
    db: async () => [],
    model: async (body) => { calls.push(['model', body.messages[0].content.length]); return { text: reply, usage: { cost: 0.0002 } } },
    fetch: async (url) => {
      calls.push(['graph', String(url).split('?')[0].split('/').slice(-2).join('/')])
      if (String(url).includes('/attachments?')) return new Response(JSON.stringify({ value: [
        { id: 'a1', contentType: 'image/png', size: 20_000, isInline: true },
        { id: 'a2', contentType: 'image/png', size: 300, isInline: true }, // a spacer
        { id: 'a3', contentType: 'application/pdf', size: 90_000, isInline: false }, // the BOQ
      ] }), { status: 200 })
      return new Response(JSON.stringify({ contentBytes: 'iVBOR' }), { status: 200 })
    },
  })
  it('a number in the text is enough: no picture is read', async () => {
    const calls = []
    expect(await leadPhones(deps(calls), { token: 't', msg: { id: 'm1' }, text: 'Regards\nMob: 0553251417', verdict: 'qualified', workspaceId: WS })).toEqual(['0553251417'])
    expect(calls).toEqual([])
  })
  it('no number in the text: the signature picture is read, only the small images', async () => {
    const calls = []
    expect(await leadPhones(deps(calls), { token: 't', msg: { id: 'm1' }, text: 'Regards, Omar', verdict: 'needs_review', workspaceId: WS })).toEqual(['+966 55 111 2222'])
    expect(calls).toEqual([['graph', 'm1/attachments'], ['graph', 'attachments/a1'], ['model', 2]])
  })
  it('never spends on mail that is not a lead', async () => {
    const calls = []
    expect(await leadPhones(deps(calls), { token: 't', msg: { id: 'm1' }, text: 'Buy our SEO', verdict: 'unqualified', workspaceId: WS })).toEqual([])
    expect(calls).toEqual([])
  })
})
