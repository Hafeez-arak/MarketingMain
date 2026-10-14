import { describe, it, expect, beforeEach } from 'vitest'
import { odooLeadValues, approveLead, sendWaiting, saveCrm, crmStatus, STUCK_MS } from './_crm.js'
import { normalizeUrl, defaultDb, testConnection } from './_odoo.js'

// Approve → Odoo, against a fake Odoo (its JSON-RPC, as Odoo 18 answers it)
// and an in-memory leads table that understands the handful of PostgREST
// calls _crm.js makes. Made-up leads only (this repo is public).

const WS = '11111111-1111-4111-8111-111111111111'
const L1 = '22222222-2222-4222-8222-222222222222'
const L2 = '33333333-3333-4333-8333-333333333333'
const LAYLA = { id: '44444444-4444-4444-8444-444444444444', email: 'layla@example.com' }
// The salesperson the leads are assigned to, and who they are in Odoo.
const OMAR = { id: '55555555-5555-4555-8555-555555555555', email: 'omar@example.com' }
const ODOO_USERS = { 'omar@example.com': 21, 'omar.k': 22 }

// Odoo Online names its database after the account, not the subdomain
// (arak-co.odoo.com runs "profaccountant-arak-co-main-…"), and lists it.
const REAL_DB = 'example-arak-co-main-123'

function fakeOdoo({ plan = 'custom', canCreate = true, failCreate = false, listsDb = true } = {}) {
  const odoo = { leads: [], tags: [], calls: [] }
  odoo.fetch = async (url, init) => {
    if (String(url).endsWith('/web/database/list')) {
      return new Response(JSON.stringify(listsDb ? { jsonrpc: '2.0', id: 1, result: [REAL_DB] } : { jsonrpc: '2.0', id: 1, error: { message: 'Access Denied' } }))
    }
    const { params } = JSON.parse(init.body)
    const { service, method, args } = params
    odoo.calls.push(`${service}.${method}${service === 'object' ? ` ${args[3]}.${args[4]}` : ''}`)
    const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    const err = (message) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 200, message: 'Odoo Server Error', data: { name: 'odoo.exceptions.AccessDenied', message } } }))
    if (service === 'common' && method === 'version') return ok({ server_version: '18.0+e' })
    if (service === 'common' && method === 'authenticate') {
      if (plan !== 'custom') return err('API access requires the Custom plan.')
      if (![REAL_DB, 'arak-co', 'erp'].includes(args[0])) return err(`connection to server failed: database "${args[0]}" does not exist`)
      return ok(args[2] === 'good-key' ? 7 : false)
    }
    const [, , , model, m, a, kw] = args
    if (model === 'crm.lead' && m === 'check_access_rights') return ok(canCreate)
    if (model === 'crm.lead' && m === 'search_count') return ok(odoo.leads.length)
    if (model === 'crm.lead' && m === 'search') return ok(odoo.leads.filter((l) => l.description.includes(a[0][0][2])).map((l) => l.id).slice(0, kw.limit))
    if (model === 'crm.lead' && m === 'create') {
      if (failCreate) return err('You are not allowed to create CRM leads.')
      odoo.leads.push({ id: 100 + odoo.leads.length, ...a[0] })
      return ok(100 + odoo.leads.length - 1)
    }
    if (model === 'res.users' && m === 'search') {
      const who = String(a[0][1][2]).toLowerCase()
      return ok(ODOO_USERS[who] ? [ODOO_USERS[who]] : [])
    }
    if (model === 'crm.lead' && m === 'write') {
      for (const id of a[0]) Object.assign(odoo.leads.find((l) => l.id === id) || {}, a[1])
      return ok(true)
    }
    if (model === 'crm.tag' && m === 'search') return ok(odoo.tags.filter((t) => t.name === a[0][0][2]).map((t) => t.id))
    if (model === 'crm.tag' && m === 'create') { odoo.tags.push({ id: odoo.tags.length + 1, ...a[0] }); return ok(odoo.tags.length) }
    return err(`fake odoo: ${model}.${m}`)
  }
  return odoo
}

function lead(over = {}) {
  return {
    id: L1, workspace_id: WS, source: 'email', mailbox: 'info@clb-sa.com', folder: 'junk', received_at: '2026-10-06T10:00:00Z',
    name: 'Khalid', company: 'Example Dev', email: 'khalid@example-dev.sa', phones: ['+966 55 000 1111', '+966 12 600 0000'],
    subject: 'Tower facade', message: 'We need facade lighting <b>now</b>.', summary: 'Facade lighting, 20-floor tower, Jeddah',
    ask_next: ['Timeline?'], verdict: 'needs_review', human_verdict: null, criteria_version: 2, sender_type: 'contractor',
    source_check: 'verified', project_type: 'tender', request_type: 'requirement', philips: 'or_equivalent', email_kind: 'company',
    approved_at: null, approved_by: null, assigned_to: OMAR.id, crm_status: null, crm_id: '', crm_url: '', crm_error: '', updated_at: '2026-10-12T08:00:00Z',
    ...over,
  }
}

function fakeDb(rows, crmRow = null) {
  const state = { leads: rows.map((r) => ({ ...r })), crm: crmRow, writes: [], seats: { [OMAR.id]: { odoo_login: '', odoo_user_id: null } } }
  const byId = (path) => state.leads.find((l) => path.includes(`id=eq.${l.id}`))
  state.db = async (path, { method = 'GET', body } = {}) => {
    if (method !== 'GET') state.writes.push(`${method} ${path.split('?')[0]}`)
    if (path.startsWith('lead_crm')) {
      if (method === 'GET') return state.crm ? [state.crm] : []
      if (method === 'POST') { state.crm = { ...state.crm, ...body }; return [] }
      if (method === 'DELETE') { state.crm = null; return [] }
    }
    if (path.startsWith('user_access')) {
      return path.includes(OMAR.id) ? [{ email: OMAR.email, full_name: 'Omar' }] : [{ email: LAYLA.email, full_name: 'Layla' }]
    }
    if (path.startsWith('sales_seats')) {
      const id = Object.keys(state.seats).find((k) => path.includes(`user_id=eq.${k}`))
      if (method === 'GET') return id ? [state.seats[id]] : []
      if (method === 'PATCH') { Object.assign(state.seats[id], body); return [] }
    }
    if (path.startsWith('leads?workspace_id') && path.includes('crm_status=in.(queued,failed)')) {
      return state.leads.filter((l) => ['queued', 'failed'].includes(l.crm_status))
    }
    const row = byId(path)
    if (method === 'GET') return row ? [row] : []
    if (method === 'PATCH') {
      if (!row) return []
      if (path.includes('or=(crm_status.is.null')) {
        const stuck = new Date(Date.parse(state.now) - STUCK_MS).toISOString()
        const free = [null, 'queued', 'failed'].includes(row.crm_status) || (row.crm_status === 'sending' && row.updated_at < stuck)
        if (!free) return []
      }
      Object.assign(row, body)
      return [{ ...row }]
    }
    throw new Error(`fake db: ${method} ${path}`)
  }
  state.now = '2026-10-12T09:00:00Z'
  return state
}

const seal = (s) => `sealed:${s}`
const open = (s) => s.replace(/^sealed:/, '')
const connected = { workspace_id: WS, url: 'https://arak-co.odoo.com', db: 'arak-co', login: 'lead.agent@example.com', api_key: seal('good-key'), odoo_uid: 7 }
const depsOf = (state, odoo) => ({ db: state.db, fetch: odoo.fetch, now: () => new Date(state.now), seal, open })

describe('the Odoo address', () => {
  it('takes what people paste, and names the Odoo Online database', () => {
    expect(normalizeUrl('arak-co.odoo.com/odoo/crm')).toBe('https://arak-co.odoo.com')
    expect(normalizeUrl(' https://arak-co.odoo.com/ ')).toBe('https://arak-co.odoo.com')
    expect(normalizeUrl('not a url')).toBe('')
    expect(defaultDb('https://arak-co.odoo.com')).toBe('arak-co')
    expect(defaultDb('https://erp.example.com')).toBe('')
  })
})

describe('what Odoo receives', () => {
  it('a titled lead with contact, company, first number, tags, and the rest in the description', () => {
    const v = odooLeadValues(lead(), { approvedBy: 'Layla (layla@example.com)' })
    expect(v).toMatchObject({
      name: 'Facade lighting, 20-floor tower, Jeddah (Example Dev)', contact_name: 'Khalid', partner_name: 'Example Dev',
      email_from: 'khalid@example-dev.sa', phone: '+966 55 000 1111', tags: ['Lead Agent', 'CLB email', 'Tender'],
    })
    for (const bit of ['Contractor', 'Verified', 'Requirement', 'Tender', 'Philips or equivalent', 'Junk', '+966 12 600 0000', 'Timeline?', 'Layla (layla@example.com)', `Lead Agent ref: ${L1}`]) {
      expect(v.description).toContain(bit)
    }
    // Their words are text, never markup.
    expect(v.description).toContain('&lt;b&gt;now&lt;/b&gt;')
  })
})

describe('testing the connection (read only)', () => {
  it('signs in, checks the create right, counts leads, and writes nothing', async () => {
    const odoo = fakeOdoo()
    const r = await testConnection(odoo.fetch, { url: 'https://arak-co.odoo.com', db: 'arak-co', login: 'x', apiKey: 'good-key' })
    expect(r).toEqual({ ok: true, uid: 7, version: '18.0+e', canCreate: true, leadCount: 0 })
    expect(odoo.calls.some((c) => /create$/.test(c))).toBe(false)
  })
  it('says what Odoo says when the plan has no API', async () => {
    const odoo = fakeOdoo({ plan: 'standard' })
    const r = await testConnection(odoo.fetch, { url: 'https://arak-co.odoo.com', db: 'arak-co', login: 'x', apiKey: 'good-key' })
    expect(r).toEqual({ ok: false, error: 'API access requires the Custom plan.' })
  })
})

describe('approving', () => {
  let state
  beforeEach(() => { state = fakeDb([lead(), lead({ id: L2, company: 'Other Co', summary: 'Other' })]) })

  it('without Odoo connected: approved, qualified, and waiting', async () => {
    const odoo = fakeOdoo()
    const r = await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(r.crm).toBe('queued')
    expect(r.lead).toMatchObject({ crm_status: 'queued', approved_by: LAYLA.id, human_verdict: 'qualified' })
    expect(odoo.calls).toEqual([])
  })

  it('with Odoo connected: in Odoo once, however many times it is approved', async () => {
    state.crm = { ...connected }
    const odoo = fakeOdoo()
    const r = await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(r.crm).toBe('sent')
    expect(r.lead).toMatchObject({ crm_status: 'sent', crm_id: '100', crm_url: 'https://arak-co.odoo.com/web#id=100&model=crm.lead&view_type=form' })
    expect(odoo.leads).toHaveLength(1)
    expect(odoo.leads[0].description).toContain('Layla (layla@example.com)')
    expect(odoo.leads[0].tag_ids).toEqual([[6, 0, [1, 2, 3]]])
    const again = await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(again.crm).toBe('already')
    expect(odoo.leads).toHaveLength(1)
  })

  it('a refusal is kept on the lead, and approving again retries it', async () => {
    state.crm = { ...connected }
    const r = await approveLead(depsOf(state, fakeOdoo({ failCreate: true })), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(r.lead).toMatchObject({ crm_status: 'failed', crm_error: 'You are not allowed to create CRM leads.' })
    const odoo = fakeOdoo()
    expect((await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })).crm).toBe('sent')
    expect(odoo.leads).toHaveLength(1)
  })

  it('a lead being sent right now is not sent a second time; one stuck for long is', async () => {
    state.crm = { ...connected }
    Object.assign(state.leads[0], { crm_status: 'sending', updated_at: '2026-10-12T08:58:00Z' })
    const odoo = fakeOdoo()
    expect((await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })).crm).toBe('already')
    expect(odoo.leads).toHaveLength(0)
    state.leads[0].updated_at = '2026-10-12T08:40:00Z'
    expect((await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })).crm).toBe('sent')
  })

  it('a push that died after Odoo saved it is not created twice', async () => {
    state.crm = { ...connected }
    const odoo = fakeOdoo()
    odoo.leads.push({ id: 55, description: `<p>Lead Agent ref: ${L1}</p>` })
    const r = await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(r.lead).toMatchObject({ crm_status: 'sent', crm_id: '55' })
    expect(odoo.leads).toHaveLength(1)
  })

  it('goes into Odoo with its salesperson, found once by their email and kept on their seat', async () => {
    state.crm = { ...connected }
    const odoo = fakeOdoo()
    await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(odoo.leads[0].user_id).toBe(21)
    expect(state.seats[OMAR.id].odoo_user_id).toBe(21)
    await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L2, user: LAYLA })
    expect(odoo.leads[1].user_id).toBe(21)
    expect(odoo.calls.filter((c) => c.includes('res.users.search'))).toHaveLength(1)
  })

  it('an Odoo login set on the seat wins over their email', async () => {
    state.crm = { ...connected }
    state.seats[OMAR.id].odoo_login = 'omar.k'
    const odoo = fakeOdoo()
    await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(odoo.leads[0].user_id).toBe(22)
  })

  it('is not approved with no one assigned', async () => {
    state.leads[0].assigned_to = null
    const odoo = fakeOdoo()
    const r = await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(r).toMatchObject({ status: 400, error: expect.stringMatching(/Assign this lead/) })
    expect(state.leads[0].approved_at).toBeNull()
    expect(odoo.calls).toEqual([])
  })

  it('a salesperson Odoo does not know: refused on the lead, in words the admin can act on, and nothing created', async () => {
    state.crm = { ...connected }
    state.seats[OMAR.id].odoo_login = 'nobody@example.com'
    const odoo = fakeOdoo()
    const r = await approveLead(depsOf(state, odoo), { workspaceId: WS, leadId: L1, user: LAYLA })
    expect(r.lead.crm_status).toBe('failed')
    expect(r.lead.crm_error).toMatch(/Omar \(omar@example\.com\) has no user in Odoo with the login nobody@example\.com/)
    expect(odoo.leads).toHaveLength(0)
  })

  it('refuses a lead of another company', async () => {
    const r = await approveLead(depsOf(state, fakeOdoo()), { workspaceId: '99999999-9999-4999-8999-999999999999', leadId: '55555555-5555-4555-8555-555555555555', user: LAYLA })
    expect(r.status).toBe(404)
  })
})

describe('when the API key arrives', () => {
  it('connecting saves the details sealed, and the waiting leads go with Send', async () => {
    const state = fakeDb([lead({ crm_status: 'queued', approved_by: LAYLA.id }), lead({ id: L2, crm_status: 'queued' })])
    const odoo = fakeOdoo()
    const deps = depsOf(state, odoo)
    expect((await crmStatus(deps, WS))).toMatchObject({ connected: false, queued: 2 })
    const saved = await saveCrm(deps, WS, { url: 'arak-co.odoo.com', login: 'lead.agent@example.com', api_key: 'good-key' })
    expect(saved.crm).toMatchObject({ connected: true, url: 'https://arak-co.odoo.com', db: REAL_DB, version: '18.0+e', hasKey: true })
    expect(state.crm.api_key).toBe('sealed:good-key')
    expect(saved.crm).not.toHaveProperty('apiKey')
    const out = await sendWaiting(deps, WS)
    expect(out).toEqual({ sent: 2, failed: 0, left: 0 })
    expect(odoo.leads).toHaveLength(2)
    expect(odoo.leads[0].description).toContain('Layla (layla@example.com)')
  })

  it('the database is asked of Odoo, typed by the admin when given, and guessed from the address only as a last resort', async () => {
    const state = fakeDb([])
    await saveCrm(depsOf(state, fakeOdoo()), WS, { url: 'arak-co.odoo.com', login: 'x', api_key: 'good-key' })
    expect(state.crm.db).toBe(REAL_DB)
    await saveCrm(depsOf(state, fakeOdoo()), WS, { url: 'arak-co.odoo.com', db: 'erp', login: 'x', api_key: 'good-key' })
    expect(state.crm.db).toBe('erp')
    await saveCrm(depsOf(state, fakeOdoo({ listsDb: false })), WS, { url: 'arak-co.odoo.com', login: 'x', api_key: 'good-key' })
    expect(state.crm.db).toBe('arak-co')
  })

  it('a wrong key is saved for fixing but not connected, with Odoo\'s reason', async () => {
    const state = fakeDb([])
    const saved = await saveCrm(depsOf(state, fakeOdoo()), WS, { url: 'https://arak-co.odoo.com', login: 'x', api_key: 'bad-key' })
    expect(saved.crm).toMatchObject({ connected: false, lastError: 'Odoo did not accept that login and API key.' })
  })
})
