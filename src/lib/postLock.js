// ─── Has this post gone out? ───────────────────────────────────────────────
// One answer to "may anyone still change this post?", shared by the planner,
// the Post Queue, the composer, Creative Studio's send and the calendar — and
// mirrored by the generated_posts_lock_sent trigger in the database
// (20260916_lock_sent_posts.sql), which is the layer that actually holds.
//
// A post is LOCKED once it has gone out, or is going out right now:
//   publishing   Zernio is sending it; changing it underneath is a race
//   published    it is live — our row is history, not a draft
//   scheduled, and the slot has passed
//                Zernio fired it; the sync that marks it 'published' can lag
//                by up to an hour, and an edit in that window changes nothing
//                on the platform while making our copy lie about what went out
//
// A post scheduled for the FUTURE is not locked. Editing it is legitimate, but
// has to re-book the slot at Zernio (reschedule) — see rebookIfScheduled — or
// the edit never reaches what is actually published.
//
// Before this, nothing asked. Saving a plan a second time PATCHed its posts
// back to pending_review and rewrote their captions, including one already
// live on Instagram.

const IN_FLIGHT = new Set(['publishing', 'published'])

// Accepts a raw row (publish_status, scheduled_publish_at, published_at) or the
// camelCase shape the review screens normalise to.
function fieldsOf(post) {
  return {
    publishStatus: post?.publish_status ?? post?.publishStatus ?? 'not_published',
    scheduledAt: post?.scheduled_publish_at ?? post?.scheduledPublishAt ?? null,
    publishedAt: post?.published_at ?? post?.publishedAt ?? null,
    status: post?.status ?? '',
  }
}

export function postLock(post, now = Date.now()) {
  if (!post) return { locked: false, reason: '' }
  const f = fieldsOf(post)
  if (f.publishStatus === 'publishing') {
    return { locked: true, state: 'publishing', reason: 'Publishing right now — it can’t be changed.' }
  }
  if (IN_FLIGHT.has(f.publishStatus) || f.publishedAt || f.status === 'published') {
    return { locked: true, state: 'published', reason: 'Already published — a post that has gone out can’t be edited.' }
  }
  if (f.publishStatus === 'scheduled' && f.scheduledAt) {
    const at = Date.parse(f.scheduledAt)
    if (Number.isFinite(at) && at <= now) {
      return { locked: true, state: 'published', reason: 'Its scheduled time has passed, so it has gone out — it can’t be edited.' }
    }
  }
  return { locked: false, reason: '' }
}

export const isPostLocked = (post, now) => postLock(post, now).locked

// Booked at Zernio for a moment still ahead — editable, but only by re-booking.
export function isUpcoming(post, now = Date.now()) {
  const f = fieldsOf(post)
  if (f.publishStatus !== 'scheduled' || isPostLocked(post, now)) return false
  return true
}

// Where a post sits in the Post Queue. Three buckets, derived from what the
// platform did rather than from a review decision, because a plan no longer
// passes through a separate approval: its times were chosen when it was made.
//   upcoming    booked at Zernio for later
//   published   gone out (or going)
//   attention   everything else — not booked, failed, a draft-only account
export function queueBucket(post, now = Date.now()) {
  if (isPostLocked(post, now)) return 'published'
  if (isUpcoming(post, now)) return 'upcoming'
  return 'attention'
}
