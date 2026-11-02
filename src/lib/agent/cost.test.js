import { describe, it, expect } from 'vitest'
import { MODELS, JOBS, modelFor, priceOf, DEFAULT_MODEL, supportsFallbacks } from './models'
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

  it('routes to the three 5.5 models and no others', () => {
    // The 5.0 price cards stay so older ledger rows still read back; only the
    // 5.5 models are routed to.
    expect(new Set(Object.values(JOBS))).toEqual(new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']))
    expect(Object.keys(MODELS)).toEqual(expect.arrayContaining(['claude-opus-5', 'claude-sonnet-5']))
  })

  it('puts the run outputs a person acts on through Opus', () => {
    expect(modelFor('synthesise')).toBe('claude-opus-5-5')
    expect(modelFor('review')).toBe('claude-opus-5-5')
  })

  it('answers the chat on Sonnet and Haiku, never Opus (owner, 2026-11-02)', () => {
    expect(modelFor('chat')).toBe('claude-sonnet-5-5')
    expect(modelFor('chat_easy')).toBe('claude-haiku-5-5')
    expect(modelFor('chat_route')).toBe('claude-haiku-5-5')
    expect(modelFor('chat_compact')).toBe('claude-haiku-5-5')
    expect(modelFor('ceo_brief')).toBe('claude-sonnet-5-5')
  })

  it('asks for the refusal fallback only where the model has one', () => {
    expect(supportsFallbacks('claude-haiku-5-5')).toBe(false)
    expect(supportsFallbacks('claude-sonnet-5-5')).toBe(true)
    expect(supportsFallbacks('claude-opus-5-5')).toBe(true)
  })

  it('puts the long middle of a run through Sonnet', () => {
    expect(modelFor('search')).toBe('claude-sonnet-5-5')
    expect(modelFor('reflect')).toBe('claude-sonnet-5-5')
  })

  it('prices the 5.5 models as published, cache reads at 5% of input', () => {
    expect(MODELS['claude-opus-5-5']).toMatchObject({ input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 })
    expect(MODELS['claude-sonnet-5-5']).toMatchObject({ input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 })
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

  it('bills Haiku on its short card up to 100k prompt tokens', () => {
    const u = { tokens_in: 1_000, tokens_cache_read: 20_000, tokens_cache_write: 10_000, tokens_out: 1_000 }
    // 1k × 0.10 + 20k × 0.01 + 10k × 0.125 + 1k × 0.50, per million
    expect(costOf('claude-haiku-5-5', u)).toBeCloseTo((100 + 200 + 1_250 + 500) / 1e6, 10)
  })

  it('bills the WHOLE Haiku request on the long card once the prompt passes 100k', () => {
    const u = { tokens_in: 1_000, tokens_cache_read: 90_000, tokens_cache_write: 10_000, tokens_out: 1_000 }
    expect(costOf('claude-haiku-5-5', u)).toBeCloseTo((500 + 4_500 + 6_250 + 2_500) / 1e6, 10)
  })

  it('returns null for a model it has no price for, never zero', () => {
    // Zero would be silently free and would let a cap be bypassed forever.
    expect(costOf('gpt-5.6-sol', normaliseUsage(usage))).toBeNull()
  })

  it('treats missing usage fields as zero rather than NaN', () => {
    // NaN here propagates into cost_usd, into the month's total, and defeats
    // the cap without anything looking wrong.
    const cost = costOf('claude-sonnet-5', normaliseUsage({ output_tokens: 100 }))
    expect(cost).toBeCloseTo(0.001, 6)
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
