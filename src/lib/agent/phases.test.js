import { describe, it, expect } from 'vitest'
import {
  PHASES, PLATFORM_CEILING_MS, SAFETY_MARGIN_MS, PHASE_BUDGET_MS,
  deadlineFor, msLeft, worthStarting, pendingLenses, readyToSynthesise,
  nextPhase, timedOutResult, resultsFromRows, timingNote,
} from './phases'

const T0 = 1_700_000_000_000

describe('budgets stay inside the ceiling that cannot be raised', () => {
  // Vercel Hobby is 300s and there is no setting to change it. Everything here
  // is downstream of that one fact.

  it('never lets a phase reach the platform ceiling', () => {
    for (const phase of Object.keys(PHASE_BUDGET_MS)) {
      expect(deadlineFor(phase, T0) - T0, phase)
        .toBeLessThanOrEqual(PLATFORM_CEILING_MS - SAFETY_MARGIN_MS)
    }
  })

  it('leaves real room to write an honest failure', () => {
    // Being killed at the ceiling writes nothing: no status, no error, no
    // ledger row. Finishing early and recording "this timed out" is strictly
    // better, and that needs time to do.
    expect(SAFETY_MARGIN_MS).toBeGreaterThanOrEqual(30_000)
  })

  it('gives an unknown phase the lens budget rather than no budget', () => {
    expect(deadlineFor('something-new', T0)).toBe(deadlineFor('lens', T0))
  })

  it('does not budget stage 0 tightly', () => {
    // Everything after gather is a bonus on top of its output, so it is the
    // last thing that should be cut short.
    expect(PHASE_BUDGET_MS.gather).toBeGreaterThanOrEqual(60_000)
  })
})

describe('time left', () => {
  it('counts down', () => {
    expect(msLeft(T0 + 10_000, T0)).toBe(10_000)
  })

  it('NEVER returns a negative number', () => {
    // A negative timeout fires immediately in some runtimes and never in
    // others. "Never" is the exact failure this module exists to prevent.
    expect(msLeft(T0 - 50_000, T0)).toBe(0)
    expect(msLeft(T0, T0)).toBe(0)
  })

  it('is 0 rather than NaN for rubbish input', () => {
    expect(msLeft(undefined, T0)).toBe(0)
    expect(msLeft(null, T0)).toBe(0)
    expect(msLeft('soon', T0)).toBe(0)
  })
})

describe('refusing to start work that cannot finish', () => {
  it('starts when there is room', () => {
    expect(worthStarting(T0 + 120_000, 15_000, T0)).toBe(true)
  })

  it('refuses with seconds left', () => {
    // Starting a model call with eight seconds left buys an aborted generation
    // that still bills for its tokens.
    expect(worthStarting(T0 + 8_000, 15_000, T0)).toBe(false)
  })

  it('refuses on an already-passed deadline', () => {
    expect(worthStarting(T0 - 1, 15_000, T0)).toBe(false)
  })
})

describe('which lenses still need running', () => {
  const wanted = ['calendar', 'openings', 'demand', 'rivals', 'ourselves', 'craft']

  it('lists everything when nothing has run', () => {
    expect(pendingLenses(wanted, [])).toEqual(wanted)
  })

  it('drops the ones already stored', () => {
    expect(pendingLenses(wanted, [{ lens: 'calendar' }, { lens: 'rivals' }]))
      .toEqual(['openings', 'demand', 'ourselves', 'craft'])
  })

  it('treats a FAILED lens as done, not pending', () => {
    // Retrying automatically would spend the same money on the same failure.
    // The brief is designed to report a missing lens honestly instead.
    expect(pendingLenses(['calendar'], [{ lens: 'calendar', status: 'failed' }])).toEqual([])
  })

  it('accepts lens objects as well as keys', () => {
    expect(pendingLenses([{ key: 'calendar' }, { key: 'demand' }], [{ lens: 'calendar' }]))
      .toEqual(['demand'])
  })

  it('ignores rubbish on either side', () => {
    expect(pendingLenses(['calendar', null, ''], [{ lens: null }, {}])).toEqual(['calendar'])
  })
})

describe('when synthesis may start', () => {
  const wanted = ['calendar', 'rivals']

  it('waits while a lens is still pending', () => {
    expect(readyToSynthesise(wanted, [{ lens: 'calendar' }])).toBe(false)
  })

  it('starts once nothing is pending', () => {
    expect(readyToSynthesise(wanted, [{ lens: 'calendar' }, { lens: 'rivals' }])).toBe(true)
  })

  it('does NOT require every lens to have succeeded', () => {
    // One blocked Instagram must not hold the brief hostage — that is the
    // exact failure the parallel lens design was built to end.
    expect(readyToSynthesise(wanted, [
      { lens: 'calendar', status: 'ok' },
      { lens: 'rivals', status: 'failed' },
    ])).toBe(true)
  })
})

describe('the state machine', () => {
  it('moves gather to lenses', () => {
    expect(nextPhase({ phase: 'gather' })).toBe('lenses')
  })

  it('stays on lenses while any are pending', () => {
    expect(nextPhase({ phase: 'lenses', wanted: ['a', 'b'], done: [{ lens: 'a' }] })).toBe('lenses')
  })

  it('advances to synthesise once they are all in', () => {
    expect(nextPhase({ phase: 'lenses', wanted: ['a'], done: [{ lens: 'a' }] })).toBe('synthesise')
  })

  it('ends at complete', () => {
    expect(nextPhase({ phase: 'synthesise' })).toBe('complete')
    expect(nextPhase({ phase: 'complete' })).toBe('complete')
  })

  it('lists its phases in order', () => {
    expect(PHASES).toEqual(['gather', 'lenses', 'synthesise', 'complete'])
  })
})

describe('a lens that ran out of time', () => {
  const r = timedOutResult('calendar', 150_000)

  it('is shaped exactly like a real result', () => {
    // So nothing downstream has to branch on it.
    expect(Object.keys(r)).toEqual(
      expect.arrayContaining(['lens', 'ok', 'findings', 'sources', 'cost', 'error']),
    )
    expect(r.findings).toEqual([])
  })

  it('says it did not FINISH, not that it found nothing', () => {
    // Those are different facts and the brief must not confuse them.
    expect(r.error).toMatch(/did not finish looking/)
    expect(r.ok).toBe(false)
    expect(r.timed_out).toBe(true)
  })
})

describe('reading results back out of the table', () => {
  it('maps a stored row to the investigate() shape', () => {
    const [out] = resultsFromRows([{
      lens: 'calendar', status: 'ok',
      findings: [{ headline: 'x' }], sources: ['https://a.com'],
      note: 'assumed SA', error: '', cost_usd: '0.2000', timed_out: false,
    }])
    expect(out.ok).toBe(true)
    expect(out.findings).toHaveLength(1)
    expect(out.cost).toBe(0.2)
  })

  it('marks a failed row as not ok', () => {
    expect(resultsFromRows([{ lens: 'rivals', status: 'failed', error: 'boom' }])[0].ok).toBe(false)
  })

  it('survives null jsonb columns rather than crashing synthesis', () => {
    const [out] = resultsFromRows([{ lens: 'demand', status: 'ok', findings: null, sources: null }])
    expect(out.findings).toEqual([])
    expect(out.sources).toEqual([])
  })

  it('does not turn a null cost into NaN', () => {
    expect(resultsFromRows([{ lens: 'x', status: 'ok', cost_usd: null }])[0].cost).toBe(0)
  })
})

describe('saying out loud that the clock, not the market, was quiet', () => {
  it('is silent when everything finished', () => {
    expect(timingNote([{ lens: 'calendar', timed_out: false }])).toBe('')
    expect(timingNote([])).toBe('')
  })

  it('names what was cut short, and says it is not a finding', () => {
    // A run that quietly lost two lenses to the clock looks identical, from
    // the outside, to a genuinely quiet week.
    const note = timingNote([
      { lens: 'openings', timed_out: true },
      { lens: 'demand', timed_out: true },
    ])
    expect(note).toMatch(/openings, demand/)
    expect(note).toMatch(/not a finding about the market/)
  })
})
