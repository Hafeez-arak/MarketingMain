import { describe, it, expect, afterEach, vi } from 'vitest'
import { fetchScheduledPosts } from './scheduledPosts'
import { fetchPlans } from './contentPlans'
import { fetchRuns } from './agentRun'
import { fetchBrandSchema } from './brandSchema'
import { toPagePost } from './usePlatformPosts'

// ─── A failed read is not an empty list ────────────────────────────────────
// Each of these readers used to turn a network error into [] — so a page that
// could not load said "No posts yet", "No content plans yet", "No research
// has run" or "This brand's brain has no structure yet" (and offered to build
// one). They keep returning [] by default for their other callers; the pages
// that make an empty-state claim now ask to be told about the failure.

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const failWith = how => { globalThis.fetch = vi.fn(how === 'reject' ? () => Promise.reject(new TypeError('Failed to fetch')) : async () => new Response('{}', { status: 503 })) }

describe('readers: failed vs empty', () => {
  for (const how of ['reject', '503']) {
    it(`fetchScheduledPosts (${how}): [] by default, throws with throwOnError`, async () => {
      failWith(how)
      expect(await fetchScheduledPosts('ws', 'tok')).toEqual([])
      await expect(fetchScheduledPosts('ws', 'tok', { throwOnError: true })).rejects.toBeTruthy()
    })
    it(`fetchPlans (${how})`, async () => {
      failWith(how)
      expect(await fetchPlans('ws', 'tok')).toEqual([])
      await expect(fetchPlans('ws', 'tok', { throwOnError: true })).rejects.toBeTruthy()
    })
    it(`fetchRuns (${how})`, async () => {
      failWith(how)
      expect(await fetchRuns('ws', 'tok')).toEqual([])
      await expect(fetchRuns('ws', 'tok', 5, { throwOnError: true })).rejects.toBeTruthy()
    })
    it(`fetchBrandSchema (${how}) says it failed, still with empty arrays`, async () => {
      failWith(how)
      expect(await fetchBrandSchema('ws', 'tok')).toEqual({ sections: [], fields: [], columns: [], failed: true })
    })
  }

  it('a real empty answer is not a failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response('[]', { status: 200 }))
    expect(await fetchScheduledPosts('ws', 'tok', { throwOnError: true })).toEqual([])
    expect(await fetchBrandSchema('ws', 'tok')).toEqual({ sections: [], fields: [], columns: [], failed: false })
  })
})

describe('toPagePost (TikTok and LinkedIn pages)', () => {
  it('shows where a sent post really is, and the review status before that', () => {
    expect(toPagePost({ id: 1, platform: 'linkedin', caption: 'Hi', publish_status: 'scheduled', status: 'approved', image_url: 'a.png' }))
      .toMatchObject({ copy: 'Hi', status: 'scheduled', mediaUrls: ['a.png'], _fromSupabase: true })
    expect(toPagePost({ id: 2, platform: 'tiktok', publish_status: 'not_published', status: 'pending_publish' }).status).toBe('pending_publish')
  })
})
