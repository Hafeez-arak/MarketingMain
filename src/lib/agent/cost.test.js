import { describe, it, expect } from 'vitest'
import { MODELS, JOBS, modelFor, priceOf, DEFAULT_MODEL } from './models'
import { normaliseUsage, costOf, usageRow, cacheHitRate } from './cost'

// A real Anthropic usage block: cached tokens are reported SEPARATELY from
// input_tokens, not folded into them. Every test below leans on that, because
// getting it backwards is the one arithmetic mistake here that would make
// caching look like a cost instead of a saving.
const usage = {
  input_tokens: 1_000,
  cache_read_input_tokens: 20_000,
  cache_creation_input_tokens: 0,
  output_tokens: 500,
}

describe('the model registry is the only place a model is named', () => {
  it('maps every job to a model it actually prices', () => {
    for (const [job, model] of Object.entries(JOBS)) {
      expect(priceOf(model), `${job} → ${model}`).toBeTruthy()
    }
  })

  it('uses two models and no more — Haiku was ruled out deliberately', () => {
    expect(Object.keys(MODELS).sort()).toEqual(['claude-opus-5', 'claude-sonnet-5'])
    expect(new Set(Object.values(JOBS)).size).toBe(2)
  })

  it('puts the calls a person acts on through Opus', () => {
    expect(modelFor('synthesise')).toBe('claude-opus-5')
    expect(modelFor('chat')).toBe('claude-opus-5')
    expect(modelFor('review')).toBe('claude-opus-5')
  })

  it('puts the long middle of a run through Sonnet', () => {
    expect(modelFor('search')).toBe('claude-sonnet-5')
    expect(modelFor('reflect')).toBe('claude-sonnet-5')
  })

  it('falls back rather than throwing on an unregistered job', () => {
    // A forgotten job should run cheap, not take the agent down. It is still
    // a bug, and the ledger is where it shows up.
    expect(modelFor('something-nobody-registered')).toBe(DEFAULT_MODEL)
  })
})

describe('cost', () => {
  it('prices cached reads separately from fresh input', () => {
    // Opus 5: 1k fresh @ $5/M + 20k cached @ $0.50/M + 500 out @ $25/M
    //       = 0.005 + 0.010 + 0.0125
    const cost = costOf('claude-opus-5', normaliseUsage(usage))
    expect(cost).toBeCloseTo(0.0275, 6)
  })

  it('makes the cached call dramatically cheaper than the uncached one', () => {
    // The same 21k of prefix, one call warm and one cold. If this ratio ever
    // stops holding, the caching design in AGENT.md §7 has been undone.
    const warm = costOf('claude-opus-5', normaliseUsage(usage))
    const cold = costOf('claude-opus-5', normaliseUsage({
      input_tokens: 21_000, output_tokens: 500,
    }))
    expect(cold / warm).toBeGreaterThan(4)
  })

  it('returns null for a model it has no price for, never zero', () => {
    // Zero would be silently free and would let a cap be bypassed forever.
    expect(costOf('gpt-5.6-sol', normaliseUsage(usage))).toBeNull()
  })

  it('treats missing usage fields as zero rather than NaN', () => {
    // NaN here propagates into cost_usd, into the month's total, and defeats
    // the cap without anything looking wrong.
    const cost = costOf('claude-sonnet-5', normaliseUsage({ output_tokens: 100 }))
    expect(cost).toBeCloseTo(0.0015, 6)
    expect(Number.isNaN(cost)).toBe(false)
  })

  it('ignores negative counts instead of crediting them', () => {
    const u = normaliseUsage({ input_tokens: -5_000, output_tokens: 100 })
    expect(u.tokens_in).toBe(0)
  })
})

describe('usageRow — what lands in the ledger', () => {
  it('carries the workspace, the surface and the split token counts', () => {
    const row = usageRow({
      workspaceId: 'ws-1', surface: 'run', stage: 'synthesise',
      runId: 'run-1', model: 'claude-opus-5', usage,
    })
    expect(row.workspace_id).toBe('ws-1')
    expect(row.surface).toBe('run')
    expect(row.stage).toBe('synthesise')
    expect(row.run_id).toBe('run-1')
    expect(row.tokens_cache_read).toBe(20_000)
    expect(row.cost_usd).toBeCloseTo(0.0275, 6)
  })

  it('still records a failed call that burned tokens', () => {
    // A ledger that only counts successes disagrees with the invoice in
    // exactly the week something is going wrong.
    const row = usageRow({
      workspaceId: 'ws-1', surface: 'chat', model: 'claude-opus-5',
      usage, error: 'overloaded_error',
    })
    expect(row.error).toBe('overloaded_error')
    expect(row.cost_usd).toBeGreaterThan(0)
  })

  it('writes 0 for an unpriced model but keeps the token counts', () => {
    const row = usageRow({ workspaceId: 'ws-1', surface: 'chat', model: 'mystery', usage })
    expect(row.cost_usd).toBe(0)
    expect(row.tokens_out).toBe(500)
    expect(row.model).toBe('mystery')   // findable later
  })
})

describe('cacheHitRate — the assertion that caching is still working', () => {
  it('is high when the prefix is being reused', () => {
    expect(cacheHitRate(usage)).toBeGreaterThan(0.9)
  })

  it('is zero on a cold call, which is what a broken prefix looks like', () => {
    expect(cacheHitRate({ input_tokens: 21_000, output_tokens: 500 })).toBe(0)
  })

  it('does not divide by zero on an empty call', () => {
    expect(cacheHitRate({})).toBe(0)
  })
})
