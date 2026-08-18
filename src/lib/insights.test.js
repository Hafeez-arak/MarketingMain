import { describe, it, expect } from 'vitest'
import {
  engagementOf,
  summariseDecisions,
  summarisePerformance,
  competitorNamesFrom,
  WEAK_SAMPLE,
} from './insights'

// ─── engagementOf ───────────────────────────────────────────────────────────

describe('engagementOf', () => {
  it('sums likes/comments/shares/saves when nothing is excluded', () => {
    const row = { likes: 10, comments: 2, shares: 1, saves: 3, views: 999 }
    expect(engagementOf(row)).toBe(16)
  })

  it('treats a missing metrics_present entry as "not measured", not zero', () => {
    // Platform only reports likes+comments; shares/saves should not count as 0.
    const row = { likes: 10, comments: 2, shares: 0, saves: 0, metrics_present: ['likes', 'comments'] }
    expect(engagementOf(row)).toBe(12)
  })

  it('a real zero from a reported metric still counts', () => {
    const row = { likes: 0, comments: 5, metrics_present: ['likes', 'comments'] }
    expect(engagementOf(row)).toBe(5)
  })

  it('handles missing/non-numeric values as 0', () => {
    const row = { likes: undefined, comments: 'n/a', shares: null, saves: 4 }
    expect(engagementOf(row)).toBe(4)
  })
})

// ─── summariseDecisions ─────────────────────────────────────────────────────

describe('summariseDecisions', () => {
  it('computes approval rate from decided (approved+rejected) events only', () => {
    const events = [
      { event: 'approved' }, { event: 'approved' }, { event: 'rejected' },
      { event: 'edited' }, // not a decision
    ]
    const { approvalRate, decided } = summariseDecisions(events, [])
    expect(decided).toBe(3)
    expect(approvalRate).toBeCloseTo(2 / 3)
  })

  it('returns a null approval rate when nothing has been decided yet', () => {
    const { approvalRate, decided } = summariseDecisions([{ event: 'edited' }], [])
    expect(decided).toBe(0)
    expect(approvalRate).toBeNull()
  })

  it('buckets rejections without a reason under "unspecified"', () => {
    const events = [
      { event: 'rejected', reason: 'off_brand' },
      { event: 'rejected', reason: '' },
      { event: 'rejected' },
    ]
    const { rejectReasons } = summariseDecisions(events, [])
    const map = Object.fromEntries(rejectReasons)
    expect(map.off_brand).toBe(1)
    expect(map.unspecified).toBe(2)
  })

  it('ranks most-redrafted ideas by redraft count, top 5', () => {
    const events = [
      { event: 'redrafted', idea_id: 'a' },
      { event: 'redrafted', idea_id: 'a' },
      { event: 'redrafted', idea_id: 'b' },
    ]
    const ideas = [{ id: 'a', title: 'Idea A' }, { id: 'b', title: 'Idea B' }]
    const { mostRedrafted } = summariseDecisions(events, ideas)
    expect(mostRedrafted[0]).toMatchObject({ id: 'a', count: 2 })
    expect(mostRedrafted[1]).toMatchObject({ id: 'b', count: 1 })
  })

  it('ignores redrafted events with no idea_id', () => {
    const events = [{ event: 'redrafted', idea_id: null }]
    const { mostRedrafted } = summariseDecisions(events, [])
    expect(mostRedrafted).toEqual([])
  })

  it('only counts edited fields whose value actually changed', () => {
    const events = [
      { event: 'edited', before: { caption: 'A', topic: 'X' }, after: { caption: 'B', topic: 'X' } },
    ]
    const { editedFields } = summariseDecisions(events, [])
    const map = Object.fromEntries(editedFields)
    expect(map.caption).toBe(1)
    expect(map.topic).toBeUndefined()
  })

  it('treats value coercion consistently (number vs string of same value is unchanged)', () => {
    const events = [
      { event: 'edited', before: { count: 1 }, after: { count: '1' } },
    ]
    const { editedFields } = summariseDecisions(events, [])
    expect(Object.fromEntries(editedFields).count).toBeUndefined()
  })
})

// ─── summarisePerformance ───────────────────────────────────────────────────

function metric(overrides) {
  return {
    post_id: 'p1', post_table: 'instagram_generated_posts', platform: 'instagram',
    metric_date: '2026-08-01', likes: 1, comments: 0, shares: 0, saves: 0,
    ...overrides,
  }
}

describe('summarisePerformance', () => {
  it('keeps only the latest metric row per post rather than summing every sync', () => {
    const metrics = [
      metric({ post_id: 'p1', metric_date: '2026-08-01', likes: 10 }),
      metric({ post_id: 'p1', metric_date: '2026-08-05', likes: 40 }),
    ]
    const { byPlatform } = summarisePerformance({ metrics, posts: [] }, [])
    expect(byPlatform.find(b => b.key === 'instagram').avgEngagement).toBe(40)
  })

  it('ignores metric rows from a post_table it does not know', () => {
    const metrics = [metric({ post_table: 'some_other_table' })]
    const { postsWithMetrics } = summarisePerformance({ metrics, posts: [] }, [])
    expect(postsWithMetrics).toBe(0)
  })

  // Instagram posts moved to generated_posts when Creative Studio became the
  // only generation path. If this regresses to an instagram_generated_posts
  // equality check, Insights keeps rendering happily off the frozen history
  // and silently ignores every post made since — so pin both tables.
  it('counts metrics from generated_posts, not just the frozen Instagram table', () => {
    const metrics = [
      metric({ post_id: 'p1', post_table: 'instagram_generated_posts', likes: 10 }),
      metric({ post_id: 'p2', post_table: 'generated_posts', likes: 30 }),
    ]
    const { postsWithMetrics, byPlatform } = summarisePerformance({ metrics, posts: [] }, [])
    expect(postsWithMetrics).toBe(2)
    expect(byPlatform.find(b => b.key === 'instagram').avgEngagement).toBe(20)
  })

  it('traces engagement to pillar/format/weekday only when the post maps to a known idea', () => {
    const metrics = [metric({ post_id: 'p1', likes: 20 })]
    const posts = [{ id: 'p1', plan_idea_id: 'idea1' }]
    const ideas = [{ id: 'idea1', content_pillar: 'education', format: 'reel', scheduled_date: '2026-08-03' }] // a Monday
    const { byPillar, byFormat, byWeekday, postsTracedToIdeas } = summarisePerformance({ metrics, posts }, ideas)
    expect(postsTracedToIdeas).toBe(1)
    expect(byPillar[0]).toMatchObject({ key: 'education', avgEngagement: 20 })
    expect(byFormat[0]).toMatchObject({ key: 'reel' })
    expect(byWeekday[0]).toMatchObject({ key: 'Mon' })
  })

  it('falls back to media_type when format is absent', () => {
    const metrics = [metric({ post_id: 'p1' })]
    const posts = [{ id: 'p1', plan_idea_id: 'idea1' }]
    const ideas = [{ id: 'idea1', media_type: 'carousel' }]
    const { byFormat } = summarisePerformance({ metrics, posts }, ideas)
    expect(byFormat[0].key).toBe('carousel')
  })

  it('still counts platform-level engagement for posts with no matching idea', () => {
    const metrics = [metric({ post_id: 'orphan', likes: 5 })]
    const { byPlatform, postsTracedToIdeas } = summarisePerformance({ metrics, posts: [] }, [])
    expect(byPlatform[0]).toMatchObject({ key: 'instagram', avgEngagement: 5 })
    expect(postsTracedToIdeas).toBe(0)
  })

  it('marks a breakdown weak when its sample size is under WEAK_SAMPLE', () => {
    const metrics = [metric({ post_id: 'p1' })]
    const posts = [{ id: 'p1', plan_idea_id: 'idea1' }]
    const ideas = [{ id: 'idea1', content_pillar: 'education' }]
    const { byPillar } = summarisePerformance({ metrics, posts }, ideas)
    expect(byPillar[0].sampleSize).toBeLessThan(WEAK_SAMPLE)
    expect(byPillar[0].weak).toBe(true)
  })

  it('sorts breakdowns by average engagement descending', () => {
    const metrics = [
      metric({ post_id: 'p1', likes: 5 }),
      metric({ post_id: 'p2', likes: 50 }),
    ]
    const posts = [
      { id: 'p1', plan_idea_id: 'low' },
      { id: 'p2', plan_idea_id: 'high' },
    ]
    const ideas = [
      { id: 'low', content_pillar: 'a' },
      { id: 'high', content_pillar: 'b' },
    ]
    const { byPillar } = summarisePerformance({ metrics, posts }, ideas)
    expect(byPillar.map(p => p.key)).toEqual(['b', 'a'])
  })
})

// ─── competitorNamesFrom ────────────────────────────────────────────────────

describe('competitorNamesFrom', () => {
  it('finds directory sections by title/key regardless of exact wording', () => {
    const schema = {
      sections: [{ key: 'watch', title: 'Competitor Watch', kind: 'directory', enabled: true }],
      columns: [{ key: 'name', section_key: 'watch', enabled: true, in_prompt: true }],
    }
    const directory = { rowsBySection: { watch: [{ data: { name: 'Rival Spa' } }, { data: { name: 'Other Spa' } }] } }
    expect(competitorNamesFrom(schema, directory)).toEqual(['Rival Spa', 'Other Spa'])
  })

  it('matches a renamed section as long as "competitor" or "rival" appears', () => {
    const schema = {
      sections: [{ key: 'rivals', title: 'Local Rivals', kind: 'directory', enabled: true }],
      columns: [{ key: 'name', section_key: 'rivals', enabled: true, in_prompt: true }],
    }
    const directory = { rowsBySection: { rivals: [{ data: { name: 'X' } }] } }
    expect(competitorNamesFrom(schema, directory)).toEqual(['X'])
  })

  it('returns an empty list when no directory section matches', () => {
    const schema = {
      sections: [{ key: 'services', title: 'Services', kind: 'directory', enabled: true }],
      columns: [],
    }
    expect(competitorNamesFrom(schema, { rowsBySection: {} })).toEqual([])
  })

  it('dedupes repeated names', () => {
    const schema = {
      sections: [{ key: 'watch', title: 'Competitor Watch', kind: 'directory', enabled: true }],
      columns: [{ key: 'name', section_key: 'watch', enabled: true, in_prompt: true }],
    }
    const directory = { rowsBySection: { watch: [{ data: { name: 'Rival Spa' } }, { data: { name: 'Rival Spa' } }] } }
    expect(competitorNamesFrom(schema, directory)).toEqual(['Rival Spa'])
  })
})
