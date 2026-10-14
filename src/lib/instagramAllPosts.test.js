import { describe, it, expect } from 'vitest'
import { buildAllPosts, countPosts, matchesFilter, feedPostType, appPostType, feedStats } from './instagramAllPosts'

const NOW = Date.parse('2026-10-14T12:00:00Z')

const app = (id, status, extra = {}, raw = {}) => ({
  id, status, createdAt: '2026-10-10T09:00:00Z', mediaUrls: ['a.jpg'], ...extra,
  _raw: { zernio_post_id: null, ...raw },
})
const feed = (id, extra = {}) => ({
  id, zernio_post_id: null, origin: 'direct', published_at: '2026-10-12T18:00:00Z', media_type: 'video', ...extra,
})

describe('buildAllPosts', () => {
  it('lists app posts of every status alongside direct posts', () => {
    const rows = buildAllPosts([
      app('d1', 'draft'),
      app('p1', 'pending_publish'),
      app('s1', 'scheduled', {}, { scheduled_publish_at: '2026-10-20T10:00:00Z' }),
    ], [feed('f1')], NOW)
    expect(rows.map(r => r.key).sort()).toEqual(['app:d1', 'app:p1', 'app:s1', 'feed:f1'])
    expect(rows.find(r => r.key === 'feed:f1')).toMatchObject({ origin: 'instagram', status: 'published', type: 'Reel' })
  })

  it('folds a feed post into the app post it came from, matched on the Zernio id', () => {
    const rows = buildAllPosts(
      [app('a1', 'publishing', {}, { zernio_post_id: 'z9' })],
      [feed('f1', { zernio_post_id: 'z9', origin: 'platform', likes: 4, media_type: 'image' })],
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'app:a1', origin: 'app', status: 'published', type: 'Post' })
    expect(rows[0].feed.likes).toBe(4)
  })

  it('never matches on an empty Zernio id', () => {
    const rows = buildAllPosts([app('a1', 'draft', {}, { zernio_post_id: '' })], [feed('f1')], NOW)
    expect(rows).toHaveLength(2)
  })

  it('keeps an app-sent feed post with no row here as Made in app', () => {
    const rows = buildAllPosts([], [feed('f1', { zernio_post_id: 'z1', origin: 'platform' })], NOW)
    expect(rows[0]).toMatchObject({ origin: 'app', status: 'published', post: null })
  })

  it('puts upcoming posts first, soonest first, then the rest newest first', () => {
    const rows = buildAllPosts([
      app('late', 'scheduled', {}, { scheduled_publish_at: '2026-10-30T10:00:00Z' }),
      app('soon', 'scheduled', {}, { scheduled_publish_at: '2026-10-15T10:00:00Z' }),
      app('old', 'draft', { createdAt: '2026-10-01T00:00:00Z' }),
    ], [feed('new', { published_at: '2026-10-13T00:00:00Z' })], NOW)
    expect(rows.map(r => r.key)).toEqual(['app:soon', 'app:late', 'feed:new', 'app:old'])
  })
})

describe('filters and counts', () => {
  const rows = buildAllPosts([
    app('d1', 'draft'),
    app('p1', 'pending_publish'),
    app('s1', 'scheduled'),
    app('pub', 'published'),
  ], [feed('f1')], NOW)

  it('counts what each chip lists, with direct posts under Published', () => {
    expect(countPosts(rows)).toEqual({ all: 5, draft: 1, pending_publish: 1, scheduled: 1, published: 2 })
  })

  it('All posts lists everything', () => {
    expect(rows.filter(r => matchesFilter(r, 'all'))).toHaveLength(5)
  })
})

describe('post types and numbers', () => {
  it('names media the way Instagram does', () => {
    expect(feedPostType('VIDEO')).toBe('Reel')
    expect(feedPostType('carousel')).toBe('Carousel')
    expect(feedPostType('image')).toBe('Post')
    expect(appPostType({ mediaUrls: ['a', 'b'], _raw: {} })).toBe('Carousel')
    expect(appPostType({ mediaUrls: ['a'], _raw: { media_type: 'video' } })).toBe('Reel')
  })

  it('shows only the numbers Zernio has', () => {
    expect(feedStats({ likes: 1, comments: 3, reach: null })).toEqual(['1 like', '3 comments'])
  })
})
