import { describe, it, expect } from 'vitest'
import { isApproved, scheduleStage, needsAttention, pendingReason, isGone } from './postStage'

// The Schedule page's whole layout is one question per post — calendar or
// strip — so these are the rules that decide what the user sees at all.

const HOUR = 3600_000
const future = new Date(Date.now() + 48 * HOUR).toISOString()
const past   = new Date(Date.now() - 48 * HOUR).toISOString()

describe('isApproved', () => {
  it('accepts what finalising a plan writes', () => {
    expect(isApproved({ status: 'pending_publish' })).toBe(true)
  })

  it('accepts the composer and legacy spellings', () => {
    expect(isApproved({ status: 'approved' })).toBe(true)
    expect(isApproved({ status: 'scheduled' })).toBe(true)
  })

  it('rejects a post still waiting on a person, and one turned down', () => {
    expect(isApproved({ status: 'pending_review' })).toBe(false)
    expect(isApproved({ status: 'rejected' })).toBe(false)
    expect(isApproved({ status: 'draft' })).toBe(false)
  })

  it('defaults an unknown status to NOT approved', () => {
    // A status nobody has thought about must not leak onto the schedule.
    expect(isApproved({ status: 'awaiting_legal' })).toBe(false)
  })

  it('treats a booked row with a blank status as approved', () => {
    // Zernio holding a slot is a stronger signal than an empty column on an
    // old row — refusing it would hide a post that is genuinely going out.
    expect(isApproved({ status: '', publish_status: 'scheduled' })).toBe(true)
    expect(isApproved({ status: '', publish_status: 'published' })).toBe(true)
    expect(isApproved({ status: '', publish_status: 'not_published' })).toBe(false)
  })
})

describe('scheduleStage', () => {
  it('separates the four states the calendar colours', () => {
    expect(scheduleStage({ publish_status: 'scheduled', scheduled_publish_at: future })).toBe('booked')
    expect(scheduleStage({ publish_status: 'publishing' })).toBe('sending')
    expect(scheduleStage({ publish_status: 'published' })).toBe('published')
    expect(scheduleStage({ publish_status: 'not_published' })).toBe('pending')
    expect(scheduleStage({ publish_status: 'failed' })).toBe('pending')
  })

  it('distinguishes "gone out" from "confirmed published"', () => {
    // Zernio fired it on its own clock; the sync that confirms can lag an
    // hour. It is gone — drawing it as upcoming would invite a reschedule of a
    // live post — but nothing has confirmed it, and saying Published before
    // anything did is how the page ends up reporting a publish that failed.
    expect(scheduleStage({ publish_status: 'scheduled', scheduled_publish_at: past })).toBe('sent')
  })

  it('only says published when something actually wrote a result', () => {
    expect(scheduleStage({ publish_status: 'published' })).toBe('published')
    expect(scheduleStage({ publish_status: 'scheduled', scheduled_publish_at: past, published_at: past })).toBe('published')
    expect(scheduleStage({ publish_status: 'scheduled', scheduled_publish_at: past, status: 'published' })).toBe('published')
  })

  it('leaves an unbooked post with a stale date in the strip, not on the calendar', () => {
    // Its time passed but nothing was ever booked, so nothing went out. This
    // must stay a post that needs a person.
    expect(scheduleStage({ publish_status: 'not_published', scheduled_publish_at: past })).toBe('pending')
  })
})

describe('needsAttention', () => {
  it('is the strip: approved, and nothing will publish it', () => {
    expect(needsAttention({ status: 'pending_publish', publish_status: 'not_published' })).toBe(true)
    expect(needsAttention({ status: 'pending_publish', publish_status: 'failed' })).toBe(true)
  })

  it('leaves booked, sent and published posts alone', () => {
    expect(needsAttention({ status: 'pending_publish', publish_status: 'scheduled', scheduled_publish_at: future })).toBe(false)
    expect(needsAttention({ status: 'pending_publish', publish_status: 'published' })).toBe(false)
    // Unconfirmed but gone — there is nothing a person can do, so it must not
    // show up in the strip or on the sidebar badge.
    expect(needsAttention({ status: 'pending_publish', publish_status: 'scheduled', scheduled_publish_at: past })).toBe(false)
  })

  it('never claims an unapproved post needs scheduling', () => {
    expect(needsAttention({ status: 'pending_review', publish_status: 'not_published' })).toBe(false)
    expect(needsAttention({ status: 'rejected', publish_status: 'failed' })).toBe(false)
  })
})

describe('pendingReason', () => {
  it('leads with the platform’s own failure when there is one', () => {
    expect(pendingReason({ publish_status: 'failed', publish_error: 'video too short' }))
      .toContain('video too short')
  })

  it('names the two ways a post ends up unbooked', () => {
    expect(pendingReason({ publish_status: 'not_published' })).toMatch(/no time chosen/i)
    expect(pendingReason({ publish_status: 'not_published', scheduled_publish_at: past }))
      .toMatch(/already passed/i)
  })
})

describe('isGone', () => {
  it('covers both ways a post has left, and nothing else', () => {
    expect(isGone({ publish_status: 'published' })).toBe(true)
    expect(isGone({ publish_status: 'scheduled', scheduled_publish_at: past })).toBe(true)
    expect(isGone({ publish_status: 'scheduled', scheduled_publish_at: future })).toBe(false)
    expect(isGone({ publish_status: 'publishing' })).toBe(false)
    expect(isGone({ publish_status: 'failed' })).toBe(false)
  })
})
