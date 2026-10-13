import { describe, it, expect } from 'vitest'
import { feedPlan, feedPost, mergeFeedPages, FEED_MAX_DAYS } from './_zernio.js'

const NOW = Date.parse('2026-10-13T08:00:00Z')

// Shapes as Zernio's GET /v1/analytics list returned them for @araklighting
// on 2026-10-13, trimmed to the fields the feed reads.
const direct = {
  _id: '6aec1d2e0000000000000001',
  latePostId: null,
  isExternal: true,
  content: 'Fifty years of light, one project at a time.',
  publishedAt: '2026-10-12T17:24:10.000Z',
  platformPostUrl: 'https://www.instagram.com/reel/DeZwbc3KNIH/',
  mediaType: 'video',
  thumbnailUrl: 'https://cdn.example/thumb.jpg',
  analytics: { likes: 2, comments: 0, reach: null, views: 0, saves: 0, shares: 0, lastUpdated: '2026-10-13T06:00:00Z' },
}
const ours = {
  ...direct,
  _id: '6aec1d2e0000000000000002',
  latePostId: '6ab108bf9df5c9a81bfeb9b0',
  content: 'Posted from the app',
  publishedAt: '2026-10-13T07:00:00.000Z',
}

describe('feedPlan', () => {
  it('starts on the day the account was connected', () => {
    const plan = feedPlan({ accountId: 'acc', connectedAt: '2026-10-12T10:58:04Z', now: NOW })
    expect(plan.fromDate).toBe('2026-10-12')
    expect(plan.toDate).toBe('2026-10-13')
    expect(plan.query(2)).toMatchObject({ accountId: 'acc', source: 'all', page: 2, sortBy: 'date', order: 'desc' })
  })

  it('clamps an old connection to what one Zernio query accepts', () => {
    // Zernio refuses a range over a year with a 400, so the start is clamped
    // rather than sent.
    const plan = feedPlan({ accountId: 'acc', connectedAt: '2023-01-01T00:00:00Z', now: NOW })
    const span = (Date.parse(plan.toDate) - Date.parse(plan.fromDate)) / 86400000
    expect(span).toBe(FEED_MAX_DAYS)
  })

  it('falls back to the widest window when the connection date is unknown', () => {
    const plan = feedPlan({ accountId: 'acc', connectedAt: null, now: NOW })
    expect(plan.fromDate).toBe('2025-10-13')
  })
})

describe('feedPost', () => {
  it('tags a post made on Instagram directly', () => {
    const p = feedPost(direct)
    expect(p.origin).toBe('direct')
    expect(p.zernio_post_id).toBeNull()
    expect(p.url).toBe(direct.platformPostUrl)
  })

  it('tags a post published through the app by latePostId, not isExternal', () => {
    // isExternal is true on EVERY row of this list, ours included.
    const p = feedPost(ours)
    expect(p.origin).toBe('platform')
    expect(p.zernio_post_id).toBe('6ab108bf9df5c9a81bfeb9b0')
  })

  it('keeps a missing number missing rather than showing zero', () => {
    const p = feedPost(direct)
    expect(p.reach).toBeNull()
    expect(p.likes).toBe(2)
  })
})

describe('mergeFeedPages', () => {
  it('lists newest first and drops a row repeated across pages', () => {
    const merged = mergeFeedPages([{ posts: [direct, ours] }, { posts: [ours] }])
    expect(merged.map(p => p.id)).toEqual([ours._id, direct._id])
  })

  it('survives an empty or missing page', () => {
    expect(mergeFeedPages([null, {}, { posts: [] }])).toEqual([])
  })
})
