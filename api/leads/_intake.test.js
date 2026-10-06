import { describe, it, expect } from 'vitest'
import { intakeWebsite, tryIt, MAX_ROWS_PER_CALL } from './_intake.js'

// Made-up data only: this repo is public.
const WS = '00000000-0000-0000-0000-0000000000aa'
const KEY = '11111111-2222-3333-4444-555555555555'

/** A small stand-in for PostgREST: just the paths the engine uses. */
function fakeDb({ enabled = true, cap = null, spent = 0, leads = [] } = {}) {
  const state = {
    leads: leads.map((l, i) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, ...l })),
    usage: spent ? [{ cost_usd: spent, created_at: new Date().toISOString() }] : [],
    settings: { workspace_id: WS, enabled, intake_key: KEY, last_intake_at: null },
    calls: [],
  }
  let nextId = 100
  const db = async (path, init = {}) => {
    const method = init.method || 'GET'
    state.calls.push(`${method} ${path.split('?')[0]}`)
    if (path.startsWith('lead_agent_settings?intake_key=eq.')) return path.includes(KEY) ? [state.settings] : []
    if (path.startsWith('lead_agent_settings?workspace_id=eq.') && method === 'PATCH') { Object.assign(state.settings, init.body); return [] }
    if (path.startsWith('workspaces?')) return [{ name: 'Test Lighting Co', agent_monthly_cap_usd: cap }]
    if (path.startsWith('brand_profile?')) return [{ product_index: 'Indoor lighting, outdoor lighting, KNX' }]
    if (path.startsWith('agent_usage?')) return state.usage
    if (path === 'agent_usage' && method === 'POST') { state.usage.push({ ...init.body, created_at: new Date().toISOString() }); return [] }
    if (path.startsWith('leads?workspace_id=eq.') && method === 'GET') return state.leads
    if (path.startsWith('leads?on_conflict=') && method === 'POST') {
      const i = state.leads.findIndex((l) => l.source_ref === init.body.source_ref)
      const row = i >= 0 ? Object.assign(state.leads[i], init.body) : { id: `00000000-0000-0000-0000-000000000${nextId++}`, ...init.body }
      if (i < 0) state.leads.push(row)
      return [row]
    }
    throw new Error(`fakeDb: unhandled ${method} ${path}`)
  }
  return { db, state }
}

const answer = (category, reason = 'Because.') => ({
  text: JSON.stringify({ category, confidence: 'high', reason, summary: 's', details: {}, ask_next: [] }),
  usage: { prompt_tokens: 900, completion_tokens: 150, cost: 0.00016 },
})

function deps(db, replies = []) {
  const sent = []
  return {
    sent,
    deps: {
      db,
      now: () => new Date('2026-10-06T09:00:00Z'),
      model: async (body, ws) => { sent.push({ body, ws }); return replies.shift() || answer('quotation_request') },
    },
  }
}

const row = (n, over = {}) => ({
  row: n, received: `2026-10-06 1${n}:00:00`, name: 'Sara Ali', company: 'Example Co', email: `buyer${n}@example.sa`,
  phone: '+966 50 000 0000', projectType: 'Commercial / office', brief: `We need a quote for ${n * 10} downlights.`, lang: 'en', ...over,
})

describe('intakeWebsite', () => {
  it('qualifies new rows, stores them, records spend, and returns the two cells', async () => {
    const { db, state } = fakeDb()
    const { deps: d, sent } = deps(db, [answer('quotation_request', 'Asks for a quote.'), answer('vendor_pitch', 'Sells to us.')])
    const out = await intakeWebsite(d, { key: KEY, rows: [row(1), row(2, { brief: 'We are a factory, see our catalogue.' })] })
    expect(out.results).toEqual([
      { row: 1, cells: ['qualified', 'quotation request: Asks for a quote.'] },
      { row: 2, cells: ['unqualified', 'vendor pitch: Sells to us.'] },
    ])
    expect(state.leads).toHaveLength(2)
    expect(state.leads[0]).toMatchObject({ workspace_id: WS, source: 'website_form', verdict: 'qualified', email: 'buyer1@example.sa', received_at: '2026-10-06T08:00:00.000Z' })
    expect(state.usage).toHaveLength(2)
    expect(state.usage[0]).toMatchObject({ surface: 'lead_qualifier', model: 'openai/gpt-6-luna', cost_usd: 0.00016 })
    expect(state.settings.last_intake_at).toBe('2026-10-06T09:00:00.000Z')
    expect(sent[0].ws).toBe(WS)
    // What left for the model carried no personal details.
    expect(JSON.stringify(sent.map((s) => s.body))).not.toMatch(/Sara|buyer1@|000 0000/)
  })

  it('a row already decided costs nothing and gets the same cells back', async () => {
    const { db } = fakeDb({ leads: [{ source_ref: '2026-10-06 11:00:00|buyer1@example.sa', verdict: 'qualified', category: 'quotation_request', reason: 'Asks for a quote.', received_at: '2026-10-06T08:00:00Z' }] })
    const { deps: d, sent } = deps(db)
    const out = await intakeWebsite(d, { key: KEY, rows: [row(1)] })
    expect(sent).toHaveLength(0)
    expect(out.results[0].cells).toEqual(['qualified', 'quotation request: Asks for a quote.'])
  })

  it('a resend from the same sender is a duplicate, with no model call', async () => {
    const { db, state } = fakeDb()
    const { deps: d, sent } = deps(db)
    const out = await intakeWebsite(d, { key: KEY, rows: [row(1), row(1, { received: '2026-10-06 11:01:00' })] })
    expect(sent).toHaveLength(1)
    expect(out.results[1].cells[0]).toBe('duplicate')
    expect(state.leads[1]).toMatchObject({ verdict: 'duplicate', duplicate_of: state.leads[0].id })
  })

  it('a failed model call stores the error, no verdict, and no cells, so the next pass retries', async () => {
    const { db, state } = fakeDb()
    const { deps: d } = deps(db, [{ error: 'Provider overloaded' }])
    const out = await intakeWebsite(d, { key: KEY, rows: [row(1)] })
    expect(out.results[0]).toEqual({ row: 1, error: 'Provider overloaded' })
    expect(state.leads[0]).toMatchObject({ error: 'Provider overloaded' })
    expect(state.leads[0].verdict).toBeUndefined()
    expect(state.usage[0].error).toBe('Provider overloaded')
    // Next pass: the stored row has no verdict, so it is asked again.
    const again = deps(db)
    const out2 = await intakeWebsite(again.deps, { key: KEY, rows: [row(1)] })
    expect(again.sent).toHaveLength(1)
    expect(out2.results[0].cells[0]).toBe('qualified')
  })

  it('refuses an unknown or malformed key', async () => {
    const { db } = fakeDb()
    expect((await intakeWebsite(deps(db).deps, { key: 'nope', rows: [row(1)] })).status).toBe(401)
    expect((await intakeWebsite(deps(db).deps, { key: '99999999-2222-3333-4444-555555555555', rows: [row(1)] })).status).toBe(401)
  })

  it('switched off: notes the visit, reads nothing, spends nothing', async () => {
    const { db, state } = fakeDb({ enabled: false })
    const { deps: d, sent } = deps(db)
    const out = await intakeWebsite(d, { key: KEY, rows: [row(1)] })
    expect(out).toMatchObject({ off: true, results: [] })
    expect(sent).toHaveLength(0)
    expect(state.settings.last_intake_at).not.toBeNull()
  })

  it('over the monthly cap: marks needs review without calling the model', async () => {
    const { db } = fakeDb({ cap: 15, spent: 15 })
    const { deps: d, sent } = deps(db)
    const out = await intakeWebsite(d, { key: KEY, rows: [row(1)] })
    expect(sent).toHaveLength(0)
    expect(out.results[0].cells[0]).toBe('needs review')
  })

  it(`reads at most ${MAX_ROWS_PER_CALL} rows per call`, async () => {
    const { db } = fakeDb()
    const { deps: d, sent } = deps(db)
    const rows = Array.from({ length: 25 }, (_, i) => row(i + 1, { email: `p${i}@example.sa`, brief: `Different request number ${i} about item ${i * 7}` }))
    const out = await intakeWebsite(d, { key: KEY, rows })
    expect(out.results).toHaveLength(MAX_ROWS_PER_CALL)
    expect(sent).toHaveLength(MAX_ROWS_PER_CALL)
  })
})

describe('tryIt', () => {
  it('checks pasted text, stores no lead, still records the spend', async () => {
    const { db, state } = fakeDb()
    const { deps: d } = deps(db, [answer('job_or_recruitment', 'A CV.')])
    const out = await tryIt(d, { workspaceId: WS, input: { subject: 'Job', message: 'مرفق سيرتي الذاتية' } })
    expect(out.verdict).toMatchObject({ verdict: 'unqualified', category: 'job_or_recruitment' })
    expect(state.leads).toHaveLength(0)
    expect(state.usage[0].surface).toBe('lead_qualifier_test')
  })
  it('asks for text when there is none', async () => {
    const { db } = fakeDb()
    expect((await tryIt(deps(db).deps, { workspaceId: WS, input: { message: '  ' } })).status).toBe(400)
  })
})
