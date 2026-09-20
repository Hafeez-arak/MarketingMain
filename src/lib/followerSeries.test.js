import { describe, it, expect } from 'vitest'
import { followerRowsFrom, followerSpanLabel } from './followerSeries'

const stats = rows => ({ followers: { stats: { 'ig-1': rows } } })
const history = values => ({
  followerHistory: { metrics: { follower_count: { values } } },
})

describe('followerRowsFrom', () => {
  it('takes whichever source has more history behind it', () => {
    // The bug this replaces: follower-stats answered with one point and the
    // sixty-point history was never looked at, so the chart drew one day.
    const payload = {
      ...stats([{ date: '2026-09-20', followers: 4790 }]),
      ...history(Array.from({ length: 60 }, (_, i) => ({ date: `2026-07-${i + 1}`, value: 100 + i }))),
    }
    expect(followerRowsFrom(payload, 'ig-1')).toHaveLength(60)
  })

  it('keeps follower-stats when it is the longer one', () => {
    const payload = {
      ...stats([{ date: '2026-09-19', followers: 10 }, { date: '2026-09-20', followers: 11 }]),
      ...history([{ date: '2026-09-20', value: 11 }]),
    }
    expect(followerRowsFrom(payload, 'ig-1')).toEqual([
      { date: '2026-09-19', followers: 10 },
      { date: '2026-09-20', followers: 11 },
    ])
  })

  it('normalises the history shape to the same {date, followers}', () => {
    expect(followerRowsFrom(history([{ date: '2026-09-20', value: 7 }]))).toEqual([
      { date: '2026-09-20', followers: 7 },
    ])
  })

  it('scopes follower-stats to one account, and folds them all without an id', () => {
    const payload = { followers: { stats: {
      'ig-1': [{ date: '2026-09-20', followers: 1 }],
      'li-1': [{ date: '2026-09-20', followers: 4790 }],
    } } }
    expect(followerRowsFrom(payload, 'ig-1')).toEqual([{ date: '2026-09-20', followers: 1 }])
    expect(followerRowsFrom(payload)).toHaveLength(2)
  })

  it('is an empty list, not a throw, when nothing answered', () => {
    expect(followerRowsFrom(null)).toEqual([])
    expect(followerRowsFrom({})).toEqual([])
    expect(followerRowsFrom({ followers: { stats: {} } }, 'ig-1')).toEqual([])
  })
})

describe('followerSpanLabel', () => {
  it('says what the series actually covers', () => {
    expect(followerSpanLabel([
      { date: '2026-09-15', followers: 1 },
      { date: '2026-09-20', followers: 1 },
    ])).toBe('2 days recorded · 2026-09-15 to 2026-09-20')
  })

  it('does not say "1 days", or repeat a single date', () => {
    expect(followerSpanLabel([{ date: '2026-09-20', followers: 1 }]))
      .toBe('1 day recorded · 2026-09-20')
  })

  it('has nothing to say about an empty series', () => {
    expect(followerSpanLabel([])).toBe('')
  })
})
