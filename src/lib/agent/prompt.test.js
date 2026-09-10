import { describe, it, expect } from 'vitest'
import { buildRequest, volatileFragment, contextPreamble } from './prompt'

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
