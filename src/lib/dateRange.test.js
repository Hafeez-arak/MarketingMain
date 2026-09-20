import { describe, it, expect } from 'vitest'
import {
  normalizeRange, resolveRange, rangeLabel, rangeParams, rangeFromParams,
  spanOf, isPreset, isCustom, MAX_RANGE_DAYS,
} from './dateRange'

// A fixed clock, so "today" is a value in the test rather than the day it runs.
const NOW = Date.parse('2026-09-20T09:00:00Z')

describe('normalizeRange', () => {
  it('takes a preset and a fixed window as two different shapes', () => {
    expect(normalizeRange({ days: 30 }, { now: NOW }).range).toEqual({ days: 30 })
    expect(normalizeRange({ from: '2026-09-01', to: '2026-09-14' }, { now: NOW }).range)
      .toEqual({ from: '2026-09-01', to: '2026-09-14' })
  })

  it('refuses a window that runs backwards', () => {
    const { error } = normalizeRange({ from: '2026-09-14', to: '2026-09-01' }, { now: NOW })
    expect(error).toMatch(/before/i)
  })

  it('refuses days that are not calendar days', () => {
    expect(normalizeRange({ from: '2026-13-45', to: '2026-09-01' }, { now: NOW }).error).toBeTruthy()
    expect(normalizeRange({ from: 'yesterday', to: 'today' }, { now: NOW }).error).toBeTruthy()
  })

  it('refuses a window that ends in the future', () => {
    // Days that have not happened are not a quiet patch on a chart.
    const { error } = normalizeRange({ from: '2026-09-01', to: '2026-09-21' }, { now: NOW })
    expect(error).toMatch(/after today \(2026-09-20\)/)
    expect(normalizeRange({ from: '2026-09-01', to: '2026-09-20' }, { now: NOW }).range).toBeTruthy()
  })

  it('refuses a window longer than the cap, and says how long it was', () => {
    const { error } = normalizeRange({ from: '2024-09-01', to: '2026-09-01' }, { now: NOW })
    expect(error).toMatch(/731 days/)
    expect(normalizeRange({ days: MAX_RANGE_DAYS + 1 }, { now: NOW }).error).toBeTruthy()
    expect(normalizeRange({ days: MAX_RANGE_DAYS }, { now: NOW }).range).toEqual({ days: 365 })
  })

  // Search Console's floor: below a week a weekday effect reads as a trend.
  it('honours a floor when the caller sets one', () => {
    const opts = { now: NOW, minDays: 7 }
    expect(normalizeRange({ from: '2026-09-15', to: '2026-09-17' }, opts).error)
      .toMatch(/3 days.*at least 7/)
    expect(normalizeRange({ from: '2026-09-14', to: '2026-09-20' }, opts).range).toBeTruthy()
    expect(normalizeRange({ days: 3 }, opts).error).toMatch(/at least 7/)
    // No floor by default — the social surfaces have none.
    expect(normalizeRange({ days: 3 }, { now: NOW }).range).toEqual({ days: 3 })
  })

  it('says "1 day" rather than "1 days"', () => {
    expect(normalizeRange({ from: '2026-09-20', to: '2026-09-20' }, { now: NOW, minDays: 7 }).error)
      .toMatch(/is 1 day\./)
  })

  it('never returns a half-valid range', () => {
    const bad = normalizeRange({ from: '2026-09-14', to: '2026-09-01' }, { now: NOW })
    expect(bad.range).toBeUndefined()
  })
})

describe('resolveRange', () => {
  it('resolves a preset against the clock it is given, not the one it was picked on', () => {
    expect(resolveRange({ days: 30 }, { now: NOW }))
      .toEqual({ fromDate: '2026-08-21', toDate: '2026-09-20', days: 30 })
    // The same preset a day later is a different window — that is the point.
    expect(resolveRange({ days: 30 }, { now: NOW + 86_400_000 }).toDate).toBe('2026-09-21')
  })

  it('leaves a fixed window exactly where it was put', () => {
    const r = resolveRange({ from: '2026-09-01', to: '2026-09-14' }, { now: NOW })
    expect(r).toEqual({ fromDate: '2026-09-01', toDate: '2026-09-14', days: 14 })
    expect(resolveRange({ from: '2026-09-01', to: '2026-09-14' }, { now: NOW + 86_400_000 * 40 }).toDate)
      .toBe('2026-09-14')
  })
})

describe('spanOf', () => {
  it('counts both ends, so a single day is one day', () => {
    expect(spanOf('2026-09-14', '2026-09-14')).toBe(1)
    expect(spanOf('2026-09-14', '2026-09-20')).toBe(7)
  })
})

describe('rangeLabel', () => {
  it('names a preset by its length and a window by its dates', () => {
    expect(rangeLabel({ days: 7 })).toBe('Last 7 days')
    expect(rangeLabel({ from: '2026-08-18', to: '2026-09-16' })).toBe('Aug 18 – Sep 16, 2026')
  })

  it('carries the year on both ends when the window crosses one', () => {
    expect(rangeLabel({ from: '2025-12-20', to: '2026-01-10' })).toBe('Dec 20, 2025 – Jan 10, 2026')
  })

  // The axis under this label prints "Sep 16" — en-GB would print "Sept 16"
  // and the two would read as different months.
  it('abbreviates months the way the chart axes do', () => {
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-16' })).toContain('Sep 16')
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-16' })).not.toContain('Sept')
  })
})

describe('rangeParams / rangeFromParams', () => {
  it('keeps the two shapes distinguishable across the wire', () => {
    expect(rangeParams({ days: 90 })).toEqual({ days: '90' })
    expect(rangeParams({ from: '2026-09-01', to: '2026-09-14' }))
      .toEqual({ from: '2026-09-01', to: '2026-09-14' })
  })

  it('reads a range back out of a query string', () => {
    const p = new URLSearchParams('from=2026-09-01&to=2026-09-14')
    expect(rangeFromParams(p, { now: NOW })).toEqual({ from: '2026-09-01', to: '2026-09-14' })
    expect(rangeFromParams(new URLSearchParams('days=7'), { now: NOW })).toEqual({ days: 7 })
  })

  it('falls back to the default rather than throwing on nonsense', () => {
    expect(rangeFromParams(new URLSearchParams('from=nope&to=also-nope'), { now: NOW })).toEqual({ days: 30 })
    expect(rangeFromParams(new URLSearchParams(''), { now: NOW })).toEqual({ days: 30 })
    // A window that ends tomorrow is refused, not quietly clamped to today.
    expect(rangeFromParams(new URLSearchParams('from=2026-09-01&to=2026-12-01'), { now: NOW }))
      .toEqual({ days: 30 })
  })

  it('reads a plain object as well as URLSearchParams', () => {
    expect(rangeFromParams({ days: '7' }, { now: NOW })).toEqual({ days: 7 })
  })
})

describe('isPreset / isCustom', () => {
  it('tells the two shapes apart', () => {
    expect(isPreset({ days: 30 })).toBe(true)
    expect(isCustom({ days: 30 })).toBe(false)
    expect(isCustom({ from: '2026-09-01', to: '2026-09-14' })).toBe(true)
    expect(isPreset({ from: '2026-09-01', to: '2026-09-14' })).toBe(false)
  })
})
