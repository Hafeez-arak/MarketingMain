import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── The Sunday snapshot ───────────────────────────────────────────────────
// Pinned: every connected company page is snapshotted (personal profiles are
// skipped), the cron's row replaces one a page view took earlier that week,
// one failing page does not stop the next, and the brief reads a summary.

const dbCalls = []
let accounts = []
let snapshots = []
vi.mock('./_supabase.js', () => ({
  db: async (path, opts = {}) => {
    dbCalls.push({ path, ...opts })
    if (path.startsWith('social_accounts')) return accounts
    if (path.startsWith('linkedin_audience_snapshots') && !opts.method) return snapshots
    return null
  },
}))

const { captureLinkedInAudiences, readLinkedInAudience } = await import('./_linkedinAudience.js')

const demo = { demographics: { industry: [{ dimension: 'Construction', id: 'urn:li:industry:48', value: 10 }] } }

beforeEach(() => {
  dbCalls.length = 0
  accounts = [
    { workspace_id: 'ws-1', zernio_account_id: 'page-ok', account_type: 'organization', followers_count: 4866 },
    { workspace_id: 'ws-1', zernio_account_id: 'page-bad', account_type: null, followers_count: null },
    { workspace_id: 'ws-2', zernio_account_id: 'person', account_type: 'personal', followers_count: 10 },
  ]
  vi.stubGlobal('fetch', vi.fn(async url => (String(url).includes('page-bad')
    ? new Response(JSON.stringify({ error: 'scope missing', code: 'linkedin_org_analytics_scope_missing' }), { status: 412 })
    : new Response(JSON.stringify(demo), { status: 200 }))))
})
afterEach(() => vi.unstubAllGlobals())

describe('captureLinkedInAudiences', () => {
  it('snapshots each company page, skips personal profiles, and carries on past a failure', async () => {
    const results = await captureLinkedInAudiences({ now: new Date('2026-11-01T04:00:00Z'), env: { ZERNIO_API_KEY: 'k' } })
    expect(results.map(r => [r.account, r.ok])).toEqual([['page-ok', true], ['page-bad', false]])
    const writes = dbCalls.filter(c => c.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0].prefer).toMatch(/merge-duplicates/)
    expect(writes[0].body).toMatchObject({ workspace_id: 'ws-1', zernio_account_id: 'page-ok', week_start: '2026-11-01', followers: 4866 })
  })
})

describe('readLinkedInAudience', () => {
  it('summarises this workspace only', async () => {
    snapshots = [{ zernio_account_id: 'page-ok', week_start: '2026-11-01', followers: 4866, demographics: { industry: [{ label: 'Construction', id: 'a', value: 10 }] } }]
    const s = await readLinkedInAudience('ws-1')
    expect(dbCalls.at(-1).path).toContain('workspace_id=eq.ws-1')
    expect(s).toMatchObject({ available: true, week_of: '2026-11-01', customer_sectors: { pct: 100 } })
  })
  it('nothing stored is not available', async () => {
    snapshots = []
    expect(await readLinkedInAudience('ws-1')).toEqual({ available: false })
  })
})
