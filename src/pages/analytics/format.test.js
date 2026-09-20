import { describe, it, expect } from 'vitest'
import { foldFollowers, pct, windowLabel, plural } from './format'

// ─── One number, printed one way ───────────────────────────────────────────
//
// The engagement rate was rendered by four call sites at two precisions, so
// the KPI tile read "18.8%" and the chart legend 200px below it read "19%" —
// one variable, and a page that looked like it could not add up. Nothing was
// wrong in the arithmetic, which is what made it expensive to find.

describe('pct', () => {
  it('prints one decimal, so the same value cannot read two ways', () => {
    expect(pct(18.75)).toBe('18.8%')
    expect(pct(3.2)).toBe('3.2%')
    expect(pct(6.3)).toBe('6.3%')
  })

  it('does not round a rate up into a different number', () => {
    // The worst case of the old mix: toFixed(0) turned 6.5 into "7%" while a
    // tile a screen away, on toFixed(1), said "6.5%".
    expect(pct(6.5)).toBe('6.5%')
    expect(pct(6.5)).not.toBe('7%')
  })

  it('drops the decimal past 100%, where it has stopped earning its place', () => {
    expect(pct(133.33)).toBe('133%')
    expect(pct(100)).toBe('100%')
  })

  it('keeps a whole number whole rather than padding it', () => {
    // "33%", not "33.0%". A trailing zero reads as precision nobody measured.
    expect(pct(33)).toBe('33%')
    expect(pct(0)).toBe('0%')
  })

  it('dashes anything that is not a number', () => {
    // Every one of these reached a tile at some point: null from a platform
    // that reports no rate, undefined from a missing key, NaN from 0 ÷ 0.
    expect(pct(null)).toBe('—')
    expect(pct(undefined)).toBe('—')
    expect(pct(NaN)).toBe('—')
    expect(pct(Infinity)).toBe('—')
    expect(pct(null, 'n/a')).toBe('n/a')
  })
})

// ─── Two strips, two windows ───────────────────────────────────────────────
// Meta refuses more than 30 days on account insights and LinkedIn caps page
// totals at 88, while the post strip below honours the full 90. Stacked in
// identical type with identical captions, that is a 29-day figure a reader
// compares against a 90-day one.

describe('windowLabel', () => {
  it('states the span the server actually used, not the one in the picker', () => {
    // The real case: "Last 90 days" selected, Meta capped at 29.
    expect(windowLabel('2026-08-21', '2026-09-19', 90)).toBe('Last 29 days')
  })

  it('agrees with the picker when nothing was capped', () => {
    expect(windowLabel('2026-08-20', '2026-09-19', 30)).toBe('Last 30 days')
  })

  it('falls back to the picker when the server sent no dates', () => {
    expect(windowLabel(undefined, undefined, 7)).toBe('Last 7 days')
    expect(windowLabel('2026-09-19', undefined, 7)).toBe('Last 7 days')
  })

  it('is empty rather than "Last undefined days" when there is nothing to say', () => {
    expect(windowLabel(undefined, undefined, undefined)).toBe('')
    expect(windowLabel('nonsense', 'nonsense', 0)).toBe('')
  })
})

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

describe('plural', () => {
  it('drops the suffix for exactly one', () => {
    expect(plural(1, 'click')).toBe('1 click')
    expect(plural(0, 'click')).toBe('0 clicks')
    expect(plural(2, 'click')).toBe('2 clicks')
  })

  // `fmt` abbreviates past a thousand, so the abbreviated form is never the
  // singular one and must not lose its 's'.
  it('keeps the suffix on an abbreviated count', () => {
    expect(plural(1200, 'click')).toBe('1.2k clicks')
  })

  it('takes an irregular suffix', () => {
    expect(plural(1, 'query', 'ies')).toBe('1 query')
    expect(plural(3, 'quer', 'ies')).toBe('3 queries')
  })
})
