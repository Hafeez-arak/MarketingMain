import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// callerIsAdmin decides who may direct-edit from the chat. Pinned here: it asks
// user_access (the real admin flag), not workspace_members.role (which is
// 'owner' for every approved person), and it fails closed.

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
const { callerIsAdmin } = await import('./_supabase.js')

const requested = []
let reply = []
const fetchStub = vi.fn(async url => {
  requested.push(String(url))
  if (reply instanceof Error) throw reply
  return { ok: true, status: 200, text: async () => JSON.stringify(reply) }
})
vi.stubGlobal('fetch', fetchStub)
afterAll(() => vi.unstubAllGlobals())

beforeEach(() => { requested.length = 0; reply = [] })

describe('callerIsAdmin', () => {
  it('reads the verified user\'s own user_access row', async () => {
    reply = [{ role: 'admin', status: 'approved' }]
    expect(await callerIsAdmin('u-1')).toBe(true)
    expect(requested).toHaveLength(1)
    expect(requested[0]).toContain('/rest/v1/user_access?user_id=eq.u-1')
    expect(requested[0]).not.toContain('workspace_members')
  })

  it('a member, a sales seat, or an unapproved admin is not an admin', async () => {
    for (const row of [{ role: 'member', status: 'approved' }, { role: 'sales', status: 'approved' }, { role: 'admin', status: 'pending' }, { role: 'admin', status: 'revoked' }]) {
      reply = [row]
      expect(await callerIsAdmin('u-1'), JSON.stringify(row)).toBe(false)
    }
  })

  it('fails closed: no user, no row, or an unreachable database means no', async () => {
    expect(await callerIsAdmin('')).toBe(false)
    expect(requested).toHaveLength(0)
    reply = []
    expect(await callerIsAdmin('u-1')).toBe(false)
    reply = new Error('ECONNREFUSED')
    expect(await callerIsAdmin('u-1')).toBe(false)
  })
})
