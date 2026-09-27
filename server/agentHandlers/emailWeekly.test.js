import { describe, it, expect, vi, beforeEach } from 'vitest'

// The handler's IO, stubbed: a tiny routed database, a model that answers
// with a fixed JSON, a brand block, a calendar, and service auth.
const state = vi.hoisted(() => ({ calls: [], rows: {}, modelCalls: [], modelReply: null, auth: { ok: true, as: 'service' } }))

vi.mock('../../api/agent/_supabase.js', () => ({
  isConfigured: true,
  db: async (path, opts = {}) => {
    const method = opts.method || 'GET'
    state.calls.push({ method, path, body: opts.body })
    for (const [needle, reply] of Object.entries(state.rows)) {
      if (method === 'GET' && path.startsWith(needle)) return typeof reply === 'function' ? reply(path) : reply
    }
    if (method === 'POST' && path.startsWith('email_ai_drafts')) return [{ id: 'draft-1', ...opts.body }]
    return method === 'GET' ? [] : null
  },
}))
vi.mock('../../api/agent/_serviceAuth.js', () => ({ authorise: async () => state.auth }))
vi.mock('../../api/agent/_context.js', () => ({
  loadBrandContext: async () => ({ brand: 'BRAND BLOCK', profile: { contactInfo: 'Web: https://arak-sa.com' }, ctx: {} }),
}))
vi.mock('../../api/agent/_calendar.js', () => ({
  gatherCalendar: async () => ({ events: [{ name: 'Founding Day', date: '2027-02-22', days_until: 147, note: '' }] }),
}))
vi.mock('../../api/agent/_provider.js', () => ({
  callModel: async args => {
    state.modelCalls.push(args)
    return state.modelReply
  },
}))

const { default: handler } = await import('./emailWeekly.js')

function run(body) {
  let status = 0
  let json = null
  const res = { status(c) { status = c; return res }, json(b) { json = b; return res } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => ({ status, json }))
}

const WS = '00000000-0000-0000-0000-000000000001'
const good = {
  ok: true, cost: 0.04,
  response: { content: [{ type: 'text', text: JSON.stringify({ note: 'Research is 11 days old.', options: [1, 2, 3].map(n => ({
    angle: `Angle ${n}`, why_now: 'x', audience: 'Customers', subject: `Subject ${n}`, preheader: 'p', body: 'Body',
    cta_label: 'See', cta_url: 'https://arak-sa.com', ar_subject: '', ar_preheader: '', ar_body: '', ar_cta_label: '',
  })) }) }] },
}

beforeEach(() => {
  state.calls = []
  state.modelCalls = []
  state.modelReply = good
  state.auth = { ok: true, as: 'service' }
  state.rows = {
    'email_contacts?': [{ language: 'en', contact_type: 'Customer' }],
    'email_groups?': [{ id: 'g1', name: 'Customers', description: '' }],
    'email_group_members?': [{ group_id: 'g1' }],
    'research_runs?': [{ id: 'r1', finished_at: '2026-09-17T08:00:00Z', headline: 'H', findings: [{ headline: 'F', for_whom: 'marketing' }] }],
  }
})

describe('POST /api/agent/emailWeekly', () => {
  it('writes three options with Sonnet, the brand block and a curated prompt', async () => {
    const { status, json } = await run({ workspace_id: WS })
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: true, options: 3 })
    const call = state.modelCalls[0]
    expect(call.job).toBe('email_weekly')
    expect(call.brand).toBe('BRAND BLOCK')
    expect(call.messages[0].content).toContain('Group "Customers" (1)')
    expect(call.messages[0].content).toContain('Founding Day')
    const ready = state.calls.find(c => c.method === 'PATCH' && c.body?.status === 'ready')
    expect(ready.body.options).toHaveLength(3)
    expect(ready.body.model).toBe('claude-sonnet-5')
    expect(ready.body.note).toBe('Research is 11 days old.')
  })

  it('does not pay twice in one week unless someone asks', async () => {
    state.rows['email_ai_drafts?'] = [{ id: 'd', status: 'ready', started_at: new Date().toISOString() }]
    const { json } = await run({ workspace_id: WS })
    expect(json.skipped).toMatch(/already written/)
    expect(state.modelCalls).toHaveLength(0)
  })

  it('refuses while a run is in progress', async () => {
    state.rows['email_ai_drafts?'] = [{ id: 'd', status: 'running', started_at: new Date().toISOString() }]
    const { status } = await run({ workspace_id: WS })
    expect(status).toBe(409)
    expect(state.modelCalls).toHaveLength(0)
  })

  it('skips a scheduled run for a workspace with no email list', async () => {
    state.rows['email_contacts?'] = []
    const { json } = await run({ workspace_id: WS })
    expect(json.skipped).toMatch(/No marketing contacts/)
    expect(state.modelCalls).toHaveLength(0)
  })

  it('writes anyway when a person presses the button', async () => {
    state.rows['email_contacts?'] = []
    state.auth = { ok: true, as: 'user' }
    const { json } = await run({ workspace_id: WS })
    expect(json.ok).toBe(true)
    expect(state.modelCalls).toHaveLength(1)
    const running = state.calls.find(c => c.method === 'POST' && c.path.startsWith('email_ai_drafts'))
    expect(running.body.trigger).toBe('manual')
  })

  it('records a refusal from the budget cap as failed, not as a crash', async () => {
    state.modelReply = { ok: false, refused: true, error: 'Monthly cap reached' }
    const { status, json } = await run({ workspace_id: WS })
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: false, capped: true })
  })

  it('stores a readable reason when the AI account is out of credit', async () => {
    state.modelReply = { ok: false, error: '400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}' }
    const { json } = await run({ workspace_id: WS })
    expect(json.error).toMatch(/run out of credit/)
    const failed = state.calls.find(c => c.method === 'PATCH' && c.body?.status === 'failed')
    expect(failed.body.error).toMatch(/run out of credit/)
    expect(state.calls.find(c => c.method === 'PATCH' && c.body?.status === 'failed')).toBeTruthy()
  })

  it('rejects a caller who may not use the workspace', async () => {
    state.auth = { ok: false, status: 403, error: 'no' }
    const { status } = await run({ workspace_id: WS })
    expect(status).toBe(403)
  })
})
