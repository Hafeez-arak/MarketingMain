import { describe, it, expect } from 'vitest'
import { foldFollowers } from './format'

// ─── The last place a follower count was invented ──────────────────────────
//
// The KPI tile folded three sources with `|| 0` and `Math.max`. Every one of
// them reports an uncounted account as a zero, so the fold could only ever
// produce 0 — printed as "Total followers: 0" beside a chart that correctly
// said the first snapshot lands tomorrow.
//
// Live shapes, 2026-09-14, from the account connected that morning.

describe('foldFollowers', () => {
  const uncountedAccount = { _id: 'a1', followersCount: null }
  const uncountedStats = { _id: 'a1', currentFollowers: 0, dataPoints: 0 }

  it('is null when no source has counted', () => {
    expect(foldFollowers([uncountedAccount], [uncountedStats], [])).toBeNull()
  })

  it('is null for entirely empty inputs', () => {
    expect(foldFollowers()).toBeNull()
    expect(foldFollowers([], [], [])).toBeNull()
  })

  it('does NOT trust currentFollowers when dataPoints is 0', () => {
    // The trap in one line: the number is present and looks like an answer.
    // Only dataPoints reveals it was computed over an empty series.
    expect(foldFollowers([], [{ currentFollowers: 0, dataPoints: 0 }], [])).toBeNull()
  })

  it('reports a genuine zero once snapshots exist', () => {
    // An account really at zero followers is MEASURED. Collapsing this into
    // "unknown" would be the opposite error, and just as wrong.
    expect(foldFollowers([], [{ currentFollowers: 0, dataPoints: 14 }], [])).toBe(0)
  })

  it('takes the account figure when Zernio has filled it in', () => {
    expect(foldFollowers([{ followersCount: 1 }], [uncountedStats], [])).toBe(1)
  })

  it('takes the newest point of the history series', () => {
    const history = [{ followers: 10 }, { followers: 12 }, { followers: 17 }]
    expect(foldFollowers([uncountedAccount], [uncountedStats], history)).toBe(17)
  })

  it('prefers whichever source filled first', () => {
    // The three fill on the same daily clock but not in the same instant, so
    // the best available figure wins rather than a fixed precedence.
    expect(foldFollowers(
      [{ followersCount: 1 }],
      [{ currentFollowers: 5, dataPoints: 3 }],
      [{ followers: 3 }],
    )).toBe(5)
  })

  it('ignores a history point that is not a number', () => {
    expect(foldFollowers([], [], [{ followers: null }])).toBeNull()
  })

  it('survives undefined members without throwing', () => {
    expect(() => foldFollowers([undefined], [undefined], [undefined])).not.toThrow()
  })
})
