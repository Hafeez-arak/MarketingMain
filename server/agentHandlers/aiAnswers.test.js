import { describe, it, expect, vi, beforeEach } from 'vitest'

// The handler's IO, stubbed: a routed database, a model that answers with a
// fixed text and citations, and a caller who is a member. Nothing is paid for.
const state = vi.hoisted(() => ({
  calls: [], rows: {}, modelCalls: [], reply: null, member: true, failInsert: false,
}))

vi.mock('../../api/agent/_supabase.js', () => ({
  isConfigured: true,
  callerId: async () => 'user-1',
  callerMayUseWorkspace: async () => state.member,
  db: async (path, opts = {}) => {
    const method = opts.method || 'GET'
    state.calls.push({ method, path, body: opts.body })
    if (method === 'POST' && path.startsWith('ai_answer_checks')) {
      if (state.failInsert) throw new Error('relation "public.ai_answer_checks" does not exist')
      return null
    }
    for (const [needle, reply] of Object.entries(state.rows)) {
      if (method === 'GET' && path.startsWith(needle)) return reply
    }
    return []
  },
}))
vi.mock('../../api/agent/_provider.js', () => ({
  callModel: async args => {
    state.modelCalls.push(args)
    return typeof state.reply === 'function' ? state.reply(args) : state.reply
  },
}))

const { default: handler } = await import('./aiAnswers.js')

function run(body) {
  let status = 0
  let json = null
  const res = { status(c) { status = c; return res }, json(b) { json = b; return res } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => ({ status, json }))
}

const WS = '00000000-0000-0000-0000-000000000001'
const answer = {
  ok: true, cost: 0.06,
  response: {
    content: [
      { type: 'web_search_tool_result', content: [{ url: 'https://icsarabia.com/x' }] },
      { type: 'text', text: 'Consider ICS Arabia and ARAK Lighting in Riyadh.', citations: [{ url: 'https://www.arak-sa.com/services/lighting-design' }] },
    ],
  },
}

beforeEach(() => {
  state.calls = []
  state.modelCalls = []
  state.reply = answer
  state.member = true
  state.failInsert = false
  state.rows = {
    'brand_profile?': [{ custom_fields: {
      website: 'arak-sa.com', brand_terms: ['arak'],
      ai_questions: 'Who designs lighting in Riyadh?\nWho installs KNX in Saudi Arabia?',
    } }],
    'research_agenda?': [{ subject: 'ICS Arabia' }, { subject: 'Signify' }],
  }
})

describe('aiAnswers handler', () => {
  it('asks every configured question, scores it, and stores one row per question under one run', async () => {
    const { status, json } = await run({ workspace_id: WS })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(state.modelCalls).toHaveLength(2)
    expect(json.rows[0]).toMatchObject({ named: true, rank: 2, cited: true, competitors: ['ICS Arabia'] })
    const insert = state.calls.find(c => c.method === 'POST')
    expect(insert.body).toHaveLength(2)
    expect(new Set(insert.body.map(r => r.run_id)).size).toBe(1)
    expect(json.summary).toMatchObject({ asked: 2, named: 2, cited: 2 })
  })

  // The measure is void if the question names the company.
  it('never puts the company name in what the model is asked', async () => {
    await run({ workspace_id: WS })
    for (const call of state.modelCalls) {
      expect(JSON.stringify(call.messages).toLowerCase()).not.toContain('arak')
      expect(call.job).toBe('ai_check')
      expect(call.tools[0]).toMatchObject({ name: 'web_search', max_uses: 3 })
    }
  })

  it('says so, and spends nothing, when no questions are set', async () => {
    state.rows['brand_profile?'] = [{ custom_fields: { website: 'arak-sa.com' } }]
    const { json } = await run({ workspace_id: WS })
    expect(json).toMatchObject({ ok: false, configured: false })
    expect(state.modelCalls).toHaveLength(0)
  })

  it('refuses a caller who is not a member of the workspace', async () => {
    state.member = false
    const { status } = await run({ workspace_id: WS })
    expect(status).toBe(403)
    expect(state.modelCalls).toHaveLength(0)
  })

  // Once the cap refuses, the rest would only write refusals.
  it('stops asking after the monthly cap refuses, and keeps what it already has', async () => {
    let n = 0
    state.reply = () => (n++ === 0
      ? { ok: false, refused: true, budget: { allowed: false }, error: 'Cap reached.' }
      : answer)
    state.rows['brand_profile?'][0].custom_fields.ai_questions = 'a\nb\nc\nd\ne\nf'
    const { json } = await run({ workspace_id: WS })
    expect(json.capped).toBe(true)
    expect(json.rows.filter(r => r.error).length).toBeGreaterThan(0)
  })

  // Paid for, so shown even when the table is missing.
  it('returns the answers even when they cannot be stored', async () => {
    state.failInsert = true
    const { json } = await run({ workspace_id: WS })
    expect(json).toMatchObject({ ok: true, stored: false })
    expect(json.rows).toHaveLength(2)
  })
})
