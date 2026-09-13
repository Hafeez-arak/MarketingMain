import { describe, it, expect } from 'vitest'
import { runTotals } from './cost.js'

// The real ledger rows from run 47970e9e, which reported 0 tokens against a
// $1.11 bill because nothing ever rolled them up.
const REAL = [
  { stage: 'openings', model: 'claude-sonnet-5', cost_usd: 0.3741, tokens_in: 1338, tokens_out: 1893 },
  { stage: 'category', model: 'claude-sonnet-5', cost_usd: 0.3680, tokens_in: 1276, tokens_out: 3454 },
  { stage: 'demand', model: 'claude-sonnet-5', cost_usd: 0.1875, tokens_in: 1343, tokens_out: 3707 },
  { stage: 'synthesise', model: 'claude-opus-5', cost_usd: 0.1831, tokens_in: 6786, tokens_out: 4509 },
]

describe('runTotals', () => {
  it('adds up what the run actually spent', () => {
    const t = runTotals(REAL)
    expect(t.calls).toBe(4)
    expect(t.cost_usd).toBeCloseTo(1.1127, 4)
    expect(t.tokens_out).toBe(13563)
  })

  it('counts cache reads and writes as input, because they are billed', () => {
    const t = runTotals([{ model: 'm', tokens_in: 100, tokens_cache_read: 50, tokens_cache_write: 25, tokens_out: 10 }])
    expect(t.tokens_in).toBe(175)
  })

  it('names the most expensive model the run used, not the last', () => {
    // A run is Sonnet for its lenses and Opus for synthesis. Reporting Sonnet
    // would make the cost look inexplicable to whoever reads the row later.
    expect(runTotals(REAL).model).toBe('claude-opus-5')
  })

  it('does not let an unknown model outrank a known one', () => {
    const t = runTotals([
      { model: 'typo-model-9', cost_usd: 1 },
      { model: 'claude-sonnet-5', cost_usd: 1 },
    ])
    expect(t.model).toBe('claude-sonnet-5')
  })

  it('still names an unknown model when it is all there is', () => {
    expect(runTotals([{ model: 'some-new-model', cost_usd: 1 }]).model).toBe('some-new-model')
  })

  it('treats a missing number as zero rather than NaN', () => {
    const t = runTotals([{ model: 'm' }, { model: 'm', tokens_out: null, cost_usd: undefined }])
    expect(t.tokens_in).toBe(0)
    expect(t.tokens_out).toBe(0)
    expect(t.cost_usd).toBe(0)
  })

  it('survives an empty or absent ledger', () => {
    expect(runTotals([]).calls).toBe(0)
    expect(runTotals().model).toBe('')
    expect(() => runTotals(null)).not.toThrow()
  })

  it('does not invent a search count', () => {
    // The provider reports searches in usage.server_tool_use and agent_usage
    // has nowhere to keep them. A plausible number derived from source URLs
    // would be worse than an absent one.
    expect(runTotals(REAL).searches).toBeUndefined()
  })
})
