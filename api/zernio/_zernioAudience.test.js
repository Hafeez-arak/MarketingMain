import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { weekStartOf } from '../../src/lib/linkedinAudience.js'

// ─── /api/zernio/audience: who follows the LinkedIn page ───────────────────
// Driven through the real handler with a fake fetch standing in for Supabase
// and Zernio. Pinned: the first look in a week takes the snapshot and never
// overwrites one already there; a stored week is not re-read from Zernio; a
// personal profile and a foreign account are refused; and a missing table
// still shows this week's live numbers.

process.env.SUPABASE_URL = 'https://db.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.SUPABASE_ANON_KEY = 'anon'
process.env.ZERNIO_API_KEY = 'zk'

const { default: handler } = await import('./[action].js')

const WS = '00000000-0000-0000-0000-000000000001'
const PAGE = 'li-page-1'

let calls, stored, accountType, storeFails
const demographics = {
  success: true,
  demographics: {
    industry: [{ dimension: 'Construction', id: 'urn:li:industry:48', value: 365 }],
    seniority: [{ dimension: 'Entry', id: 'urn:li:seniority:3', value: 1711 }],
  },
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

function fakeFetch(url, init = {}) {
  const u = String(url)
  const method = init.method || 'GET'
  calls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : null, prefer: init.headers?.Prefer })
  if (u.includes('/auth/v1/user')) return json({ id: 'user-1' })
  if (u.includes('/rest/v1/workspaces')) return json([{ id: WS, name: 'Arak', zernio_profile_id: 'prof-1' }])
  if (u.includes('/rest/v1/linkedin_audience_snapshots')) {
    if (storeFails) return json({ message: 'relation does not exist' }, 404)
    return method === 'GET' ? json(stored) : new Response('', { status: 201 })
  }
  if (u.includes('zernio.com/api/v1/accounts')) {
    return json({ accounts: [{ _id: PAGE, platform: 'linkedin', profileId: { _id: 'prof-1' }, accountType, followersCount: 4866 }] })
  }
  if (u.includes('zernio.com/api/v1/analytics/linkedin/demographics')) return json(demographics)
  return json({ error: `unexpected ${u}` }, 500)
}

function call(body) {
  const r = { code: 0, body: null, headers: {} }
  r.status = c => { r.code = c; return r }
  r.json = b => { r.body = b; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  return handler({
    method: 'POST', query: { action: 'audience' },
    headers: { authorization: 'Bearer user-token' },
    body: { workspace_id: WS, ...body },
  }, r).then(() => r)
}

const zernioDemoReads = () => calls.filter(c => c.url.includes('linkedin/demographics'))
const writes = () => calls.filter(c => c.url.includes('linkedin_audience_snapshots') && c.method === 'POST')

beforeEach(() => {
  calls = []; stored = []; accountType = 'organization'; storeFails = false
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => vi.unstubAllGlobals())

describe('audience', () => {
  it('first look this week: reads Zernio, stores the snapshot without overwriting, and shows it', async () => {
    const r = await call({ account_id: PAGE })
    expect(r.code).toBe(200)
    expect(zernioDemoReads()).toHaveLength(1)
    expect(zernioDemoReads()[0].url).toContain(`accountId=${PAGE}`)
    const [w] = writes()
    expect(w.prefer).toMatch(/ignore-duplicates/)
    expect(w.url).toContain('on_conflict=workspace_id,zernio_account_id,week_start')
    expect(w.body).toMatchObject({ workspace_id: WS, zernio_account_id: PAGE, week_start: weekStartOf(), followers: 4866 })
    expect(w.body.demographics.industry[0]).toEqual({ label: 'Construction', id: 'urn:li:industry:48', value: 365 })
    expect(r.body.snapshots[0].week_start).toBe(weekStartOf())
    expect(r.body.snapshots[0].workspace_id).toBeUndefined()
  })

  it('reads stored snapshots for THIS workspace and account only', async () => {
    await call({ account_id: PAGE })
    const read = calls.find(c => c.url.includes('linkedin_audience_snapshots') && c.method === 'GET')
    expect(read.url).toContain(`workspace_id=eq.${WS}`)
    expect(read.url).toContain(`zernio_account_id=eq.${PAGE}`)
  })

  it('a week already stored is not read from Zernio again', async () => {
    stored = [{ week_start: weekStartOf(), followers: 4866, demographics: { industry: [{ label: 'X', id: 'x', value: 1 }] } }]
    const r = await call({ account_id: PAGE })
    expect(r.code).toBe(200)
    expect(zernioDemoReads()).toHaveLength(0)
    expect(writes()).toHaveLength(0)
    expect(r.body.snapshots).toHaveLength(1)
  })

  it('a personal profile is refused before anything is read', async () => {
    accountType = 'personal'
    const r = await call({ account_id: PAGE })
    expect(r.code).toBe(400)
    expect(zernioDemoReads()).toHaveLength(0)
  })

  it('an account outside this workspace is refused', async () => {
    const r = await call({ account_id: 'someone-elses' })
    expect(r.code).toBe(403)
    expect(zernioDemoReads()).toHaveLength(0)
  })

  it('a missing table still shows this week live, and writes nothing', async () => {
    storeFails = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call({ account_id: PAGE })
    err.mockRestore()
    expect(r.code).toBe(200)
    expect(r.body.snapshots).toHaveLength(1)
    expect(writes()).toHaveLength(0)
  })
})
