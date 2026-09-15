import { describe, it, expect } from 'vitest'
import { postLock, isPostLocked, isUpcoming, queueBucket } from './postLock'

const NOW = Date.parse('2026-09-15T12:00:00Z')

describe('postLock', () => {
  it('leaves an unpublished post editable', () => {
    expect(isPostLocked({ publish_status: 'not_published' }, NOW)).toBe(false)
    expect(isPostLocked({ publish_status: 'failed' }, NOW)).toBe(false)
    expect(isPostLocked({}, NOW)).toBe(false)
  })

  it('locks a published or publishing post', () => {
    expect(postLock({ publish_status: 'published' }, NOW).state).toBe('published')
    expect(postLock({ publish_status: 'publishing' }, NOW).state).toBe('publishing')
  })

  // The row that started this: published on Zernio, then re-saved by the
  // planner back to pending_review. publish_status still tells the truth.
  it('locks on publish_status even when status was reset to pending_review', () => {
    expect(isPostLocked({ status: 'pending_review', publish_status: 'published' }, NOW)).toBe(true)
  })

  it('locks on published_at alone', () => {
    expect(isPostLocked({ publish_status: 'not_published', published_at: '2026-09-14T17:53:38Z' }, NOW)).toBe(true)
  })

  it('keeps a future scheduled post editable', () => {
    const post = { publish_status: 'scheduled', scheduled_publish_at: '2026-09-20T16:00:00Z' }
    expect(isPostLocked(post, NOW)).toBe(false)
    expect(isUpcoming(post, NOW)).toBe(true)
    expect(queueBucket(post, NOW)).toBe('upcoming')
  })

  it('locks a scheduled post whose slot has passed', () => {
    const post = { publish_status: 'scheduled', scheduled_publish_at: '2026-09-14T17:52:00Z' }
    expect(isPostLocked(post, NOW)).toBe(true)
    expect(isUpcoming(post, NOW)).toBe(false)
    expect(queueBucket(post, NOW)).toBe('published')
  })

  it('reads the camelCase review shape too', () => {
    expect(isPostLocked({ publishStatus: 'published' }, NOW)).toBe(true)
    expect(isUpcoming({ publishStatus: 'scheduled', scheduledPublishAt: '2026-10-01T10:00:00Z' }, NOW)).toBe(true)
  })

  it('puts everything else in attention', () => {
    expect(queueBucket({ publish_status: 'failed' }, NOW)).toBe('attention')
    expect(queueBucket({ publish_status: 'not_published', status: 'pending_review' }, NOW)).toBe('attention')
  })
})
