import { describe, it, expect } from 'vitest'
import {
  signState, openState, authorizeUrl, packTokens, unpackTokens, classifyGraphError, createGraphMail, whoAmI, SCOPES,
} from './_graph.js'

const KEY = 'service-key-for-tests'
const CONFIG = { clientId: 'client-1', tenant: 'tenant-1', secret: 's3cret', configured: true }
const MB = { id: 'mb-ms', workspace_id: 'ws-1', provider: 'microsoft', email: 'sales1@arak-sa.com' }
const NOW = Date.parse('2026-09-28T08:00:00Z')

/** A fake fetch: routes by "METHOD url-substring", records every call. */
function fakeFetch(routes) {
  const calls = []
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ method, url: String(url), headers: init.headers || {}, body: init.body })
    const hit = routes.find(r => r.method === method && String(url).includes(r.match))
    const reply = hit ? (typeof hit.reply === 'function' ? hit.reply(url, init, calls) : hit.reply) : { status: 404, json: { error: { code: 'NotRouted' } } }
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => { if (reply.json === undefined) throw new Error('no body'); return reply.json },
    }
  }
  return { f, calls }
}

describe('sign-in state', () => {
  it('round-trips its claims', () => {
    const s = signState({ ws: 'ws-1', uid: 'u-1', mb: null, n: 'nonce' }, KEY, NOW)
    expect(openState(s, KEY, NOW + 60_000)).toMatchObject({ ws: 'ws-1', uid: 'u-1', n: 'nonce' })
  })
  it('refuses an altered workspace', () => {
    const s = signState({ ws: 'ws-1', uid: 'u-1', n: 'x' }, KEY, NOW)
    const [payload, mac] = s.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), ws: 'ws-evil' })).toString('base64url')
    expect(openState(`${forged}.${mac}`, KEY, NOW)).toBeNull()
  })
  it('refuses a state signed with another key, or too old', () => {
    const s = signState({ ws: 'ws-1', n: 'x' }, KEY, NOW)
    expect(openState(s, 'other-key', NOW)).toBeNull()
    expect(openState(s, KEY, NOW + 16 * 60_000)).toBeNull()
    expect(openState('garbage', KEY, NOW)).toBeNull()
  })
})

describe('authorizeUrl', () => {
  it('asks for mail send + read with a refresh token, always choosing the account', () => {
    const u = new URL(authorizeUrl({ config: CONFIG, redirectUri: 'https://app/api/email/ms-callback', state: 'st', loginHint: 'sales1@arak-sa.com' }))
    expect(u.pathname).toBe('/tenant-1/oauth2/v2.0/authorize')
    expect(u.searchParams.get('scope')).toBe(SCOPES)
    expect(SCOPES).toContain('offline_access')
    expect(SCOPES).toContain('Mail.Send')
    // Creating the draft that is then sent is a write: Mail.Send alone is refused.
    expect(SCOPES).toContain('Mail.ReadWrite')
    expect(u.searchParams.get('prompt')).toBe('select_account')
    expect(u.searchParams.get('login_hint')).toBe('sales1@arak-sa.com')
  })
})

describe('classifyGraphError', () => {
  it('reads an unlicensed account as a login problem with the reason', () => {
    const r = classifyGraphError(404, 'MailboxNotEnabledForRESTAPI', 'The mailbox is either inactive, soft-deleted, or is hosted on-premise.')
    expect(r.kind).toBe('auth')
    expect(r.reason).toMatch(/licence/)
  })
  it('reads a Microsoft sending block as stop-the-mailbox', () => {
    expect(classifyGraphError(403, 'ErrorMessageSubmissionBlocked', '').kind).toBe('auth')
  })
  it('reads ErrorAccessDenied as a missing permission, not a bad password', () => {
    const r = classifyGraphError(403, 'ErrorAccessDenied', 'Access is denied. Check credentials and try again.')
    expect(r.kind).toBe('auth')
    expect(r.reason).toMatch(/Mail\.ReadWrite/)
  })
  it('reads throttling as a limit and bad addresses as the recipient', () => {
    expect(classifyGraphError(429, 'ApplicationThrottled', '').kind).toBe('limit')
    expect(classifyGraphError(400, 'ErrorInvalidRecipients', '').kind).toBe('recipient')
    expect(classifyGraphError(503, 'ServiceUnavailable', '').kind).toBe('transient')
  })
})

describe('createGraphMail.send', () => {
  const message = {
    from: { name: 'Sales', address: MB.email }, to: { name: 'Sara', address: 'sara@hotel.sa' },
    subject: 'Re: Lighting', text: 'Following up.', html: '<p>Following up.</p>',
    messageId: '<ours@arak-sa.com>', inReplyTo: '<first@arak-sa.com>', references: ['<first@arak-sa.com>'],
  }

  it('renews an expired token, saves the new one, posts our MIME as a draft, then sends it', async () => {
    const { f, calls } = fakeFetch([
      { method: 'POST', match: '/oauth2/v2.0/token', reply: { status: 200, json: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 } } },
      { method: 'POST', match: '/me/messages/draft-1/send', reply: { status: 202 } },
      { method: 'POST', match: '/me/messages', reply: { status: 201, json: { id: 'draft-1', internetMessageId: '<real@arak-sa.com>', conversationId: 'conv-1' } } },
    ])
    const saved = []
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async (mb, plain) => saved.push({ mb, plain }) })
    const stale = packTokens({ rt: 'RT1', at: 'AT1', exp: NOW - 1000 })
    const out = await mail.send(MB, stale, message)

    expect(out).toEqual({ ok: true, messageId: '<real@arak-sa.com>', threadId: 'conv-1' })
    expect(unpackTokens(saved[0].plain)).toMatchObject({ rt: 'RT2', at: 'AT2' })
    const token = calls.find(c => c.url.includes('/token'))
    expect(new URLSearchParams(token.body).get('grant_type')).toBe('refresh_token')
    expect(new URLSearchParams(token.body).get('client_secret')).toBe('s3cret')

    const draft = calls.find(c => c.method === 'POST' && c.url.endsWith('/me/messages'))
    expect(draft.headers['Content-Type']).toBe('text/plain')
    expect(draft.headers.Authorization).toBe('Bearer AT2')
    const mime = Buffer.from(draft.body, 'base64').toString('utf8')
    expect(mime).toMatch(/^In-Reply-To: <first@arak-sa\.com>$/m)
    expect(mime).toMatch(/^References: <first@arak-sa\.com>$/m)
    expect(mime).toMatch(/^Message-ID: <ours@arak-sa\.com>$/m)
    expect(mime).toMatch(/^To: Sara <sara@hotel\.sa>$/m)
  })

  it('reuses a live token without calling Microsoft sign-in', async () => {
    const { f, calls } = fakeFetch([
      { method: 'POST', match: '/send', reply: { status: 202 } },
      { method: 'POST', match: '/me/messages', reply: { status: 201, json: { id: 'd', internetMessageId: '<x@y>', conversationId: 'c' } } },
    ])
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async () => { throw new Error('should not save') } })
    const out = await mail.send(MB, packTokens({ rt: 'RT', at: 'LIVE', exp: NOW + 30 * 60_000 }), message)
    expect(out.ok).toBe(true)
    expect(calls.some(c => c.url.includes('/token'))).toBe(false)
  })

  it('a revoked refresh token is a login failure that names the fix', async () => {
    const { f } = fakeFetch([
      { method: 'POST', match: '/token', reply: { status: 400, json: { error: 'invalid_grant', error_description: 'AADSTS50173: The provided grant has expired.' } } },
    ])
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async () => {} })
    const out = await mail.send(MB, packTokens({ rt: 'RT', at: '', exp: 0 }), message)
    expect(out.ok).toBe(false)
    expect(out.error.kind).toBe('auth')
    expect(out.error.reason).toMatch(/Reconnect/)
  })

  it('if the send call fails but the draft is gone, it WAS sent: no retry, no duplicate', async () => {
    const { f } = fakeFetch([
      { method: 'POST', match: '/send', reply: { status: 504, json: { error: { code: 'GatewayTimeout', message: 'timeout' } } } },
      { method: 'POST', match: '/me/messages', reply: { status: 201, json: { id: 'd', internetMessageId: '<x@y>', conversationId: 'c' } } },
      { method: 'DELETE', match: '/me/messages/d', reply: { status: 404, json: { error: { code: 'ErrorItemNotFound' } } } },
    ])
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async () => {} })
    const out = await mail.send(MB, packTokens({ rt: 'RT', at: 'LIVE', exp: NOW + 3_600_000 }), message)
    expect(out).toEqual({ ok: true, messageId: '<x@y>', threadId: 'c' })
  })

  it('if the send call fails and the draft could be deleted, it was not sent: a transient failure', async () => {
    const { f } = fakeFetch([
      { method: 'POST', match: '/send', reply: { status: 503, json: { error: { code: 'ServiceUnavailable', message: 'busy' } } } },
      { method: 'POST', match: '/me/messages', reply: { status: 201, json: { id: 'd', internetMessageId: '<x@y>', conversationId: 'c' } } },
      { method: 'DELETE', match: '/me/messages/d', reply: { status: 204 } },
    ])
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async () => {} })
    const out = await mail.send(MB, packTokens({ rt: 'RT', at: 'LIVE', exp: NOW + 3_600_000 }), message)
    expect(out.ok).toBe(false)
    expect(out.error.kind).toBe('transient')
  })

  it('a 401 on a cached token renews once and retries', async () => {
    let drafts = 0
    const { f } = fakeFetch([
      { method: 'POST', match: '/token', reply: { status: 200, json: { access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600 } } },
      { method: 'POST', match: '/send', reply: { status: 202 } },
      { method: 'POST', match: '/me/messages', reply: (url, init) => (++drafts === 1
        ? { status: 401, json: { error: { code: 'InvalidAuthenticationToken', message: 'expired' } } }
        : { status: 201, json: { id: 'd', internetMessageId: '<x@y>', conversationId: 'c', _auth: init.headers.Authorization } }) },
    ])
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async () => {} })
    const out = await mail.send(MB, packTokens({ rt: 'RT', at: 'OLD', exp: NOW + 3_600_000 }), message)
    expect(out.ok).toBe(true)
    expect(drafts).toBe(2)
  })
})

describe('createGraphMail: a permission granted after connecting', () => {
  it('a 403 ErrorAccessDenied on a cached token renews it (asking for every scope) and retries once', async () => {
    let drafts = 0
    const { f, calls } = fakeFetch([
      { method: 'POST', match: '/token', reply: { status: 200, json: { access_token: 'WITH_RW', refresh_token: 'RT2', expires_in: 3600 } } },
      { method: 'POST', match: '/send', reply: { status: 202 } },
      { method: 'POST', match: '/me/messages', reply: () => (++drafts === 1
        ? { status: 403, json: { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } } }
        : { status: 201, json: { id: 'd', internetMessageId: '<x@y>', conversationId: 'c' } }) },
    ])
    const saved = []
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async (mb, p) => saved.push(p) })
    const out = await mail.send(MB, packTokens({ rt: 'RT', at: 'OLD_SCOPES', exp: NOW + 3_600_000 }), {
      from: { name: '', address: MB.email }, to: { name: '', address: 'a@b.sa' }, subject: 's', text: 't', html: '<p>t</p>', messageId: '<m@arak-sa.com>',
    })
    expect(out.ok).toBe(true)
    expect(drafts).toBe(2)
    expect(new URLSearchParams(calls.find(c => c.url.includes('/token')).body).get('scope')).toContain('Mail.ReadWrite')
    expect(unpackTokens(saved[0]).at).toBe('WITH_RW')
  })

  it('still refused after a fresh token: the permission really is missing, and it says so', async () => {
    const { f } = fakeFetch([
      { method: 'POST', match: '/token', reply: { status: 200, json: { access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600 } } },
      { method: 'POST', match: '/me/messages', reply: { status: 403, json: { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } } } },
    ])
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async () => {} })
    const out = await mail.send(MB, packTokens({ rt: 'RT', at: 'OLD', exp: NOW + 3_600_000 }), {
      from: { name: '', address: MB.email }, to: { name: '', address: 'a@b.sa' }, subject: 's', text: 't', html: '<p>t</p>', messageId: '<m@arak-sa.com>',
    })
    expect(out.ok).toBe(false)
    expect(out.error.reason).toMatch(/Mail\.ReadWrite/)
  })
})

describe('createGraphMail.inbox', () => {
  it('asks for the inbox since the mark, oldest first, and flattens the sender', async () => {
    const { f, calls } = fakeFetch([
      { method: 'GET', match: '/me/mailFolders/inbox/messages', reply: { status: 200, json: { value: [
        { id: 'm1', conversationId: 'conv-1', from: { emailAddress: { address: 'Sara@Hotel.sa', name: 'Sara' } }, subject: 'RE: Lighting', receivedDateTime: '2026-09-28T07:00:00Z', bodyPreview: 'Yes please, send it.' },
      ] } } },
    ])
    const mail = createGraphMail({ config: CONFIG, fetch: f, now: () => NOW, save: async () => {} })
    const out = await mail.inbox(MB, packTokens({ rt: 'RT', at: 'LIVE', exp: NOW + 3_600_000 }), '2026-09-28T06:00:00.000Z')
    expect(out.messages).toEqual([{ id: 'm1', threadId: 'conv-1', from: 'sara@hotel.sa', fromName: 'Sara', subject: 'RE: Lighting', preview: 'Yes please, send it.', receivedAt: '2026-09-28T07:00:00Z' }])
    const q = new URL(calls[0].url).searchParams
    expect(q.get('$filter')).toBe('receivedDateTime ge 2026-09-28T06:00:00.000Z')
    expect(q.get('$orderby')).toBe('receivedDateTime asc')
    expect(q.get('$select')).toContain('bodyPreview')
  })
})

describe('whoAmI', () => {
  it('uses the mailbox address, lower-cased, and proves the inbox exists', async () => {
    const { f } = fakeFetch([
      { method: 'GET', match: '/me?', reply: { status: 200, json: { displayName: 'Sales Team', mail: 'Sales1@ARAK-SA.com', userPrincipalName: 'x@arak-sa.com' } } },
      { method: 'GET', match: '/me/mailFolders/inbox', reply: { status: 200, json: { id: 'inbox' } } },
    ])
    expect(await whoAmI({ accessToken: 'AT', fetch: f })).toEqual({ ok: true, email: 'sales1@arak-sa.com', displayName: 'Sales Team' })
  })
  it('an account without a licence fails with the licence reason', async () => {
    const { f } = fakeFetch([
      { method: 'GET', match: '/me?', reply: { status: 200, json: { displayName: 'Old', mail: null, userPrincipalName: 'old@arak-sa.com' } } },
      { method: 'GET', match: '/me/mailFolders/inbox', reply: { status: 404, json: { error: { code: 'MailboxNotEnabledForRESTAPI', message: 'no mailbox' } } } },
    ])
    const r = await whoAmI({ accessToken: 'AT', fetch: f })
    expect(r.ok).toBe(false)
    expect(r.error.reason).toMatch(/licence/)
  })
})
