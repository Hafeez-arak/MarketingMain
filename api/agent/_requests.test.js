import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Requests from the chat, against a scripted database ───────────────────
// Pinned: who a request is created by comes from the session, never the
// model; only people on the tag list can be tagged; "mine" means the person
// in this chat; a non-admin cannot read or move someone else's request; and
// every write carries updated_by, which the notify trigger depends on.

const calls = []
let route = () => []
vi.mock('./_supabase.js', () => ({
  db: async (path, opts = {}) => {
    const call = { path: String(path), method: opts.method || 'GET', body: opts.body }
    calls.push(call)
    return route(call)
  },
}))

const { runTool } = await import('./_tools.js')

const WS = 'ws-1'
const CEO = { userId: 'u-ceo', chatId: 'c-1', isAdmin: true }
const SHADIA = { userId: 'u-shadia', chatId: 'c-2', isAdmin: false }
const ACCESS = [
  { user_id: 'u-ceo', email: 'mkader@arak-sa.com', full_name: null },
  { user_id: 'u-shadia', email: 'shadia@arak-sa.com', full_name: 'shadia' },
  { user_id: 'u-hafeez', email: 'hafeez@arak-sa.com', full_name: null },
]
const PEOPLE = [{ user_id: 'u-shadia', label: 'Marketing' }, { user_id: 'u-hafeez', label: 'Builds the app' }]

function base({ method, path }) {
  if (path.startsWith('user_access')) return ACCESS
  if (path.startsWith('request_people') && path.includes('gets_new_requests')) return [{ user_id: 'u-hafeez' }]
  if (path.startsWith('request_people')) return PEOPLE
  if (method === 'POST' && path === 'requests') return [{ id: 'r-new', title: 'x', status: 'new' }]
  return []
}

const posts = () => calls.filter(c => c.method === 'POST' && c.path === 'requests')

beforeEach(() => { calls.length = 0; route = base })

describe('file_request', () => {
  it('creates the request as the person in the chat, whatever the model says', async () => {
    const out = await runTool(WS, 'file_request', { title: 'Add a monthly sales report', details: 'I want a report', created_by: 'u-hafeez', workspace_id: 'other' }, CEO)
    expect(out.ok).toBe(true)
    const body = posts()[0].body
    expect(body).toMatchObject({ workspace_id: WS, created_by: 'u-ceo', updated_by: 'u-ceo', chat_id: 'c-1', kind: 'improvement', title: 'Add a monthly sales report' })
    expect(out.result.seen_by).toEqual(['hafeez'])
  })

  it('needs a signed-in chat: no session, no request', async () => {
    const out = await runTool(WS, 'file_request', { title: 'x', details: 'y' }, {})
    expect(out.ok).toBe(false)
    expect(posts()).toEqual([])
  })
})

describe('tag_person', () => {
  it('assigns to someone on the tag list, matched by first name', async () => {
    const out = await runTool(WS, 'tag_person', { person: '@Shadia', title: 'Redo the Friday caption', brief: 'Stronger hook' }, CEO)
    expect(out.ok).toBe(true)
    expect(out.result.tagged).toBe('shadia')
    expect(posts()[0].body).toMatchObject({ assigned_to: 'u-shadia', created_by: 'u-ceo', brief: 'Stronger hook', kind: 'task' })
  })

  it('refuses someone not on the list and names who is', async () => {
    const out = await runTool(WS, 'tag_person', { person: 'Ammar', title: 'x', brief: 'y' }, CEO)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not on the tag list.*shadia, hafeez/)
    expect(posts()).toEqual([])
  })
})

describe('get_requests', () => {
  it('"mine" filters to the person in the chat', async () => {
    await runTool(WS, 'get_requests', {}, CEO)
    const read = calls.find(c => c.path.startsWith('requests?'))
    expect(read.path).toContain('created_by=eq.u-ceo')
    expect(read.path).toContain(`workspace_id=eq.${WS}`)
  })

  it('a non-admin asking for "all" still only sees what they asked for or own', async () => {
    await runTool(WS, 'get_requests', { scope: 'all', search: 'caption' }, SHADIA)
    const read = calls.find(c => c.path.startsWith('requests?'))
    expect(read.path).toMatch(/and=\(or\(title\.ilike\.\*caption\*,body\.ilike\.\*caption\*\),or\(created_by\.eq\.u-shadia,assigned_to\.eq\.u-shadia\)\)/)
  })

  it('an admin asking for "all" sees the board', async () => {
    await runTool(WS, 'get_requests', { scope: 'all' }, CEO)
    const read = calls.find(c => c.path.startsWith('requests?'))
    expect(read.path).not.toMatch(/created_by\.eq|assigned_to\.eq/)
  })
})

describe('update_request', () => {
  const existing = r => call => {
    if (call.method === 'GET' && call.path.startsWith('requests?id=eq.')) return [r]
    return base(call)
  }

  it('the assignee can mark it done; updated_by is the person acting', async () => {
    route = existing({ id: 'r1', title: 'Caption', created_by: 'u-ceo', assigned_to: 'u-shadia', status: 'new' })
    const out = await runTool(WS, 'update_request', { id: 'r1', status: 'done', note: 'Rewritten' }, SHADIA)
    expect(out.ok).toBe(true)
    const patch = calls.find(c => c.method === 'PATCH')
    expect(patch.path).toContain(`workspace_id=eq.${WS}`)
    expect(patch.body).toEqual({ updated_by: 'u-shadia', status: 'done', resolution: 'Rewritten' })
  })

  it('someone unrelated who is not an admin cannot move it', async () => {
    route = existing({ id: 'r1', title: 'Report', created_by: 'u-ceo', assigned_to: 'u-hafeez', status: 'new' })
    const out = await runTool(WS, 'update_request', { id: 'r1', status: 'done' }, SHADIA)
    expect(out.ok).toBe(false)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('an id from another company finds nothing', async () => {
    const out = await runTool(WS, 'update_request', { id: 'elsewhere', status: 'done' }, CEO)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/No request with that id/)
  })

  it('a comment alone writes a comment event, not a status change', async () => {
    route = existing({ id: 'r1', title: 'Report', created_by: 'u-ceo', assigned_to: null, status: 'new' })
    const out = await runTool(WS, 'update_request', { id: 'r1', comment: 'Any update?' }, CEO)
    expect(out.ok).toBe(true)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    expect(calls.find(c => c.method === 'POST' && c.path === 'request_events').body).toMatchObject({ kind: 'comment', actor: 'u-ceo', body: 'Any update?' })
  })
})
