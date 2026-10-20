import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Find prospects, against a scripted database and a scripted model ──────
// Pinned: a search row is opened and always closed; only sourced companies we
// do not already have are written (a rejected one included in "have"); a
// second search while one runs is refused before anything is paid for; and a
// failed or timed-out call says so instead of reporting an empty market.

const calls = []
let route = () => []
vi.mock('./_supabase.js', () => ({
  db: async (path, opts = {}) => {
    const call = { path: String(path), method: opts.method || 'GET', body: opts.body }
    calls.push(call)
    return route(call)
  },
}))

let modelAnswer = null
const modelCalls = []
vi.mock('./_provider.js', () => ({
  callModel: async args => { modelCalls.push(args); return modelAnswer },
}))

vi.mock('./_context.js', () => ({
  IDENTITY: 'identity',
  loadBrandContext: async () => ({
    brand: 'BRAND BLOCK',
    ctx: { brandName: 'Ghusn', brandDescriptor: 'a landscape company' },
    profile: { targetPersonas: 'Hotels and resorts\nFacility managers', customFields: { geography: 'Riyadh' } },
  }),
}))

vi.mock('./_lenses.js', () => ({
  backupWeb: () => ({
    tools: [{ name: 'search_web' }, { name: 'read_page' }],
    runTool: async () => ({ ok: true, result: {} }),
    found: new Set(['https://hotels.example/list', 'https://alpha.example/contact']),
  }),
}))

const { findProspects } = await import('./_prospects.js')

const WS = 'ws-1'

function fakeRes() {
  const res = { statusCode: 200, body: null }
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.body = body; return res }
  return res
}

const answer = prospects => ({
  ok: true, cost: 0.31,
  response: { content: [{ type: 'text', text: JSON.stringify({ note: 'Looked at a hotel list.', prospects }) }] },
})

const prospect = over => ({
  name: 'Alpha Hotels', website: 'https://alpha.example', city: 'Riyadh', sites: '3 hotels', fit: 'Gardens.',
  source_url: 'https://hotels.example/list', offer: 'maintenance', pitch: 'Care contract.', proof: '',
  ask_for: 'Facilities', email: 'fm@alpha.example', phone: '+966 11 000 0000', linkedin: '',
  contact_source: 'https://alpha.example/contact', confidence: 0.7, ...over,
})

function base({ method, path }) {
  if (path.startsWith('research_prospect_searches?') && method === 'GET') return []
  if (path === 'research_prospect_searches' && method === 'POST') return [{ id: 'search-1' }]
  if (path.startsWith('sales_icp')) return [{ config: { offers: [{ key: 'maintenance', label: 'Care', kind: 'recurring' }] } }]
  if (path.startsWith('research_prospects?workspace_id')) return [{ name: 'Rejected Resort', name_key: 'rejectedresort', website: '', domain: '' }]
  if (path.startsWith('sales_accounts')) return []
  return []
}

const writes = () => calls.filter(c => c.method === 'POST' && c.path.startsWith('research_prospects?on_conflict'))
const closes = () => calls.filter(c => c.method === 'PATCH' && c.path.startsWith('research_prospect_searches?id=eq.search-1'))

beforeEach(() => {
  calls.length = 0
  modelCalls.length = 0
  route = base
  modelAnswer = answer([])
})

describe('findProspects', () => {
  it('asks for a segment before anything else', async () => {
    const res = fakeRes()
    await findProspects(res, { workspaceId: WS, body: { segment: '  ' }, userId: 'u-1' })
    expect(res.statusCode).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('refuses a second search while one is running, before paying for anything', async () => {
    route = c => (c.path.startsWith('research_prospect_searches?') ? [{ id: 'busy' }] : base(c))
    const res = fakeRes()
    await findProspects(res, { workspaceId: WS, body: { segment: 'hotels' }, userId: 'u-1' })
    expect(res.statusCode).toBe(409)
    expect(modelCalls).toHaveLength(0)
  })

  it('writes only sourced companies we do not have, and closes the search with counts', async () => {
    modelAnswer = answer([
      prospect(),
      prospect({ name: 'Rejected Resort', website: '', source_url: 'https://hotels.example/list' }),
      prospect({ name: 'Ghost Mall', website: 'https://ghost.example', source_url: 'https://ghost.example/about' }),
    ])
    const res = fakeRes()
    await findProspects(res, { workspaceId: WS, body: { segment: 'Hotels', area: 'Riyadh', count: 10 }, userId: 'u-1' })

    expect(res.body).toMatchObject({ ok: true, found: 1, search_id: 'search-1', cost: 0.31 })
    expect(res.body.message).toBe('1 new company found. 1 we already had was left out. 1 without a page we could check was left out.')
    expect(writes().map(w => w.body.name)).toEqual(['Alpha Hotels'])
    expect(writes()[0].body).toMatchObject({ workspace_id: WS, search_id: 'search-1', segment: 'Hotels', status: 'new', email: 'fm@alpha.example' })
    expect(closes()[0].body).toMatchObject({ status: 'complete', found: 3, added: 1, cost_usd: 0.31 })

    const call = modelCalls[0]
    expect(call).toMatchObject({ workspaceId: WS, surface: 'prospects', job: 'search', brand: 'BRAND BLOCK' })
    expect(call.tools.map(t => t.name)).toEqual(['web_search', 'web_fetch', 'search_web', 'read_page'])
    expect(call.messages[0].content).toContain('- Rejected Resort')
    expect(call.deadline).toBeGreaterThan(Date.now())
  })

  it('never proposes one of our clients, even under another name, by the domain they wrote from', async () => {
    route = c => (c.path.startsWith('sales_accounts') ? [{ name: 'Alpha Group Holding', domains: ['alpha.example'] }] : base(c))
    modelAnswer = answer([prospect({ name: 'Alpha Hotels' })])
    const res = fakeRes()
    await findProspects(res, { workspaceId: WS, body: { segment: 'Hotels' }, userId: 'u-1' })
    expect(writes()).toHaveLength(0)
    expect(res.body.message).toMatch(/1 we already had was left out/)
    expect(modelCalls[0].messages[0].content.match(/- Alpha Group Holding/g)).toHaveLength(1)
  })

  it('records a failed call as failed, never as an empty market', async () => {
    modelAnswer = { ok: false, cost: 0.05, error: 'overloaded' }
    const res = fakeRes()
    await findProspects(res, { workspaceId: WS, body: { segment: 'hotels' }, userId: 'u-1' })
    expect(res.body).toMatchObject({ ok: false, error: 'overloaded' })
    expect(closes()[0].body).toMatchObject({ status: 'failed', error: 'overloaded', cost_usd: 0.05 })
    expect(writes()).toHaveLength(0)
  })

  it('says a timed-out search ran out of time', async () => {
    modelAnswer = { ok: false, timedOut: true, cost: 0.2 }
    const res = fakeRes()
    await findProspects(res, { workspaceId: WS, body: { segment: 'hotels' }, userId: 'u-1' })
    expect(res.body.error).toMatch(/ran out of time/)
  })

  it('reports a capped company as capped', async () => {
    modelAnswer = { ok: false, refused: true, error: 'Monthly AI limit reached.', cost: 0 }
    const res = fakeRes()
    await findProspects(res, { workspaceId: WS, body: { segment: 'hotels' }, userId: 'u-1' })
    expect(res.body).toMatchObject({ ok: false, capped: true })
  })
})
