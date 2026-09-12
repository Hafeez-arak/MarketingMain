import { describe, it, expect } from 'vitest'
import {
  partitionByClock, deadlineLabel, urgencyOf, lensStates, lensHeadline,
  emptiness, setupGaps, compact, signed, pct,
} from './researchBrief'

const NOW = new Date('2026-09-12T09:00:00Z')
const f = (headline, extra = {}) => ({ headline, confidence: 0.5, ...extra })

describe('a brief is a queue, sorted by how long you have', () => {
  it('separates dated findings from evergreen ones', () => {
    // The distinction the whole page hangs on. A finding with no date is not
    // overdue, and treating null as "expired" would push every standing
    // observation into the act-now list until nobody reads it.
    const { act, standing, passed } = partitionByClock([
      f('undated observation'),
      f('national day', { perishable_until: '2026-09-23' }),
      f('missed tender', { perishable_until: '2026-09-01' }),
    ], NOW)

    expect(act.map(x => x.headline)).toEqual(['national day'])
    expect(standing.map(x => x.headline)).toEqual(['undated observation'])
    expect(passed.map(x => x.headline)).toEqual(['missed tender'])
  })

  it('puts the soonest deadline first', () => {
    const { act } = partitionByClock([
      f('far', { perishable_until: '2026-11-01' }),
      f('near', { perishable_until: '2026-09-14' }),
      f('middle', { perishable_until: '2026-10-01' }),
    ], NOW)
    expect(act.map(x => x.headline)).toEqual(['near', 'middle', 'far'])
  })

  it('keeps expired findings rather than hiding them', () => {
    // A deadline that went by unactioned explains a miss. Deleting it from the
    // page means the same miss happens again with no trace of the first.
    const { passed } = partitionByClock([f('gone', { perishable_until: '2026-08-01' })], NOW)
    expect(passed).toHaveLength(1)
  })

  it('survives an empty brief', () => {
    expect(partitionByClock([], NOW)).toEqual({ act: [], standing: [], passed: [] })
    expect(partitionByClock(undefined, NOW).act).toEqual([])
  })
})

describe('saying how long is left in words', () => {
  it('reads naturally on both sides of zero', () => {
    expect(deadlineLabel(f('x', { perishable_until: '2026-09-23' }), NOW)).toBe('in 11 days')
    expect(deadlineLabel(f('x', { perishable_until: '2026-09-13' }), NOW)).toBe('in 1 day')
    expect(deadlineLabel(f('x', { perishable_until: '2026-09-12' }), NOW)).toBe('today')
    expect(deadlineLabel(f('x', { perishable_until: '2026-09-11' }), NOW)).toBe('1 day ago')
  })

  it('says nothing at all for an evergreen finding', () => {
    expect(deadlineLabel(f('x'), NOW)).toBeNull()
  })

  it('buckets urgency coarsely enough to be read at a glance', () => {
    expect(urgencyOf(f('x', { perishable_until: '2026-09-14' }), NOW)).toBe('now')
    expect(urgencyOf(f('x', { perishable_until: '2026-09-25' }), NOW)).toBe('soon')
    expect(urgencyOf(f('x', { perishable_until: '2026-11-25' }), NOW)).toBe('later')
    expect(urgencyOf(f('x', { perishable_until: '2026-09-01' }), NOW)).toBe('passed')
    expect(urgencyOf(f('x'), NOW)).toBe('none')
  })
})

describe('a date-only deadline must not drift through the day', () => {
  // Caught by looking at the rendered page, not by a test. The brief showed
  // "Saudi National Day is 11 days away" — the number the calendar computed
  // and stored — directly above a badge reading "in 10 days", because the
  // label subtracted the current time of day from a midnight deadline and
  // 10.3 rounds down. Same date, same page, two answers.
  //
  // It was worse than an inconsistency: the same finding read 11 in the
  // morning and 10 in the afternoon.

  const finding = f('national day', { perishable_until: '2026-09-23' })

  it('answers the same at every hour of the day', () => {
    const hours = ['00:01', '09:00', '15:57', '23:59']
      .map(t => deadlineLabel(finding, new Date(`2026-09-12T${t}:00Z`)))
    expect(new Set(hours).size).toBe(1)
    expect(hours[0]).toBe('in 11 days')
  })

  it('agrees with the number the calendar module computed and stored', () => {
    // The two used to be separate implementations. They are now one, and this
    // is the test that says they must stay one.
    expect(deadlineLabel(finding, new Date('2026-09-12T15:57:00Z'))).toBe('in 11 days')
  })

  it('does not flip a same-day deadline to yesterday by the afternoon', () => {
    const today = f('x', { perishable_until: '2026-09-12' })
    expect(deadlineLabel(today, new Date('2026-09-12T23:00:00Z'))).toBe('today')
    expect(urgencyOf(today, new Date('2026-09-12T23:00:00Z'))).toBe('now')
  })
})

describe('a lens that found nothing and a lens that broke are not the same fact', () => {
  // This is the single most important thing the page has to get right. Both
  // produce an empty section, and a reader who cannot tell them apart will
  // either distrust a genuinely quiet week or trust a broken run.

  const report = {
    lenses: [
      { lens: 'openings', label: 'Projects & openings', state: 'found', count: 3, ran: true },
      { lens: 'demand', label: 'Buyers', state: 'quiet', count: 0, ran: true },
      { lens: 'category', label: 'Category', state: 'failed', count: 0, ran: false, error: 'timed out' },
    ],
  }

  it('keeps found, quiet and failed distinct', () => {
    expect(lensStates(report).map(s => s.state)).toEqual(['found', 'quiet', 'failed'])
  })

  it('carries the question each lens was asked, for a reader who does not know', () => {
    expect(lensStates(report)[0].question).toMatch(/about to need what we sell/i)
  })

  it('names failures last and never folds them into "quiet"', () => {
    const line = lensHeadline(lensStates(report))
    expect(line).toMatch(/1 found something/)
    expect(line).toMatch(/1 looked and found nothing/)
    expect(line).toMatch(/1 could not answer/)
    expect(line.indexOf('could not answer')).toBeGreaterThan(line.indexOf('found nothing'))
  })

  it('infers state when the server did not send one', () => {
    const out = lensStates({ lenses: [{ lens: 'demand', ran: true, count: 2 }] })
    expect(out[0].state).toBe('found')
  })

  it('says nothing when there are no lenses to describe', () => {
    expect(lensHeadline([])).toBe('')
    expect(lensStates({})).toEqual([])
  })
})

describe('an empty brief has to say WHY it is empty', () => {
  it('calls a genuinely quiet week what it is', () => {
    const out = emptiness({ quiet_week: true, lenses: [{ lens: 'demand', state: 'quiet', ran: true }] })
    expect(out.empty).toBe(true)
    expect(out.reason).toMatch(/genuinely quiet/i)
  })

  it('refuses to call a broken run a quiet week', () => {
    // The failure this guards: three lenses time out, the page renders empty,
    // and a reader concludes the market is still.
    const out = emptiness({
      quiet_week: true,
      lenses: [
        { lens: 'demand', label: 'Buyers', state: 'failed', ran: false },
        { lens: 'category', label: 'Category', state: 'failed', ran: false },
      ],
    })
    expect(out.reason).toMatch(/did not finish looking/)
    expect(out.reason).not.toMatch(/genuinely quiet/i)
  })

  it('is not empty when anything at all landed', () => {
    expect(emptiness({ gaps: [{ gap: 'x' }] }).empty).toBe(false)
    expect(emptiness({ findings: [f('x')] }).empty).toBe(false)
    expect(emptiness({ proposed_ideas: [{ title: 'x' }] }).empty).toBe(false)
  })
})

describe('the setup gaps that are costing the run quality', () => {
  it('turns a buried unanswered line into a task with a destination', () => {
    // The run already reports these. It reports them among a dozen other
    // lines, where they read as notes rather than as things to go and fix.
    const gaps = setupGaps({
      unanswered: ['The calendar assumed SA by reading the brand description, because no geography field is set.'],
    })
    expect(gaps.map(g => g.key)).toContain('geography')
    expect(gaps.find(g => g.key === 'geography').to).toBe('/brand-brain')
  })

  it('flags an inferred sales motion, because it decides which questions lead', () => {
    const gaps = setupGaps({ sales_motion: { motion: 'specification', explicit: false } })
    expect(gaps.map(g => g.key)).toContain('sales_motion')
  })

  it('does not flag a sales motion someone actually set', () => {
    const gaps = setupGaps({ sales_motion: { motion: 'specification', explicit: true } })
    expect(gaps.map(g => g.key)).not.toContain('sales_motion')
  })

  it('flags a missing account of our own only when there is not one', () => {
    expect(setupGaps({}, { hasOwnAccount: false }).map(g => g.key)).toContain('own_account')
    expect(setupGaps({}, { hasOwnAccount: true }).map(g => g.key)).not.toContain('own_account')
  })

  it('says nothing when nothing is missing', () => {
    expect(setupGaps({ sales_motion: { motion: 'product', explicit: true } })).toEqual([])
  })
})

describe('numbers a person can read at a glance', () => {
  it('compacts thousands and millions', () => {
    expect(compact(41200)).toBe('41.2k')
    expect(compact(950)).toBe('950')
    expect(compact(2_400_000)).toBe('2.4m')
  })

  it('always shows the sign on a delta, because the sign is the point', () => {
    expect(signed(900)).toBe('+900')
    expect(signed(-1200)).toBe('−1.2k')
    expect(signed(0)).toBe('±0')
  })

  it('degrades to an em dash rather than NaN', () => {
    // Number(null) is 0 and isFinite(0) is true — this codebase has been bitten
    // by that three times, so the guard is on the value being a real number.
    expect(compact(undefined)).toBe('—')
    expect(compact(null)).toBe('—')
    expect(pct(undefined)).toBe('—')
    expect(signed(undefined)).toBe('±0')
  })

  it('renders a confidence as a percentage', () => {
    expect(pct(0.35)).toBe('35%')
    expect(pct(1)).toBe('100%')
  })
})
