import { describe, it, expect, vi, beforeEach } from 'vitest'

// callModel's tool loop, against a scripted model. No network, no money.
const script = []
const requests = []
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        stream: params => {
          requests.push(structuredClone(params))
          const next = script.shift()
          return { on() {}, finalMessage: async () => next }
        },
      }
    }
  },
}))
vi.mock('./_supabase.js', () => ({
  db: async path => (String(path).startsWith('workspaces') ? [{ agent_monthly_cap_usd: null }] : []),
}))

process.env.ANTHROPIC_API_KEY = 'test'
const { callModel } = await import('./_provider.js')

const usage = { input_tokens: 10, output_tokens: 10 }
const msg = (content, stop_reason) => ({ content, stop_reason, usage })
const args = extra => ({
  workspaceId: 'ws', job: 'search', surface: 'run', identity: 'i', brand: 'b',
  messages: [{ role: 'user', content: 'find things' }], ...extra,
})

beforeEach(() => { script.length = 0; requests.length = 0 })

describe('callModel with our own tools', () => {
  it('runs the tool, sends the result back, and returns only the final answer text', async () => {
    script.push(
      msg([
        { type: 'text', text: 'Searching the backup.' },
        { type: 'tool_use', id: 't1', name: 'search_web', input: { query: 'Armada lighting' } },
      ], 'tool_use'),
      msg([{ type: 'text', text: '{"findings":[]}' }], 'end_turn'),
    )
    const calls = []
    const out = await callModel(args({ runTool: async (name, input) => { calls.push([name, input]); return { ok: true, result: { results: [] } } } }))

    expect(out.ok).toBe(true)
    expect(calls).toEqual([['search_web', { query: 'Armada lighting' }]])
    const second = requests[1].messages
    expect(second.at(-2).role).toBe('assistant')
    expect(second.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: false })
    // The narration before the search must not reach a JSON.parse.
    expect(out.response.content.filter(b => b.type === 'text').map(b => b.text)).toEqual(['{"findings":[]}'])
  })

  it('keeps web_search result blocks from earlier rounds, where the sources come from', async () => {
    const searched = { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://a.example' }] }
    script.push(
      msg([searched, { type: 'tool_use', id: 't1', name: 'search_web', input: { query: 'q' } }], 'tool_use'),
      msg([{ type: 'text', text: '{}' }], 'end_turn'),
    )
    const out = await callModel(args({ runTool: async () => ({ ok: true, result: {} }) }))
    expect(out.response.content).toContainEqual(searched)
  })

  it('tells the tool how many Claude searches the turn has made so far', async () => {
    const searched = { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }
    script.push(
      msg([searched, searched, { type: 'tool_use', id: 't1', name: 'search_web', input: { query: 'q' } }], 'tool_use'),
      msg([{ type: 'text', text: '{}' }], 'end_turn'),
    )
    let seen = null
    await callModel(args({ runTool: async (name, input, ctx) => { seen = ctx; return { ok: true, result: {} } } }))
    expect(seen).toEqual({ serverSearches: 2 })
  })

  it('passes a tool failure back to the model as an error rather than ending the turn', async () => {
    script.push(
      msg([{ type: 'tool_use', id: 't1', name: 'read_page', input: { url: 'https://x' } }], 'tool_use'),
      msg([{ type: 'text', text: '{}' }], 'end_turn'),
    )
    const out = await callModel(args({ runTool: async () => { throw new Error('boom') } }))
    expect(out.ok).toBe(true)
    expect(requests[1].messages.at(-1).content[0]).toMatchObject({ is_error: true, content: 'boom' })
  })

  it('stops a model that will not stop searching, and says it did not finish', async () => {
    for (let i = 0; i < 4; i++) script.push(msg([{ type: 'tool_use', id: `t${i}`, name: 'search_web', input: { query: 'q' } }], 'tool_use'))
    const out = await callModel(args({ runTool: async () => ({ ok: true, result: {} }), maxToolRounds: 2 }))
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/still searching after 2 tool rounds/)
    expect(requests).toHaveLength(3)
  })

  it('leaves a tool_use turn alone when the caller runs its own tools (chat)', async () => {
    script.push(msg([{ type: 'tool_use', id: 't1', name: 'get_posts', input: {} }], 'tool_use'))
    const out = await callModel(args({}))
    expect(out.ok).toBe(true)
    expect(out.response.stop_reason).toBe('tool_use')
    expect(requests).toHaveLength(1)
  })
})
