import { describe, it, expect } from 'vitest'
import { groupByDay } from './queueOrder'

// Owner decision 2026-10-14: soonest first, grouped by day, sent posts after.
const post = (id, bucket, over) => ({ key: id, bucket, post: { id, ...over } })

describe('groupByDay', () => {
  it('orders days soonest first, then sent days most recent first', () => {
    const groups = groupByDay([
      post('late', 'upcoming', { scheduledPublishAt: '2026-10-20T16:00:00Z' }),
      post('sentOld', 'published', { publishedAt: '2026-10-01T09:00:00Z' }),
      post('soon', 'upcoming', { scheduledPublishAt: '2026-10-15T16:00:00Z' }),
      post('sentNew', 'published', { publishedAt: '2026-10-12T09:00:00Z' }),
      post('undated', 'attention', {}),
      post('planned', 'attention', { scheduledAt: '2026-10-16', plannedAt: Date.parse('2026-10-16T06:00:00Z') }),
    ])
    expect(groups.map(g => [g.dayKey, g.sent])).toEqual([
      ['2026-10-15', false], ['2026-10-16', false], ['2026-10-20', false], [null, false],
      ['2026-10-12', true], ['2026-10-01', true],
    ])
  })

  it('orders within a day by time, and uses the brand day, not UTC', () => {
    // 22:30 UTC on the 14th is 01:30 on the 15th in Riyadh.
    const groups = groupByDay([
      post('b', 'upcoming', { scheduledPublishAt: '2026-10-15T15:00:00Z' }),
      post('a', 'upcoming', { scheduledPublishAt: '2026-10-14T22:30:00Z' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].dayKey).toBe('2026-10-15')
    expect(groups[0].items.map(i => i.key)).toEqual(['a', 'b'])
  })

  it('places a card still being written on its idea’s planned day', () => {
    const groups = groupByDay([{ key: 'i1', bucket: 'attention', idea: { scheduled_date: '2026-10-18' } }])
    expect(groups[0].dayKey).toBe('2026-10-18')
  })
})
