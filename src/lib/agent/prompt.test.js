import { describe, it, expect } from 'vitest'
import { buildRequest, volatileFragment, contextPreamble, withConversationCache } from './prompt'

const tools = [
  { name: 'web_search', description: 's' },
  { name: 'get_brand_context', description: 'b' },
  { name: 'get_posts', description: 'p' },
]

describe('buildRequest — the cached prefix', () => {
  const base = { model: 'claude-opus-5', identity: 'You are…', brand: 'Arak Lighting…', tools }

  it('puts the breakpoint on the LAST stable block, not the first', () => {
    // Marking the first block would cache the identity and re-bill the brand
    // context on every single call — the expensive half.
    const req = buildRequest({ ...base, messages: [] })
    expect(req.system[0].cache_control).toBeUndefined()
    expect(req.system[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('sorts tools so reordering the belt cannot invalidate the cache', () => {
    // Tools render before system, so their order is part of the cache key. A
    // refactor that merely moves a tool definition must not cost a cache miss
    // on every workspace in production.
    const a = buildRequest({ ...base, tools, messages: [] })
    const b = buildRequest({ ...base, tools: [...tools].reverse(), messages: [] })
    expect(a.tools.map(t => t.name)).toEqual(b.tools.map(t => t.name))
    expect(a.tools.map(t => t.name)).toEqual(['get_brand_context', 'get_posts', 'web_search'])
  })

  it('produces a byte-identical prefix across calls that differ only in the question', () => {
    // This is the property the whole caching design rests on.
    const one = buildRequest({ ...base, messages: [{ role: 'user', content: 'why is X down?' }] })
    const two = buildRequest({ ...base, messages: [{ role: 'user', content: 'what should we post?' }] })
    expect(JSON.stringify([one.tools, one.system])).toBe(JSON.stringify([two.tools, two.system]))
  })

  it('asks for adaptive thinking, never a token budget', () => {
    // budget_tokens is rejected outright by the models this app uses.
    const req = buildRequest({ ...base, messages: [] })
    expect(req.thinking).toEqual({ type: 'adaptive' })
    expect(req.thinking.budget_tokens).toBeUndefined()
    expect(req.output_config.effort).toBe('high')
  })
})

describe('volatileFragment — what must never enter the stable prefix', () => {
  it('catches a timestamp', () => {
    expect(volatileFragment('Today is 2026-09-09T14:03:22Z. You are…')).toContain('2026-09-09T14:03')
  })

  it('catches a run or request id', () => {
    expect(volatileFragment('run 3f9a1c22-7b0e-… in progress')).toBeTruthy()
  })

  it('allows a plain date, which is stable for a whole day', () => {
    // Stable enough for a weekly run and a chat session, and worth the
    // freshness — the agent should know what day it is.
    expect(volatileFragment('Today is 2026-09-09.')).toBeNull()
  })

  it('passes a real identity prompt', () => {
    expect(volatileFragment('You are the assistant for this brand. You never publish.')).toBeNull()
  })
})

describe('contextPreamble — the volatile tail', () => {
  it('describes a saved entity by pointer, not by content', () => {
    const text = contextPreamble({ route: '/social/instagram', entity: 'post', id: 'abc123' })
    expect(text).toContain('/social/instagram')
    expect(text).toContain('post abc123')
  })

  it('carries an unsaved draft, because it has no id to fetch by', () => {
    const text = contextPreamble({
      route: '/studio',
      draft: { platform: 'instagram', format: 'carousel', caption: 'مرحبا', media: [1, 2, 3] },
    })
    expect(text).toContain('carousel')
    expect(text).toContain('"media_count": 3')
  })

  it('is empty when the page says nothing', () => {
    expect(contextPreamble(null)).toBe('')
  })
})

describe('empty system blocks', () => {
  const args = { model: 'claude-sonnet-5', identity: 'I am the agent.', messages: [{ role: 'user', content: 'hi' }] }

  it('drops an empty brand block rather than sending it — the compact_memory 400', () => {
    // 3 of 3 compact_memory calls died on "cache_control cannot be set for
    // empty text blocks" (2026-09-14, 09-15) because this job passes brand ''.
    const req = buildRequest({ ...args, brand: '' })
    expect(req.system).toHaveLength(1)
    expect(req.system[0].text).toBe('I am the agent.')
    expect(req.system.every(b => b.text.trim())).toBe(true)
  })

  it('still caches when only one block survives', () => {
    const req = buildRequest({ ...args, brand: '   ' })
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('keeps the breakpoint on the LAST block when both survive', () => {
    const req = buildRequest({ ...args, brand: 'Arak sells lighting.' })
    expect(req.system).toHaveLength(2)
    expect(req.system[0].cache_control).toBeUndefined()
    expect(req.system[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('never sets cache_control on a block it did not keep', () => {
    for (const brand of ['', '  ', '\n', undefined, null]) {
      const req = buildRequest({ ...args, brand })
      expect(req.system.some(b => !String(b.text || '').trim())).toBe(false)
    }
  })
})

describe('withConversationCache — the half of the bill that was not cached', () => {
  const breakpointsIn = messages => messages
    .map((m, i) => (Array.isArray(m.content) && m.content.some(b => b?.cache_control) ? i : -1))
    .filter(i => i >= 0)

  // One pass of the tool loop: an assistant turn and the tool results it asked
  // for. This is the shape that was being re-billed in full every turn.
  const turn = (id, result) => ([
    { role: 'assistant', content: [
      { type: 'thinking', thinking: 'hm', signature: 'sig' },
      { type: 'tool_use', id, name: 'search_web', input: { query: 'q' } },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: id, is_error: false, content: result },
    ] },
  ])

  it('leaves a one-shot call alone — a write nobody reads costs 1.25x', () => {
    // Every lens, synthesis, resolve and compact_memory call is a single user
    // message that is never followed up. Caching it is a pure loss.
    const one = [{ role: 'user', content: 'a very long lens prompt' }]
    expect(withConversationCache(one)).toBe(one)
    expect(breakpointsIn(withConversationCache(one))).toEqual([])
  })

  it('marks the end of the conversation, so the next turn can read it back', () => {
    const convo = [{ role: 'user', content: 'why is X down?' }, ...turn('t1', '{"big":"payload"}')]
    expect(breakpointsIn(withConversationCache(convo))).toContain(convo.length - 1)
  })

  it('marks where the PREVIOUS request ended, which is where the hit comes from', () => {
    // Turn 2 of the loop sent [u1, a1, ur1] and wrote a breakpoint at index 2.
    // Turn 3 must mark index 2 again to hit it — that is the whole mechanism.
    const turnTwo = [{ role: 'user', content: 'u1' }, ...turn('t1', 'r1')]
    const turnThree = [...turnTwo, ...turn('t2', 'r2')]
    const endOfTurnTwo = turnTwo.length - 1

    expect(breakpointsIn(withConversationCache(turnThree))).toEqual([endOfTurnTwo, turnThree.length - 1])
  })

  it('never marks an assistant turn, whose thinking blocks are replayed verbatim', () => {
    // The out-of-budget call appends a third message, which puts an assistant
    // turn in the n-3 slot. It must be stepped over, not marked.
    const convo = [
      { role: 'user', content: 'u1' },
      ...turn('t1', 'r1'),
      ...turn('t2', 'r2'),
      { role: 'user', content: 'You are out of tool calls. Answer with what you have.' },
    ]
    const out = withConversationCache(convo)
    expect(out.filter(m => m.role === 'assistant').some(m => m.content.some(b => b.cache_control))).toBe(false)
    expect(breakpointsIn(out).every(i => out[i].role === 'user')).toBe(true)
  })

  it('never marks a thinking block', () => {
    const convo = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'r' },
        { type: 'thinking', thinking: 'later', signature: 'sig' },
      ] },
    ]
    const marked = withConversationCache(convo)[2].content
    expect(marked.find(b => b.cache_control).type).toBe('tool_result')
    expect(marked.find(b => b.type === 'thinking').cache_control).toBeUndefined()
  })

  it('never marks an empty text block — the 400 that killed compact_memory', () => {
    const convo = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: [{ type: 'text', text: '   ' }] },
    ]
    const out = withConversationCache(convo)
    expect(out[2].content[0].cache_control).toBeUndefined()
    expect(out.every(m => !Array.isArray(m.content)
      || m.content.every(b => b.type !== 'text' || String(b.text).trim() || !b.cache_control))).toBe(true)
  })

  it('stays under the four-breakpoint limit however long the loop runs', () => {
    // One for the system prompt leaves three; this must never use more than two.
    for (let turns = 1; turns <= 12; turns += 1) {
      const convo = [{ role: 'user', content: 'u1' }]
      for (let i = 0; i < turns; i += 1) convo.push(...turn(`t${i}`, `r${i}`))
      const req = buildRequest({ model: 'claude-opus-5', identity: 'I', brand: 'B', tools, messages: convo })
      const total = req.system.filter(b => b.cache_control).length
        + req.messages.reduce((n, m) => n + (Array.isArray(m.content)
          ? m.content.filter(b => b?.cache_control).length : 0), 0)
      expect(total).toBeLessThanOrEqual(4)
      expect(total).toBe(3)
    }
  })

  it('does not mutate the caller — the tool loop appends to one array forever', () => {
    // A breakpoint written in place would accumulate one per turn until the
    // request crossed the limit and started failing outright.
    const convo = [{ role: 'user', content: 'u1' }, ...turn('t1', 'r1')]
    const before = JSON.stringify(convo)
    withConversationCache(convo)
    withConversationCache(convo)
    expect(JSON.stringify(convo)).toBe(before)
  })

  it('drops breakpoints it did not place, so they cannot accumulate', () => {
    const convo = [
      { role: 'user', content: [{ type: 'text', text: 'u1', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: [{ type: 'text', text: 'u2', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: [{ type: 'text', text: 'u3', cache_control: { type: 'ephemeral' } }] },
    ]
    expect(breakpointsIn(withConversationCache(convo))).toEqual([2, 4])
  })

  it('renders a string turn as a text block so it has somewhere to hang', () => {
    const convo = [
      { role: 'user', content: 'why is X down?' },
      { role: 'assistant', content: 'because Y' },
      { role: 'user', content: 'and Z?' },
    ]
    const out = withConversationCache(convo)
    expect(out[2].content).toEqual([
      { type: 'text', text: 'and Z?', cache_control: { type: 'ephemeral' } },
    ])
    expect(out[0].content).toEqual([
      { type: 'text', text: 'why is X down?', cache_control: { type: 'ephemeral' } },
    ])
    // Untouched turns keep the shape they arrived in.
    expect(out[1].content).toBe('because Y')
  })
})
