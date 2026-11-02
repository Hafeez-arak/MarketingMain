import { describe, it, expect } from 'vitest'
import {
  modelHistory, planFold, summaryBlock, foldInput, cleanSummary,
  KEEP_MESSAGES, FOLD_AT_MESSAGES, SUMMARY_MAX_CHARS,
} from './threadSummary'

const thread = (n, size = 20) => Array.from({ length: n }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `${i % 2 === 0 ? 'Q' : 'A'}${i} ${'x'.repeat(size)}`,
  created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
}))

describe('modelHistory — what the model is sent', () => {
  it('sends a short thread unchanged', () => {
    const rows = thread(4)
    expect(modelHistory({ rows })).toEqual(rows.map(({ role, content }) => ({ role, content })))
  })

  it('puts the summary first, then the messages after it, verbatim', () => {
    const rows = thread(4)
    const out = modelHistory({ rows, summary: 'They want both languages.' })
    expect(out[0]).toEqual({ role: 'user', content: summaryBlock('They want both languages.') })
    expect(out.slice(1).map(m => m.content)).toEqual(rows.map(m => m.content))
  })

  it('keeps the summary block byte-identical across turns, so the cache holds', () => {
    const a = modelHistory({ rows: thread(2), summary: 'S' })[0].content
    const b = modelHistory({ rows: thread(6), summary: 'S' })[0].content
    expect(a).toBe(b)
  })

  it('trims the oldest exchanges past the ceiling and still starts with the person', () => {
    const out = modelHistory({ rows: thread(10, 3_500), ceiling: 4_000 })
    expect(out[0].role).toBe('user')
    expect(out.length).toBeLessThan(10)
    expect(out[out.length - 1].content).toMatch(/^A9/)
  })
})

describe('planFold — when and where a thread is folded', () => {
  it('leaves a short thread alone', () => {
    expect(planFold(thread(KEEP_MESSAGES))).toBeNull()
    expect(planFold(thread(8))).toBeNull()
  })

  it('folds a long thread and keeps the last three exchanges verbatim', () => {
    const rows = thread(FOLD_AT_MESSAGES)
    const plan = planFold(rows)
    expect(plan.fold).toHaveLength(FOLD_AT_MESSAGES - KEEP_MESSAGES)
    expect(plan.fold[plan.fold.length - 1].role).toBe('assistant')
    expect(plan.through).toBe(plan.fold[plan.fold.length - 1].created_at)
  })

  it('folds a thread that is short in messages but long in words', () => {
    expect(planFold(thread(8, 4_000))).not.toBeNull()
  })

  it('never cuts an exchange in half', () => {
    // An unanswered question at the end shifts the cut back to an answer.
    const rows = [...thread(12), { role: 'user', content: 'Q12', created_at: '2026-11-01T01:00:00Z' }]
    const plan = planFold(rows)
    expect(plan.fold[plan.fold.length - 1].role).toBe('assistant')
    expect(rows[plan.fold.length].role).toBe('user')
  })
})

describe('the fold call', () => {
  it('carries the old summary and the folded messages', () => {
    const text = foldInput({ summary: 'Old facts.', fold: thread(2) })
    expect(text).toMatch(/Old facts\./)
    expect(text).toMatch(/PERSON: Q0/)
    expect(text).toMatch(/ASSISTANT: A1/)
  })

  it('throws away an empty summary and caps a runaway one', () => {
    expect(cleanSummary('   ')).toBe('')
    expect(cleanSummary('y'.repeat(SUMMARY_MAX_CHARS + 500))).toHaveLength(SUMMARY_MAX_CHARS)
    const lines = Array.from({ length: 400 }, (_, i) => `- point ${i} ${'z'.repeat(40)}`).join('\n')
    const cut = cleanSummary(lines)
    expect(cut.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS)
    expect(cut.endsWith('z')).toBe(true)
  })
})
