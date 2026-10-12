import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

// Who may call /api/leads/<action> (20261013_sales_seats). The admin may call
// everything; a sales seat may correct a verdict and fetch an email and
// nothing else; anyone else nothing. Supabase is faked at fetch, so the
// handler's own checks run exactly as deployed.

const WS = '11111111-1111-4111-8111-111111111111'
const LEAD = '22222222-2222-4222-8222-222222222222'

let who // { member, admin, sales }
let calls

function fakeFetch(url, init = {}) {
  const u = String(url)
  const method = init.method || 'GET'
  calls.push(`${method} ${u.replace('https://db.test', '')}`)
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  if (u.includes('/auth/v1/user')) return json({ id: 'user-1' })
  if (u.includes('/rpc/is_access_admin')) return json(who.admin)
  if (u.includes('/rpc/is_sales_member')) return json(who.sales)
  if (u.includes('/rpc/can_approve_leads')) return json(Boolean(who.approver))
  if (u.includes('/rest/v1/workspaces?id=eq.')) return json(who.member ? [{ id: WS }] : [])
  if (u.includes('/rest/v1/leads?id=eq.') && method === 'PATCH') {
    const body = JSON.parse(init.body)
    return json([{ id: LEAD, human_verdict: body.human_verdict }])
  }
  return json([])
}

function call(handler, action, body) {
  const res = {
    statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    send(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
  const req = { method: 'POST', query: { action }, headers: { authorization: 'Bearer tok' }, body: { workspace_id: WS, ...body } }
  return Promise.resolve(handler(req, res)).then(() => res)
}

let handler
beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://db.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.resetModules()
  handler = (await import('./[action].js')).default
})
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
beforeEach(() => { calls = [] })

const writes = () => calls.filter((c) => !c.startsWith('GET') && !c.includes('/rpc/'))

describe('a sales seat', () => {
  beforeEach(() => { who = { member: false, admin: false, sales: true } })

  it('can correct a verdict', async () => {
    const res = await call(handler, 'review', { lead_id: LEAD, verdict: 'qualified' })
    expect(res.statusCode).toBe(200)
    expect(res.body.lead.human_verdict).toBe('qualified')
    expect(writes()).toEqual([`PATCH /rest/v1/leads?id=eq.${LEAD}&workspace_id=eq.${WS}`])
  })

  it.each(['status', 'set_enabled', 'try', 'mail_disconnect', 'lens_preview', 'mail_connect_start'])('is refused %s, and nothing is written', async (action) => {
    const res = await call(handler, action, { enabled: false, mailbox_id: LEAD })
    expect(res.statusCode).toBe(403)
    expect(writes()).toEqual([])
    // Not even asked: a seat is only looked up for the actions it could open.
    expect(calls.some((c) => c.includes('is_sales_member'))).toBe(false)
  })
})

describe('approving into the CRM', () => {
  it('a sales seat that is not a sales admin is refused, and nothing is written', async () => {
    who = { member: false, admin: false, sales: true, approver: false }
    const res = await call(handler, 'approve', { lead_id: LEAD })
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatch(/sales admin/)
    expect(writes()).toEqual([])
  })

  it('a sales admin gets through to the lead (here: not found in this fake)', async () => {
    who = { member: false, admin: false, sales: true, approver: true }
    const res = await call(handler, 'approve', { lead_id: LEAD })
    expect(res.statusCode).toBe(404)
  })

  it('the Odoo settings are the admin\'s alone, even for a sales admin', async () => {
    who = { member: false, admin: false, sales: true, approver: true }
    for (const action of ['crm_save', 'crm_send', 'crm_disconnect']) {
      expect((await call(handler, action, {})).statusCode).toBe(403)
    }
    expect(writes()).toEqual([])
  })
})

describe('everyone else', () => {
  it('a stranger is refused even the sales actions', async () => {
    who = { member: false, admin: false, sales: false }
    const res = await call(handler, 'review', { lead_id: LEAD, verdict: 'qualified' })
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatch(/do not have access/)
    expect(writes()).toEqual([])
  })

  it('a marketing member without a seat is refused', async () => {
    who = { member: true, admin: false, sales: false }
    const res = await call(handler, 'review', { lead_id: LEAD, verdict: 'qualified' })
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatch(/admin only/)
  })

  it('the admin is let through without a seat lookup', async () => {
    who = { member: true, admin: true, sales: false }
    const res = await call(handler, 'review', { lead_id: LEAD, verdict: 'unqualified' })
    expect(res.statusCode).toBe(200)
    expect(calls.some((c) => c.includes('is_sales_member'))).toBe(false)
  })
})
