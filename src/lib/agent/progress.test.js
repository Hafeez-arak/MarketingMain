import { describe, it, expect } from 'vitest'
import {
  plannedLenses, lensProgress, runProgress, percentOf, progressLine, secs,
  looksStuck, isLive, PHASE_LABELS,
} from './progress'

const running = (extra = {}) => ({
  status: 'running', stage: 'lenses', started_at: '2026-09-12T09:00:00Z',
  report: { planned_lenses: ['openings', 'calendar', 'demand', 'ourselves', 'category'] },
  ...extra,
})
const row = (lens, extra = {}) => ({
  lens, status: 'ok', findings: [], duration_ms: 4000, cost_usd: '0.1', ...extra,
})

describe('the plan is read, not guessed', () => {
  it('uses what the run wrote down when it planned itself', () => {
    // Without a written plan the UI has to re-derive the set from cadence and
    // motion, and would be wrong on a monthly run — showing five lenses while
    // seven were actually going to run.
    expect(plannedLenses({ planned_lenses: ['openings', 'demand'] })).toEqual(['openings', 'demand'])
  })

  it('falls back to the default set for a LIVE run that predates the field', () => {
    const out = plannedLenses({}, [], { live: true })
    expect(out).toContain('openings')
    expect(out).toContain('calendar')
    expect(out).not.toContain('rivals')   // weekly default
  })

  it('honours a monthly cadence in the fallback', () => {
    expect(plannedLenses({ cadence: 'monthly' }, [], { live: true })).toContain('rivals')
  })

  it('does not measure a FINISHED old run against today\'s lens set', () => {
    // `category` was added on 2026-09-12. Showing it as "not reached" on a run
    // from the 10th claims that run skipped something, when the lens did not
    // exist yet. What a finished run did IS what it planned.
    const out = plannedLenses({}, [row('openings'), row('demand')], { live: false })
    expect(out).toEqual(['openings', 'demand'])
    expect(out).not.toContain('category')
  })

  it('includes any lens that actually produced a result, plan or not', () => {
    // A result is proof the lens ran, whatever the report claims. Hiding it
    // would mean throwing away work that is sitting right there.
    expect(plannedLenses({ planned_lenses: ['openings'] }, [row('craft')]))
      .toEqual(['openings', 'craft'])
  })
})

describe('a lens with no row is not automatically "working"', () => {
  it('shows pending lenses as running while the run is live', () => {
    const out = lensProgress(running(), [row('openings', { findings: [{ headline: 'x' }] })])
    expect(out.find(l => l.key === 'openings').state).toBe('done')
    expect(out.find(l => l.key === 'demand').state).toBe('running')
  })

  it('shows them as SKIPPED once the run is over, never as still running', () => {
    // The failure this exists to prevent: a run dies at lens two and the page
    // spins forever on lenses three to five. Same lesson as every terminal
    // path writing a status — only the server closes a spinner.
    const dead = running({ status: 'failed', stage: 'lenses' })
    const out = lensProgress(dead, [row('openings')])
    expect(out.find(l => l.key === 'demand').state).toBe('skipped')
    expect(out.some(l => l.state === 'running')).toBe(false)
  })

  it('separates a lens that found nothing from one that could not answer', () => {
    const out = lensProgress(running(), [
      row('openings', { findings: [{ headline: 'a' }] }),
      row('demand', { findings: [] }),
      row('category', { status: 'failed', error: 'timed out' }),
    ])
    expect(out.find(l => l.key === 'openings').state).toBe('done')
    expect(out.find(l => l.key === 'demand').state).toBe('quiet')
    expect(out.find(l => l.key === 'category').state).toBe('failed')
    expect(out.find(l => l.key === 'category').error).toBe('timed out')
  })

  it('marks the free lenses, so "costs nothing" does not read as "broken"', () => {
    const out = lensProgress(running(), [])
    expect(out.find(l => l.key === 'calendar').computed).toBe(true)
    expect(out.find(l => l.key === 'ourselves').computed).toBe(true)
    expect(out.find(l => l.key === 'openings').computed).toBe(false)
  })

  it('carries the question each lens asks, so the strip explains itself', () => {
    expect(lensProgress(running(), [])[0].question).toBeTruthy()
  })
})

describe('counting progress the way the run actually proceeds', () => {
  it('counts quiet and failed lenses as finished', () => {
    // A count that only moves on success stalls on a run going perfectly well.
    const p = runProgress(running(), [
      row('openings', { findings: [] }),
      row('demand', { status: 'failed' }),
    ])
    expect(p.done).toBe(2)
    expect(p.total).toBe(5)
  })

  it('sums what the run has cost so far', () => {
    const p = runProgress(running(), [row('openings', { cost_usd: '0.12' }), row('demand', { cost_usd: '0.08' })])
    expect(p.cost).toBeCloseTo(0.2, 5)
  })

  it('never reports 100% while work is still happening', () => {
    // A bar that reads 100% through the whole synthesis step is a bar nobody
    // believes the second time.
    expect(percentOf('synthesise', 5, 5)).toBeLessThan(100)
    expect(percentOf('lenses', 5, 5)).toBeLessThan(100)
    expect(percentOf('complete', 5, 5)).toBe(100)
  })

  it('gives gather real credit, because everything else rests on it', () => {
    expect(percentOf('gather', 0, 5)).toBeGreaterThan(0)
  })

  it('does not divide by zero when there are no lenses', () => {
    expect(percentOf('lenses', 0, 0)).toBe(15)
  })
})

describe('the line a person reads instead of the bar', () => {
  it('counts answered questions while running', () => {
    expect(progressLine(runProgress(running(), [row('openings')]))).toBe('1 of 5 questions answered')
  })

  it('says what happened once it is done', () => {
    const done = running({ status: 'complete', stage: 'complete' })
    const line = progressLine(runProgress(done, [row('openings', { findings: [{ headline: 'x' }] })]))
    expect(line).toMatch(/5 questions checked/)
    expect(line).toMatch(/1 found something/)
  })

  it('does not pretend a failed run merely paused', () => {
    const line = progressLine(runProgress(running({ status: 'failed' }), []))
    expect(line).toMatch(/stopped before it finished/)
  })

  it('names the measuring phase rather than showing zero of five', () => {
    expect(progressLine(runProgress(running({ stage: 'gather' }), []))).toMatch(/Measuring competitors/)
  })
})

describe('saying a run is stuck rather than spinning forever', () => {
  it('flags a run still going after the sweep window', () => {
    // The server sweeps stale runs, but only on the NEXT attempt — so a
    // browser can watch a dead run indefinitely with no signal at all.
    expect(looksStuck(running(), new Date('2026-09-12T09:25:00Z'))).toBe(true)
  })

  it('leaves a healthy run alone', () => {
    expect(looksStuck(running(), new Date('2026-09-12T09:05:00Z'))).toBe(false)
  })

  it('never calls a finished run stuck', () => {
    expect(looksStuck(running({ status: 'complete' }), new Date('2027-01-01T00:00:00Z'))).toBe(false)
  })

  it('survives a missing or unparseable start time', () => {
    expect(looksStuck({ status: 'running' })).toBe(false)
    expect(looksStuck({ status: 'running', started_at: 'nonsense' })).toBe(false)
  })

  it('knows which runs are worth polling', () => {
    expect(isLive({ status: 'running' })).toBe(true)
    expect(isLive({ status: 'complete' })).toBe(false)
    expect(isLive({ status: 'failed' })).toBe(false)
    expect(isLive(null)).toBe(false)
  })
})

describe('formatting', () => {
  it('reads seconds under a minute and minutes above it', () => {
    expect(secs(4000)).toBe('4s')
    expect(secs(151_000)).toBe('2m 31s')
  })

  it('says nothing rather than NaN', () => {
    expect(secs(null)).toBe('')
    expect(secs(undefined)).toBe('')
  })

  it('names every phase the run can be in', () => {
    expect(PHASE_LABELS.map(p => p.key)).toEqual(['gather', 'lenses', 'synthesise', 'complete'])
  })
})
