import { describe, it, expect } from 'vitest'
import { indexAnalytics, analyticsFor, engagementOf, ourPerformance } from './aggregate.js'

// ─── The join that was silently returning nothing ──────────────────────────
//
// Our analytics come from Zernio, which keys a metric row by ITS post id and
// carries ours alongside as a pointer at whichever table the post came from.
// Every reader here joined on `post_id` alone, so the moment a post lived in a
// different table than the one being read, its numbers vanished — and the
// assistant reported "no analytics" with total confidence.
//
// These tests pin the shapes observed live in the workspace on 2026-09-14.

const zernioRow = (over = {}) => ({
  post_id: '2f4d9ab6-0a46-46bc-9891-c6f861cca2d3',
  zernio_post_id: '6a78410ed036d32df0afb874',
  post_table: 'instagram_generated_posts',
  platform: 'instagram',
  metric_date: '2026-08-20',
  likes: 2, comments: 1, shares: 0, saves: 0,
  ...over,
})

describe('indexAnalytics', () => {
  it('indexes one row under BOTH ids', () => {
    const index = indexAnalytics([zernioRow()])
    expect(index['2f4d9ab6-0a46-46bc-9891-c6f861cca2d3']).toHaveLength(1)
    expect(index['6a78410ed036d32df0afb874']).toHaveLength(1)
  })

  it('points both keys at the same row object, so nothing is double counted', () => {
    const index = indexAnalytics([zernioRow()])
    expect(index['2f4d9ab6-0a46-46bc-9891-c6f861cca2d3'][0])
      .toBe(index['6a78410ed036d32df0afb874'][0])
  })

  it('ignores rows with neither id rather than keying them under undefined', () => {
    const index = indexAnalytics([{ likes: 9 }, null, undefined])
    expect(Object.keys(index)).toHaveLength(0)
  })
})

describe('analyticsFor', () => {
  it('finds a row keyed by ZERNIO id when our own id does not match', () => {
    // The live case: the metric row's post_id belongs to a table this post is
    // no longer in, but both sides still carry the provider's id.
    const index = indexAnalytics([zernioRow({ post_id: 'an-id-from-a-dead-table' })])
    const post = { id: '30ee4311-43f6-42a0-b1f7-4df54d76bb85', zernio_post_id: '6a78410ed036d32df0afb874' }
    expect(analyticsFor(index, post)).toHaveLength(1)
  })

  it('prefers our own id when both match', () => {
    const mine = zernioRow({ post_id: 'p1', zernio_post_id: 'z-other', likes: 5 })
    const theirs = zernioRow({ post_id: 'p2', zernio_post_id: 'z1', likes: 99 })
    const index = indexAnalytics([mine, theirs])
    const rows = analyticsFor(index, { id: 'p1', zernio_post_id: 'z1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].likes).toBe(5)
  })

  it('does NOT match on an empty zernio_post_id', () => {
    // '' is a real stored value in generated_posts for a post never sent to
    // Zernio. Treating it as a key would collide every unpublished post onto
    // one shared bucket of numbers belonging to none of them.
    const index = indexAnalytics([zernioRow({ post_id: '', zernio_post_id: '' })])
    expect(analyticsFor(index, { id: 'p1', zernio_post_id: '' })).toBeNull()
  })

  it('returns null, not an empty array, for a post with no numbers', () => {
    // engagementOf reads null as "unsynced" and never as "scored zero".
    const index = indexAnalytics([zernioRow()])
    expect(analyticsFor(index, { id: 'nope', zernio_post_id: 'also-nope' })).toBeNull()
  })

  it('survives missing arguments without throwing', () => {
    expect(analyticsFor(null, { id: 'p1' })).toBeNull()
    expect(analyticsFor({}, null)).toBeNull()
  })
})

describe('ourPerformance over Zernio-keyed rows', () => {
  const posts = [
    {
      id: 'ours-1', platform: 'instagram', format: 'feed_image', post_kind: 'caption_image',
      published_at: '2026-08-19T10:00:00.000Z', zernio_post_id: '6a78410ed036d32df0afb874',
    },
  ]

  it('measures a post whose metric row carries a stale post_id', () => {
    // Before the fix this returned measured: 0 — the exact "we have no
    // analytics" answer given about a post that had them.
    const out = ourPerformance(posts, [zernioRow({ post_id: 'id-from-the-old-table' })])
    expect(out.posts_total).toBe(1)
    expect(out.by_format[0].measured).toBe(1)
    expect(out.by_format[0].avg_engagement).toBe(3) // 2 likes + 1 comment
  })

  it('still reports measured: 0 when the numbers genuinely are not there', () => {
    const out = ourPerformance(posts, [])
    expect(out.posts_total).toBe(1)
    expect(out.by_format[0].measured).toBe(0)
    expect(out.by_format[0].avg_engagement).toBeNull()
  })

  it('does not sum daily snapshots — newest metric_date wins', () => {
    // The cumulative-snapshot trap, re-pinned here because the dual key makes
    // it easier to hand the same post more rows than before.
    const days = ['2026-08-12', '2026-08-13', '2026-08-14'].map(d =>
      zernioRow({ post_id: 'stale', metric_date: d }))
    expect(engagementOf(days).engagement).toBe(3)
    const out = ourPerformance(posts, days)
    expect(out.by_format[0].avg_engagement).toBe(3)
  })
})
