import { describe, it, expect } from 'vitest'
import { monthKey, spentInMonth, capDecision, WARN_AT } from './budget'

const row = (cost, iso) => ({ cost_usd: cost, created_at: iso })

describe('monthKey', () => {
  it('buckets by UTC month', () => {
    expect(monthKey('2026-09-09T12:00:00Z')).toBe('2026-09')
    expect(monthKey('2026-01-01T00:00:00Z')).toBe('2026-01')
  })

  it('rolls on the UTC boundary, not the brand-local one', () => {
    // Riyadh is UTC+3, so 2 AM on the 1st in Riyadh is still the previous
    // month in UTC. Deliberate: spend reconciles against a UTC invoice, while
    // scheduling stays brand-local (brandTime.js). Mixing the two would make
    // the cap and the bill disagree about which month it is.
    expect(monthKey('2026-09-30T22:00:00Z')).toBe('2026-09')
    expect(monthKey('2026-10-01T01:00:00Z')).toBe('2026-10')
  })

  it('returns empty for an unparseable date rather than throwing', () => {
    expect(monthKey('not a date')).toBe('')
  })
})

describe('spentInMonth', () => {
  const now = new Date('2026-09-09T00:00:00Z')

  it('sums only this month', () => {
    const rows = [
      row(1.50, '2026-09-01T00:00:00Z'),
      row(2.25, '2026-09-08T00:00:00Z'),
      row(9.99, '2026-08-31T23:59:00Z'),   // last month
    ]
    expect(spentInMonth(rows, now)).toBeCloseTo(3.75, 6)
  })

  it('ignores rows with a broken cost instead of poisoning the total', () => {
    // One NaN in the ledger must not defeat the cap for the whole month.
    const rows = [row(1, '2026-09-01T00:00:00Z'), row('oops', '2026-09-02T00:00:00Z')]
    expect(spentInMonth(rows, now)).toBe(1)
  })

  it('is zero for an empty ledger', () => {
    expect(spentInMonth([], now)).toBe(0)
  })
})

describe('capDecision', () => {
  it('allows everything when no cap is set', () => {
    // Null is the resting state — a workspace nobody configured must work.
    const d = capDecision({ cap: null, spent: 999 })
    expect(d.allowed).toBe(true)
    expect(d.cap).toBeNull()
  })

  it('treats an explicit 0 as stop, not as unset', () => {
    // Someone who types 0 means it. This is the case a `default 0` column
    // would have made indistinguishable from "nobody has decided yet", which
    // is why the migration defaults to null.
    const d = capDecision({ cap: 0, spent: 0 })
    expect(d.allowed).toBe(false)
  })

  it('refuses once the month is spent, and says so in money', () => {
    const d = capDecision({ cap: 50, spent: 50 })
    expect(d.allowed).toBe(false)
    expect(d.remaining).toBe(0)
    expect(d.reason).toContain('$50.00')
  })

  it('refuses a run it can already see will not fit', () => {
    // Better to stop before than to die mid-loop: a run that fails halfway
    // still bills for everything it did first.
    const d = capDecision({ cap: 50, spent: 48, estimate: 5 })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('$2.00')
  })

  it('allows a call that fits in what is left', () => {
    const d = capDecision({ cap: 50, spent: 40, estimate: 2 })
    expect(d.allowed).toBe(true)
  })

  it('warns before it blocks', () => {
    // A cap that goes from silent to blocking with nothing in between reads
    // as a bug rather than as a budget.
    const d = capDecision({ cap: 100, spent: 100 * WARN_AT, estimate: 1 })
    expect(d.allowed).toBe(true)
    expect(d.warn).toBe(true)
  })

  it('does not warn early in the month', () => {
    expect(capDecision({ cap: 100, spent: 10 }).warn).toBe(false)
  })

  it('survives garbage without silently uncapping', () => {
    const d = capDecision({ cap: 50, spent: NaN, estimate: undefined })
    expect(d.allowed).toBe(true)
    expect(d.spent).toBe(0)
  })
})
