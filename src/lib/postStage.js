import { postLock } from './postLock'

// ─── Where an approved post stands ─────────────────────────────────────────
// One answer to "is this post booked, waiting, or already out?", shared by the
// Schedule page and the sidebar badge so the two can never disagree about how
// many posts need a person.
//
// ── THE MODEL ──
// Approving a post in the monthly planner IS scheduling it. schedulePlanPosts
// books every approved row at Zernio for its planned moment; what it cannot
// book it reports as "attention" and leaves unbooked (see lib/planScheduling).
// So the split the Schedule page draws is not a review decision at all — it is
// simply whether the booking succeeded:
//
//   booked      publish_status 'scheduled' — Zernio will send it. On the calendar.
//   sending     'publishing' — in flight right now. On the calendar.
//   published   out, and something confirmed it. On the calendar, in green.
//   sent        its slot passed while still booked — gone, but unconfirmed.
//               Green too, because nothing can be done about it either way.
//   pending     approved, but NOTHING will publish it: never booked, or the
//               booking failed. These are the posts in the strip, and the only
//               ones that need a person.
//
// A post still awaiting a human decision (pending_review) or turned down
// (rejected) is not approved and appears nowhere on the Schedule page — it
// belongs to the Post Queue.

// `status` values that mean a person has signed off. 'pending_publish' is what
// finalising a plan writes (studioBridge: "approved, waiting to be booked");
// 'approved' and 'scheduled' are the older/composer spellings of the same
// thing. Deliberately NOT a list of what to exclude: a status nobody has
// thought about yet should default to hidden rather than to the strip.
export const APPROVED_STATUSES = ['pending_publish', 'approved', 'scheduled']

// A row from the scheduled_posts view. Rows written before `status` was used
// consistently can carry '' — treated as approved when the post is already
// booked, because Zernio holding a slot for it is a stronger signal than a
// blank column.
export function isApproved(post) {
  const status = post?.status || ''
  if (APPROVED_STATUSES.includes(status)) return true
  return !status && ['scheduled', 'publishing', 'published'].includes(post?.publish_status)
}

// Booked at the platform, or already gone out — anything with a real slot that
// something will act on. These are the calendar's rows.
export const ON_CALENDAR_STATUSES = ['scheduled', 'publishing', 'published']

// Approved but unbooked — the strip. `failed` is here rather than on the
// calendar because a failed post is not going anywhere on its own; it needs
// the same thing an unbooked one needs, which is a person.
export const PENDING_STATUSES = ['not_published', 'failed']

export function scheduleStage(post, now = Date.now()) {
  const publish = post?.publish_status || 'not_published'
  // Confirmed out. Each of these is something that WROTE a result: the publish
  // workflow set the status, or the analytics sync stamped published_at.
  if (publish === 'published' || post?.published_at || post?.status === 'published') return 'published'
  if (publish === 'publishing') return 'sending'
  // Booked for a moment that has already gone by, and nobody has written a
  // result. Zernio fired it on its own clock and the sync that confirms can
  // lag by up to an hour, so this post has almost certainly gone out — it is
  // locked, and nothing here may touch it.
  //
  // But "almost certainly" is not "published", and it used to be reported as
  // exactly that. The difference matters: a booking can also fail at the
  // platform, and a page that says Published an hour before anything confirmed
  // it is a page that will eventually say Published about a post that never
  // went out. 'sent' claims only what we actually know — its time came, we let
  // it go, and we have not heard back.
  if (postLock(post, now).state === 'published') return 'sent'
  if (publish === 'scheduled') return 'booked'
  return 'pending'
}

// Has this post left the building, confirmed or not? What the calendar asks
// when it decides whether anything may still be done about it.
export const isGone = (post, now) => ['published', 'sent'].includes(scheduleStage(post, now))

// Does this post need a person? The sidebar badge and the strip both ask this.
export const needsAttention = (post, now) =>
  isApproved(post) && scheduleStage(post, now) === 'pending'

// Why it is sitting in the strip, in the words the person can act on. Ordered
// most-specific first: a failure has a real message and beats every guess.
export function pendingReason(post) {
  if (post?.publish_status === 'failed') {
    return post.publish_error
      ? `Publishing failed: ${String(post.publish_error).slice(0, 160)}`
      : 'Publishing failed — pick a new time to try again.'
  }
  if (!post?.scheduled_publish_at && !post?.scheduled_date) {
    return 'No time chosen yet — pick when it goes out.'
  }
  const at = Date.parse(post.scheduled_publish_at || '')
  if (Number.isFinite(at) && at <= Date.now()) {
    return 'Its planned time has already passed — pick a new one.'
  }
  return 'Planned, but not booked at the platform yet.'
}
