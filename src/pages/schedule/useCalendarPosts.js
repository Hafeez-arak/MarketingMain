import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchScheduledPosts, unschedulePost } from '../../lib/scheduledPosts'
import { bookPostAt } from '../../lib/planScheduling'
import {
  ON_CALENDAR_STATUSES, PENDING_STATUSES, APPROVED_STATUSES, needsAttention,
} from '../../lib/postStage'

// ─── The calendar's data ───────────────────────────────────────────────────
// Two queries, because the page shows two genuinely different things:
//
//   posts    everything BOOKED in the visible window — publish_status
//            'scheduled', 'publishing' or 'published'. These have a real slot
//            that something will act on (or already did), which is the only
//            honest definition of "on the calendar".
//
//   pending  approved posts that nothing is going to publish: never booked, or
//            the booking failed. Not range-filtered, because the whole point
//            is that they have no dependable time — a post whose planned slot
//            passed in August still needs a person in September.
//
//   upcoming the next posts due to go out, soonest first. Deliberately NOT
//            range-filtered either: "what is coming" is a question about the
//            future, not about whichever month you happen to have paged to,
//            and scoping it to the visible window would empty the strip the
//            moment you looked at October.
//
// A post therefore appears in exactly ONE of them. That is the change: the old
// version showed every publish state on the grid and put every unscheduled
// post — drafts, rejects, half-finished compositions — in the tray, so neither
// surface answered a question anyone had.

// How many of the next posts the strip carries. Enough to cover a busy week
// without turning a glance into a scroll.
const UPCOMING_LIMIT = 24

export function useCalendarPosts({ workspaceId, accessToken, from, to, webhooks, accounts }) {
  const [posts, setPosts]         = useState([])
  const [pending, setPending]     = useState([])
  const [upcoming, setUpcoming]   = useState([])
  const [error, setError]         = useState('')
  const [pendingId, setPendingId] = useState('')
  const [nonce, setNonce]         = useState(0)

  const ready = !!(workspaceId && accessToken && from && to)

  // What we currently want on screen, as one comparable value. `nonce` is in
  // here so an explicit reload after a booking re-fetches the same window.
  const wantKey = ready ? `${workspaceId}|${from}|${to}|${nonce}` : ''
  // What we have actually loaded. Written only after a fetch resolves.
  const [haveKey, setHaveKey] = useState('')

  // Loading is DERIVED, not stored. Storing it would mean writing state
  // synchronously inside the effect below to enter the loading state, which
  // causes the cascading re-render React 19 warns about — and this says the
  // same thing more directly: we are loading exactly when what we want and
  // what we have disagree.
  const loading = ready && haveKey !== wantKey

  // Guards a slow fetch for a window you have already paged away from from
  // landing on top of a newer one. Without it, clicking through months quickly
  // leaves whichever request finishes last on screen, which is not necessarily
  // the one you are looking at.
  const latest = useRef('')

  useEffect(() => {
    if (!ready) return
    latest.current = wantKey
    let cancelled = false

    // Every state write below happens after an await, so none of them is a
    // synchronous write from the effect body.
    ;(async () => {
      try {
        // Read once, here, rather than inside wantKey: a clock in the cache
        // key would invalidate it on every render and refetch forever.
        const nowISO = new Date().toISOString()
        const [booked, unbooked, next] = await Promise.all([
          fetchScheduledPosts(workspaceId, accessToken, {
            from, to, publishStatus: ON_CALENDAR_STATUSES,
          }),
          fetchScheduledPosts(workspaceId, accessToken, {
            publishStatus: PENDING_STATUSES, status: APPROVED_STATUSES, limit: 120,
          }),
          // `from` alone, with no `to`: everything still ahead of us. Passing
          // from also flips the ordering to scheduled_publish_at ascending,
          // which is exactly the order the strip wants — soonest first.
          fetchScheduledPosts(workspaceId, accessToken, {
            from: nowISO, publishStatus: ['scheduled', 'publishing'], limit: UPCOMING_LIMIT,
          }),
        ])
        if (cancelled || latest.current !== wantKey) return
        setPosts(booked)
        setUpcoming(next)
        // Filtered again here rather than trusting the query alone: `status`
        // is blank on older rows, and needsAttention is the one rule the
        // sidebar badge uses too. Two surfaces disagreeing about how many
        // posts need you is worse than either number being slightly stale.
        setPending(unbooked.filter(p => needsAttention(p)))
        setError('')
        setHaveKey(wantKey)
      } catch (err) {
        if (cancelled || latest.current !== wantKey) return
        setError(err.message || 'Could not load the calendar.')
        // Marked loaded even on failure: otherwise the spinner never stops and
        // the error message sits underneath one forever.
        setHaveKey(wantKey)
      }
    })()

    return () => { cancelled = true }
  }, [ready, wantKey, workspaceId, accessToken, from, to])

  // Called from event handlers, where setting state is exactly right.
  const reload = useCallback(() => setNonce(n => n + 1), [])

  // ── Give a post a slot, or change the one it has ────────────────────────
  //
  // Never optimistic. Booking is a real outward action — Zernio has to accept
  // the slot, and re-booking cancels an existing one first — so painting the
  // new time before the workflow has agreed to it would recreate exactly the
  // split brain this page exists to show. The chip goes pending instead, and
  // the refetch after is what paints.
  const book = useCallback(async (post, dateKey, time) => {
    setPendingId(post.id)
    const res = await bookPostAt({ post, dateKey, time, accounts, workspaceId })
    setPendingId('')
    if (!res.error) reload()
    return res
  }, [accounts, workspaceId, reload])

  // Clear a booked slot. The post does not disappear — it drops back into the
  // strip, where it is visibly waiting on a person rather than silently gone.
  const cancel = useCallback(async (post) => {
    setPendingId(post.id)
    const res = await unschedulePost({ accessToken, post, webhooks, workspaceId })
    setPendingId('')
    if (!res.error) reload()
    return res
  }, [accessToken, webhooks, workspaceId, reload])

  return {
    // Emptiness is derived rather than stored, so the previous workspace's
    // rows can never render for a frame under a new workspace's heading.
    posts:    ready ? posts    : [],
    pending:  ready ? pending  : [],
    upcoming: ready ? upcoming : [],
    loading, error, pendingId, reload, book, cancel,
  }
}
