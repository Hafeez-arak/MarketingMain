import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── The CEO brief's two doors on the chat endpoint ────────────────────────
// Pinned: the cron needs the secret; a non-admin cannot write a brief; an
// admin can; and a brief request needs no question.

const written = []
vi.mock('./_ceoBrief.js', () => ({
  writeCeoBrief: async (ws, opts) => { written.push({ ws, ...opts }); return { id: 'b1', brief: {} } },
}))
let admin = false
vi.mock('./_supabase.js', () => ({
  isConfigured: true,
  callerId: async () => 'u-1',
  callerMayUseWorkspace: async () => true,
  callerIsAdmin: async () => admin,
  db: async path => (String(path).startsWith('workspaces?ceo_brief_enabled') ? [{ id: 'ws-1', name: 'Arak' }] : []),
}))

const { default: handler } = await import('./chat.js')

function res() {
  const r = { code: 0, body: null }
  r.status = c => { r.code = c; return r }
  r.json = b => { r.body = b; return r }
  return r
}

beforeEach(() => { written.length = 0; admin = false; process.env.CRON_SECRET = 's3cret' })

describe('cron', () => {
  it('refuses without the secret and writes nothing', async () => {
    const r = res()
    await handler({ method: 'GET', query: { cron: 'ceo-brief' }, headers: { authorization: 'Bearer nope' } }, r)
    expect(r.code).toBe(401)
    expect(written).toEqual([])
  })
  it('with the secret, writes one brief per enabled company as a scheduled one', async () => {
    const r = res()
    await handler({ method: 'GET', query: { cron: 'ceo-brief' }, headers: { authorization: 'Bearer s3cret' } }, r)
    expect(r.code).toBe(200)
    expect(written).toEqual([{ ws: 'ws-1', trigger: 'schedule' }])
  })
})

describe('write a fresh brief', () => {
  const req = () => ({ method: 'POST', headers: {}, body: { workspace_id: 'ws-1', mode: 'ceo_brief' } })
  it('a non-admin is refused', async () => {
    const r = res()
    await handler(req(), r)
    expect(r.code).toBe(403)
    expect(written).toEqual([])
  })
  it('an admin gets one, with no question needed', async () => {
    admin = true
    const r = res()
    await handler(req(), r)
    expect(r.code).toBe(200)
    expect(written).toEqual([{ ws: 'ws-1', trigger: 'manual', userId: 'u-1' }])
  })
})
