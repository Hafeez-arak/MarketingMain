import { describe, it, expect } from 'vitest'
import { effectiveVerdict, monthStats, sheetHealth, modelName, verdictFilter, pageRange, pageLabel, pageCount } from './view.js'

const now = new Date('2026-10-20T10:00:00Z')
const lead = (o) => ({ received_at: '2026-10-05T10:00:00Z', created_at: '2026-10-06T10:00:00Z', cost_usd: 0.0002, ...o })

describe('effectiveVerdict', () => {
  it('a person\'s correction wins; no verdict yet reads as pending', () => {
    expect(effectiveVerdict(lead({ verdict: 'unqualified', human_verdict: 'qualified' }))).toBe('qualified')
    expect(effectiveVerdict(lead({ verdict: 'qualified' }))).toBe('qualified')
    expect(effectiveVerdict(lead({ verdict: null, error: 'x' }))).toBe('pending')
  })
})

describe('monthStats', () => {
  it('counts by arrival month, spend by when it was spent, and corrections', () => {
    const s = monthStats([
      lead({ verdict: 'qualified' }),
      lead({ verdict: 'unqualified', human_verdict: 'qualified' }),
      lead({ verdict: 'needs_review', human_verdict: 'needs_review' }),
      lead({ verdict: 'duplicate' }),
      // A backfilled August enquiry: not this month's count, but this month's spend.
      lead({ verdict: 'qualified', received_at: '2026-08-27T17:00:00Z' }),
    ], now)
    expect(s).toMatchObject({ total: 4, qualified: 2, needs_review: 1, duplicate: 1, reviewed: 2, corrected: 1 })
    expect(s.spend).toBeCloseTo(0.001, 6)
  })
})

describe('sheetHealth', () => {
  it('never, fresh and stale', () => {
    expect(sheetHealth(null, now).state).toBe('never')
    expect(sheetHealth('2026-10-20T09:56:00Z', now)).toEqual({ state: 'ok', label: 'Checked 4 min ago' })
    expect(sheetHealth('2026-10-20T07:00:00Z', now)).toEqual({ state: 'stale', label: 'Last checked 3 h ago' })
  })
})

describe('modelName', () => {
  it('names the model plainly', () => {
    expect(modelName('openai/gpt-6-luna')).toBe('GPT-6 Luna')
    expect(modelName('z-ai/glm-5.3-flash')).toBe('glm-5.3-flash')
  })
})

describe('paging', () => {
  it('turns a tab into a filter on the effective verdict', () => {
    expect(verdictFilter('all')).toBeNull()
    expect(verdictFilter('qualified')).toBe('human_verdict.eq.qualified,and(human_verdict.is.null,verdict.eq.qualified)')
    expect(verdictFilter('pending')).toBe('and(human_verdict.is.null,verdict.is.null)')
  })

  it('ranges, labels and counts pages', () => {
    expect(pageRange(0, 25)).toEqual({ from: 0, to: 24 })
    expect(pageRange(2, 25)).toEqual({ from: 50, to: 74 })
    expect(pageLabel(0, 25, 542)).toBe('1–25 of 542')
    expect(pageLabel(21, 25, 542)).toBe('526–542 of 542')
    expect(pageLabel(0, 25, 0)).toBe('0 of 0')
    expect(pageCount(542, 25)).toBe(22)
    expect(pageCount(0, 25)).toBe(1)
  })
})
