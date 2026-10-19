import { describe, it, expect } from 'vitest'
import { syncOdoo, readMirror } from './_odooSync.js'
import { fakeOdooFetch, fakeOdooData, FAKE, matches } from '../../dev/v2db/fakeOdoo.js'
import { odooFacts } from '../../src/lib/control/odoo.js'

// The mirror against the fake Odoo (dev/v2db/fakeOdoo.js, which speaks
// Odoo 18's JSON-RPC) and a fake PostgREST: what is read, what the cursors
// do, and that the hour is respected.

const WS = 'ws-1'
const NOW = new Date('2026-10-19T07:00:00Z')

function world(odoo = fakeOdooData()) {
  const st = { sync: null, records: new Map(), crm: { workspace_id: WS, url: 'http://127.0.0.1:8069', db: FAKE.db, login: FAKE.login, api_key: 'sealed', odoo_uid: FAKE.uid } }
  const db = async (path, { method = 'GET', body } = {}) => {
    const table = path.split('?')[0]
    if (table === 'odoo_sync') {
      if (method === 'GET') return st.sync ? [{ ...st.sync }] : []
      if (method === 'POST') { st.sync = st.sync || { workspace_id: WS, cursors: {}, models: [], ...body }; return [{ ...st.sync }] }
      // PATCH, with the claim condition when there is one
      const m = /last_run_at\.lt\.([^)]+)\)/.exec(decodeURIComponent(path))
      if (m && st.sync.last_run_at && !(st.sync.last_run_at < m[1])) return []
      Object.assign(st.sync, body)
      return [{ ...st.sync }]
    }
    if (table === 'lead_crm') return st.crm ? [{ ...st.crm }] : []
    if (table === 'odoo_records' && method === 'POST') { for (const r of body) st.records.set(`${r.model}:${r.odoo_id}`, r); return null }
    if (table === 'odoo_records') return [...st.records.values()].map(r => ({ model: r.model, data: r.data }))
    return []
  }
  const deps = { db, fetch: fakeOdooFetch(odoo), now: () => NOW, open: () => FAKE.apiKey }
  return { st, deps, odoo }
}

describe('the fake Odoo', () => {
  it('evaluates prefix domains as Odoo does', () => {
    const r = { id: 5, write_date: '2026-10-10 09:00:00', state: 'sale' }
    expect(matches(r, ['|', ['write_date', '>', '2026-10-11 00:00:00'], '&', ['write_date', '=', '2026-10-10 09:00:00'], ['id', '>', 4]])).toBe(true)
    expect(matches(r, ['|', ['state', '=', 'draft'], ['state', '=', 'sent']])).toBe(false)
    expect(matches(r, [['state', 'in', ['sale', 'done']], ['id', '!=', 6]])).toBe(true)
  })
})

describe('syncOdoo', () => {
  it('mirrors every installed model and remembers where it got to', async () => {
    const { st, deps } = world()
    const out = await syncOdoo(deps, { workspaceId: WS, force: true })
    expect(out.error).toBeUndefined()
    expect(out.models.sort()).toEqual(['account.analytic.line', 'account.move', 'account.payment', 'crm.lead', 'crm.stage', 'ir.attachment',
      'project.milestone', 'project.project', 'project.project.stage', 'project.task', 'project.update', 'res.users', 'sale.order'])
    expect(out.synced['crm.lead'].changed).toBe(5) // the lost (archived) deal included
    expect(out.synced['project.project'].changed).toBe(6) // the archived project too
    // users 5, crm stages 3, deals 5, orders 6, invoices 7, payments 3,
    // analytic lines 9, project stages 9, projects 6, tasks 6, updates 2,
    // milestones 5, attachments 3
    expect(st.records.size).toBe(5 + 3 + 5 + 6 + 7 + 3 + 9 + 9 + 6 + 6 + 2 + 5 + 3)
    // A field Arak adds in Odoo Studio is read by its name.
    expect(st.records.get('project.project:402').data.x_studio_consultant).toBe('Example Design Consultants')
    expect(st.sync.cursors['crm.lead']).toMatch(/^\d{4}-\d{2}-\d{2} [\d:]+\|\d+$/)
    expect(st.sync.last_error).toBe('')
  })

  it('the next round reads only what changed', async () => {
    const { deps, odoo } = world()
    await syncOdoo(deps, { workspaceId: WS, force: true })
    odoo['crm.lead'][1] = { ...odoo['crm.lead'][1], expected_revenue: 700000, write_date: '2099-01-01 00:00:00' }
    const out = await syncOdoo(deps, { workspaceId: WS, force: true })
    expect(out.synced['crm.lead'].changed).toBe(1)
    expect(out.synced['sale.order'].changed).toBe(0)
  })

  it('runs at most once an hour unless forced, and says when Odoo is not connected', async () => {
    const { st, deps } = world()
    await syncOdoo(deps, { workspaceId: WS, force: true })
    expect(await syncOdoo(deps, { workspaceId: WS })).toEqual({ skipped: true })
    st.crm = null
    st.sync.last_ok_at = '2026-10-19T05:00:00Z'; st.sync.last_run_at = '2026-10-19T05:00:00Z'
    expect(await syncOdoo(deps, { workspaceId: WS })).toEqual({ off: true })
    expect(st.sync.last_error).toMatch(/not connected/)
  })

  it('a refused login is recorded, not thrown', async () => {
    const { st, deps } = world()
    deps.open = () => 'wrong-key'
    const out = await syncOdoo(deps, { workspaceId: WS, force: true })
    expect(out.error).toMatch(/did not accept/)
    expect(st.sync.last_error).toMatch(/did not accept/)
  })

  it('the mirror feeds the CEO\'s numbers', async () => {
    const { deps } = world()
    await syncOdoo(deps, { workspaceId: WS, force: true })
    const m = await readMirror(deps, WS)
    const f = odooFacts(m.records, { models: m.models, url: m.url })
    expect(f.pipeline_deals).toBe(3)
    expect(f.pipeline_sar).toBe(2400000 + 650000)
    expect(f.projects_at_risk).toBe(2) // one at risk, one off track
    expect(f.missing.map(x => x.kind)).toEqual(['deal_no_owner', 'deal_no_value', 'project_no_date', 'project_no_date'])
  })

  it('asks for optional fields only where this Odoo has them', async () => {
    // An Odoo without Sales margin or Sales↔Project, and an older Project.
    const odoo = fakeOdooData()
    const omit = (r, keys) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)))
    odoo['sale.order'] = odoo['sale.order'].map(o => omit(o, ['margin', 'margin_percent', 'project_id']))
    odoo['project.project'] = odoo['project.project'].map(p => ({ ...omit(p, ['date_last_stage_update', 'sale_order_id', 'account_id']), analytic_account_id: p.account_id }))
    const { st, deps } = world(odoo)
    const out = await syncOdoo(deps, { workspaceId: WS, force: true })
    expect(out.error).toBeUndefined()
    const so = st.records.get('sale.order:201').data
    expect(so).not.toHaveProperty('margin_percent')
    const pr = st.records.get('project.project:401').data
    expect(pr.analytic_account_id).toEqual([501, 'Najd clinic lighting'])
    expect(pr).not.toHaveProperty('account_id')
  })

  it('a field this Odoo lacks fails the read, as the real one does', async () => {
    const { deps } = world()
    const f = deps.fetch
    const r = await f('http://x/jsonrpc', { body: JSON.stringify({ params: { service: 'object', method: 'execute_kw', args: [FAKE.db, FAKE.uid, FAKE.apiKey, 'sale.order', 'search_read', [[]], { fields: ['nope'] }] } }) })
    expect((await r.json()).error.data.message).toMatch(/Invalid field 'nope'/)
  })

  it('runs Technical\'s monitor after a good round, and survives it failing', async () => {
    const { deps } = world()
    deps.technical = async () => { throw new Error('monitor down') }
    const out = await syncOdoo(deps, { workspaceId: WS, force: true })
    expect(out.error).toBeUndefined()
    expect(out.technical.error).toMatch(/monitor down/)
  })
})
