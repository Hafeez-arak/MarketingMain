import { describe, it, expect } from 'vitest'
import {
  BUDGETS, loopBudget, loopCheck, toolUsesIn, textIn,
  toolResultBlock, urlsFrom, checkCitations,
} from './loop'

describe('the loop is bounded — the only real runaway risk', () => {
  it('an unknown surface gets the tightest budget, not the loosest', () => {
    // Failing toward cheap matters here: a surface someone forgot to register
    // should cost less than intended, never more. The opposite default is how
    // a new page quietly bills like a research run.
    const unknown = loopBudget('something_new')
    expect(unknown).toEqual(BUDGETS.chat)
    for (const b of Object.values(BUDGETS)) {
      expect(unknown.maxTurns).toBeLessThanOrEqual(Math.max(b.maxTurns, unknown.maxTurns))
    }
  })

  it('every budget has a finite turn and tool cap', () => {
    for (const [name, b] of Object.entries(BUDGETS)) {
      expect(b.maxTurns, name).toBeGreaterThan(0)
      expect(Number.isFinite(b.maxTurns), name).toBe(true)
      expect(Number.isFinite(b.maxToolCalls), name).toBe(true)
    }
  })

  it('chat is tighter than the research search loop', () => {
    // Someone is waiting on a chat answer; nobody is watching a run.
    expect(BUDGETS.chat.maxToolCalls).toBeLessThan(BUDGETS.search.maxToolCalls)
  })

  it('stops on turns and explains why', () => {
    const stop = loopCheck({ turns: 6, toolCalls: 0 }, BUDGETS.chat)
    expect(stop.allowed).toBe(false)
    // The reason is not decoration — it is sent to the model so it answers
    // with what it has rather than being cut off mid-thought.
    expect(stop.reason).toMatch(/answer now/i)
  })

  it('stops on tool calls independently of turns', () => {
    // The two limits bound different things: turns bound the bill, tool calls
    // bound the wait. One model turn asking for ten tools hits the second
    // without touching the first.
    const stop = loopCheck({ turns: 1, toolCalls: 10 }, BUDGETS.chat)
    expect(stop.allowed).toBe(false)
    expect(stop.reason).toMatch(/tool calls/i)
  })

  it('allows a turn when under both', () => {
    expect(loopCheck({ turns: 1, toolCalls: 2 }, BUDGETS.chat).allowed).toBe(true)
  })
})

describe('reading a model response', () => {
  const response = {
    content: [
      { type: 'text', text: 'Let me check. ' },
      { type: 'tool_use', id: 'tu_1', name: 'get_posts', input: { id: 'abc' } },
      { type: 'thinking', thinking: 'ignored' },
    ],
  }

  it('picks out tool_use blocks and nothing else', () => {
    // A new block type appearing must not be read as a tool call.
    expect(toolUsesIn(response)).toEqual([
      { id: 'tu_1', name: 'get_posts', input: { id: 'abc' } },
    ])
  })

  it('joins the text blocks', () => {
    expect(textIn(response)).toBe('Let me check.')
  })

  it('survives a malformed response without throwing', () => {
    expect(toolUsesIn(null)).toEqual([])
    expect(textIn(undefined)).toBe('')
    expect(toolUsesIn({ content: 'not an array' })).toEqual([])
  })
})

describe('a failed tool is an answer, not an exception', () => {
  it('comes back as an is_error tool_result the model can recover from', () => {
    // The person is still owed an answer. A model told "no such tool" can ask
    // differently; a thrown exception ends the turn and bills for everything
    // up to it.
    const block = toolResultBlock('tu_1', { ok: false, error: 'There is no tool called "x".' })
    expect(block).toMatchObject({
      type: 'tool_result', tool_use_id: 'tu_1', is_error: true,
    })
    expect(block.content).toMatch(/no tool called/)
  })

  it('serialises a successful result', () => {
    const block = toolResultBlock('tu_2', { ok: true, result: { posts: [] } })
    expect(block.is_error).toBe(false)
    expect(JSON.parse(block.content)).toEqual({ posts: [] })
  })
})

describe('citations are checked, not trusted', () => {
  it('collects every url a tool actually returned, however nested', () => {
    const found = urlsFrom({
      posts: [{ platform_post_url: 'https://instagram.com/p/1' }],
      meta: { deep: { list: ['https://example.com/a', 'not-a-url'] } },
    })
    expect([...found].sort()).toEqual([
      'https://example.com/a', 'https://instagram.com/p/1',
    ])
  })

  it('drops a source no tool ever produced', () => {
    // The failure this exists for: a plausible-looking URL a model invented is
    // worse than no citation, because it survives a skim.
    const allowed = new Set(['https://real.example/a'])
    const out = checkCitations(
      [{ url: 'https://real.example/a' }, { url: 'https://invented.example/b' }],
      allowed,
    )
    expect(out.sources).toHaveLength(1)
    expect(out.uncited).toBe(false)
  })

  it('flags a claim that loses every source as uncited rather than deleting it', () => {
    // Deliberate asymmetry: a finding may still be true and a person can judge
    // it. The strictness belongs on the write side, where a proposed rule that
    // loses its sources is dropped silently because a rule steers every future
    // caption this brand generates.
    const out = checkCitations([{ url: 'https://invented.example/b' }], new Set())
    expect(out.sources).toEqual([])
    expect(out.uncited).toBe(true)
  })

  it('a claim with no sources at all is not flagged as uncited', () => {
    // Nothing was lost, so there is nothing to warn about. Conflating "cited
    // nothing" with "cited something fake" would put a warning on every
    // ordinary sentence.
    expect(checkCitations([], new Set()).uncited).toBe(false)
  })
})
