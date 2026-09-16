import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { serviceAccount, siteFor, signedAssertion, fetchSearchData } from './_searchConsole.js'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const SA = { client_email: 'bot@p.iam.gserviceaccount.com', private_key: privateKey }
const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

describe('serviceAccount', () => {
  it('reads the key as raw JSON', () => {
    expect(serviceAccount({ GOOGLE_SA_KEY: JSON.stringify(SA) })?.client_email).toBe(SA.client_email)
  })

  it('also reads it base64-encoded, because a PEM with newlines survives some .env parsers and not others', () => {
    const b64 = Buffer.from(JSON.stringify(SA)).toString('base64')
    expect(serviceAccount({ GOOGLE_SA_KEY: b64 })?.client_email).toBe(SA.client_email)
  })

  it('returns nothing for an unset, malformed, or incomplete key rather than a half-built account', () => {
    expect(serviceAccount({})).toBeNull()
    expect(serviceAccount({ GOOGLE_SA_KEY: 'not json' })).toBeNull()
    expect(serviceAccount({ GOOGLE_SA_KEY: '{"client_email":"a@b.c"}' })).toBeNull()
  })
})

describe('siteFor', () => {
  it('prefers the brand’s own property over the deployment-wide fallback', () => {
    expect(siteFor('arak-sa.com', { GOOGLE_SC_SITE: 'other.com' })).toBe('sc-domain:arak-sa.com')
  })

  it('falls back to the environment when the brand has none', () => {
    expect(siteFor('', { GOOGLE_SC_SITE: 'other.com' })).toBe('sc-domain:other.com')
  })
})

describe('signedAssertion', () => {
  const jwt = signedAssertion(SA, { now: 1_700_000_000 })

  it('is a three-part RS256 JWT', () => {
    expect(jwt.split('.')).toHaveLength(3)
    expect(decode(jwt.split('.')[0])).toEqual({ alg: 'RS256', typ: 'JWT' })
  })

  it('asks only for read access — indexing is not this agent’s job', () => {
    expect(decode(jwt.split('.')[1]).scope).toBe('https://www.googleapis.com/auth/webmasters.readonly')
  })

  it('is addressed to the token endpoint and expires in an hour', () => {
    const c = decode(jwt.split('.')[1])
    expect(c.aud).toBe('https://oauth2.googleapis.com/token')
    expect(c.exp - c.iat).toBe(3600)
    expect(c.iss).toBe(SA.client_email)
  })
})

describe('fetchSearchData', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reports "not configured" without making a single call when there is no key', async () => {
    const out = await fetchSearchData({ site: 'arak-sa.com', env: {} })
    expect(out.configured).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports "not configured" when a key exists but no property does', async () => {
    const out = await fetchSearchData({ site: '', env: { GOOGLE_SA_KEY: JSON.stringify(SA) } })
    expect(out.configured).toBe(false)
    expect(out.ok).toBe(false)
  })

  it('distinguishes a configured-but-failing property from an unconfigured one', async () => {
    // The distinction the whole lens rests on: a dead credential must not be
    // reportable as "nobody searched for us".
    global.fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }),
    })
    const out = await fetchSearchData({ site: 'arak-sa.com', env: { GOOGLE_SA_KEY: JSON.stringify(SA) } })
    expect(out.configured).toBe(true)
    expect(out.ok).toBe(false)
    expect(out.error).toContain('Invalid JWT Signature')
  })

  it('explains the 403 that means the service account was never added as a user', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: 'User does not have sufficient permission.' } }) })
    const out = await fetchSearchData({ site: 'arak-sa.com', env: { GOOGLE_SA_KEY: JSON.stringify(SA) } })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('Users and permissions')
  })

  it('asks for both windows and the page breakdown, and addresses the domain property correctly', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValue({ ok: true, json: async () => ({ rows: [{ keys: ['knx'], clicks: 1, impressions: 50, position: 9 }] }) })

    const out = await fetchSearchData({
      site: 'arak-sa.com', now: new Date('2026-09-16T00:00:00Z'),
      env: { GOOGLE_SA_KEY: JSON.stringify(SA) },
    })

    expect(out.ok).toBe(true)
    expect(out.queries[0].query).toBe('knx')
    expect(out.windows.current.end).toBe('2026-09-13')

    const urls = global.fetch.mock.calls.slice(1).map(c => c[0])
    expect(urls).toHaveLength(3)
    // encodeURIComponent keeps the colon, which the API requires.
    expect(urls[0]).toContain('sc-domain%3Aarak-sa.com')
  })
})
