import { describe, it, expect } from 'vitest'
import { platformEngagementRate, engagementSource } from './engagementSource'

// ─── One engagement rate per page ──────────────────────────────────────────
// The page used to show two, a strip apart, and both were correct. What these
// tests hold in place is the choosing: which one survives, and that the caller
// is told which it got so the ⓘ beside it cannot describe the other.

describe('platformEngagementRate', () => {
  it('scales LinkedIn’s 0..1 fraction to a percentage', () => {
    // 0.063 is the real figure measured on ARAK Lighting's page, and the whole
    // reason this scaling lives in one place: rendered raw it reads "0.1%",
    // which looks like a dead page rather than a misplaced decimal.
    const dash = { linkedinPage: { metrics: { engagement_rate: { total: 0.063 } } } }
    expect(platformEngagementRate(dash)).toBeCloseTo(6.3, 5)
  })

  it('answers null for Instagram, which publishes no rate at all', () => {
    expect(platformEngagementRate({ insights: { metrics: { reach: { total: 10 } } } })).toBeNull()
    expect(platformEngagementRate({})).toBeNull()
    expect(platformEngagementRate(null)).toBeNull()
  })

  it('answers null rather than 0 when LinkedIn reported nothing', () => {
    // `{ total: null }` is LinkedIn saying it has not computed a rate, not a
    // page nobody engaged with. Folding that to 0 would print "0%" under a
    // headline of 2.4k impressions — the most alarming way to say "unknown".
    const dash = { linkedinPage: { metrics: { engagement_rate: { total: null } } } }
    expect(platformEngagementRate(dash)).toBeNull()
  })

  it('keeps a real zero', () => {
    const dash = { linkedinPage: { metrics: { engagement_rate: { total: 0 } } } }
    expect(platformEngagementRate(dash)).toBe(0)
  })
})

describe('engagementSource', () => {
  it('prefers the platform’s own figure over ours', () => {
    // The pair from the screenshot that started this: 6.3% from LinkedIn and
    // 3.2% from us. LinkedIn's wins, because it is the number the user sees
    // when they open LinkedIn itself.
    const dash = { linkedinPage: { metrics: { engagement_rate: { total: 0.063 } } } }
    const got = engagementSource(dash, 3.2)
    expect(got.source).toBe('platform')
    expect(got.value).toBeCloseTo(6.3, 5)
  })

  it('falls back to ours where the platform has none', () => {
    const got = engagementSource({}, 18.75)
    expect(got).toEqual({ value: 18.75, source: 'posts' })
  })

  it('reports no source at all when neither exists', () => {
    // A caller that renders a source line must be able to render nothing.
    expect(engagementSource({}, null)).toEqual({ value: null, source: null })
    expect(engagementSource({}, NaN)).toEqual({ value: null, source: null })
  })

  it('never returns a source without a value, or a value without a source', () => {
    // The invariant the ⓘ depends on: a tile captioned "LinkedIn's own
    // figure" over a number we computed is worse than no caption.
    for (const [dash, ours] of [
      [{ linkedinPage: { metrics: { engagement_rate: { total: 0.063 } } } }, 3.2],
      [{}, 18.75],
      [{}, null],
    ]) {
      const { value, source } = engagementSource(dash, ours)
      expect(value === null, JSON.stringify({ value, source })).toBe(source === null)
    }
  })
})
