import { describe, it, expect } from 'vitest'
import { splitReach, reachFor, shareOf, FOLLOWER, NON_FOLLOWER } from './followType'

// The exact shape Zernio answered with on 2026-09-20 for the connected
// Instagram account, captured live rather than imagined.
const LIVE = {
  success: true,
  metricType: 'total_value',
  breakdown: 'follow_type',
  metrics: {
    reach: {
      total: 10,
      breakdowns: [
        { dimension: 'FOLLOWER', value: 1 },
        { dimension: 'NON_FOLLOWER', value: 9 },
      ],
    },
  },
}

const both = new Set([FOLLOWER, NON_FOLLOWER])

describe('splitReach', () => {
  it('reads the two sides out of the live response shape', () => {
    expect(splitReach(LIVE)).toEqual({ total: 10, follower: 1, nonFollower: 9, error: '' })
  })

  it('carries an error rather than pretending the account was quiet', () => {
    const s = splitReach({ _error: 'Token expired.' })
    expect(s.error).toBe('Token expired.')
    expect(s.follower).toBeNull()
  })

  it('leaves a side nobody measured as null, never 0', () => {
    const only = splitReach({ metrics: { reach: { total: 4, breakdowns: [{ dimension: 'FOLLOWER', value: 4 }] } } })
    expect(only.follower).toBe(4)
    expect(only.nonFollower).toBeNull()
    expect(splitReach({}).total).toBeNull()
    expect(splitReach(null).total).toBeNull()
  })

  it('does not care how the platform cases the dimension', () => {
    const lower = splitReach({ metrics: { reach: { total: 2, breakdowns: [{ dimension: 'non_follower', value: 2 }] } } })
    expect(lower.nonFollower).toBe(2)
  })
})

describe('reachFor', () => {
  const split = splitReach(LIVE)

  it('adds only the sides that are ticked', () => {
    expect(reachFor(split, both)).toBe(10)
    expect(reachFor(split, new Set([FOLLOWER]))).toBe(1)
    expect(reachFor(split, new Set([NON_FOLLOWER]))).toBe(9)
  })

  it('is null when nothing is ticked, rather than 0', () => {
    expect(reachFor(split, new Set())).toBeNull()
  })

  it('is null when the ticked side was never measured', () => {
    const partial = splitReach({ metrics: { reach: { total: 4, breakdowns: [{ dimension: 'FOLLOWER', value: 4 }] } } })
    expect(reachFor(partial, new Set([NON_FOLLOWER]))).toBeNull()
    expect(reachFor(partial, both)).toBe(4)
  })

  it('counts a side measured as a real zero', () => {
    // Nobody outside the follower list saw it. That is a measurement.
    const zero = splitReach({
      metrics: { reach: { total: 5, breakdowns: [
        { dimension: 'FOLLOWER', value: 5 }, { dimension: 'NON_FOLLOWER', value: 0 },
      ] } },
    })
    expect(reachFor(zero, new Set([NON_FOLLOWER]))).toBe(0)
    expect(reachFor(zero, both)).toBe(5)
  })
})

describe('shareOf', () => {
  it('divides by the two sides, not by Instagram total', () => {
    // total is 10 here and the sides sum to 10, so both readings agree...
    expect(shareOf(splitReach(LIVE))).toEqual({ follower: 10, nonFollower: 90 })
  })

  it('still adds up to 100 when the platform total is larger than the two sides', () => {
    // ...and here it does not. A person Instagram could not classify is in the
    // total and in neither breakdown; dividing by the total would give 8% and
    // 72%, which reads as a rounding bug rather than as a third category.
    const odd = splitReach({
      metrics: { reach: { total: 25, breakdowns: [
        { dimension: 'FOLLOWER', value: 2 }, { dimension: 'NON_FOLLOWER', value: 18 },
      ] } },
    })
    const s = shareOf(odd)
    expect(Math.round(s.follower + s.nonFollower)).toBe(100)
    expect(Math.round(s.follower)).toBe(10)
  })

  it('has no share to give when a side is missing or nothing was reached', () => {
    expect(shareOf({ follower: 4, nonFollower: null })).toEqual({ follower: null, nonFollower: null })
    expect(shareOf({ follower: 0, nonFollower: 0 })).toEqual({ follower: null, nonFollower: null })
  })
})
