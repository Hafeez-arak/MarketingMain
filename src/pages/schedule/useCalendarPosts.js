import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchScheduledPosts, movePost, unschedulePost, moveKindFor } from '../../lib/scheduledPosts'
import { brandWallToUtcISO } from '../../lib/brandTime'

// ─── The calendar's data ───────────────────────────────────────────────────
// Two queries, because they are two genuinely different question shapes and a
// range filter cannot answer both: everything with a slot inside the visible
// window, and everything movable that has no slot at all (the staging tray you
// drag FROM). A NULL scheduled_publish_at fails both gte and lte, so the tray
// can never fall out of a widened range.

const TRAY_STATUSES = ['not_published', 'failed']

export function useCalendarPosts({ workspaceId, accessToken, from, to, webhooks }) {
  const [posts, setPosts]         = useState([])
  const [tray, setTray]           = useState([])
  const [error, setError]         = useState('')
  const [pendingId, setPendingId] = useState('')
  const [nonce, setNonce]         = useState(0)

  const ready = !!(workspaceId && accessToken && from && to)

  // What we currently want on screen, as one comparable value. `nonce` is in
  // here so an explicit reload after a move re-fetches the same window.
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
        const [scheduled, unscheduled] = await Promise.all([
          fetchScheduledPosts(workspaceId, accessToken, { from, to }),
          fetchScheduledPosts(workspaceId, accessToken, {
            unscheduled: true, publishStatus: TRAY_STATUSES, limit: 60,
          }),
        ])
        if (cancelled || latest.current !== wantKey) return
        setPosts(scheduled)
        setTray(unscheduled)
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

  // Move a post to a brand-time slot.
  //
  // Optimistic, but ONLY on the local path. A Zernio move has to cancel and
  // re-book at the platform, which genuinely can fail, and painting the new
  // time before Zernio has agreed to it is the same split-brain this whole
  // change set exists to remove. So local moves paint immediately; Zernio
  // moves show a pending chip and paint when the server confirms.
  const move = useCallback(async (post, dateKey, time) => {
    const plan = moveKindFor(post)
    if (plan.kind === 'blocked') return { error: plan.reason }

    const whenISO = brandWallToUtcISO(dateKey, time)
    if (!whenISO) return { error: `Not a valid slot: ${dateKey} ${time}` }

    const prevPosts = posts
    const prevTray  = tray
    if (plan.kind === 'local') {
      setPosts(prev => [...prev.filter(p => p.id !== post.id), { ...post, scheduled_publish_at: whenISO }])
      setTray(prev => prev.filter(p => p.id !== post.id))
    }
    setPendingId(post.id)

    const res = await movePost({ accessToken, post, dateKey, time, webhooks, workspaceId })
    setPendingId('')

    if (res.error) {
      // Put the world back exactly as it was, then let the caller say why.
      setPosts(prevPosts)
      setTray(prevTray)
      return res
    }
    // Refetch rather than trusting the optimistic copy: the workflow may also
    // have changed publish_status and zernio_post_id, and a chip still reading
    // "Scheduled" over a row that now says "failed" is worse than a flicker.
    reload()
    return res
  }, [posts, tray, accessToken, webhooks, workspaceId, reload])

  const unschedule = useCallback(async (post) => {
    setPendingId(post.id)
    const res = await unschedulePost({ accessToken, post, webhooks, workspaceId })
    setPendingId('')
    if (!res.error) reload()
    return res
  }, [accessToken, webhooks, workspaceId, reload])

  return {
    // Emptiness is derived rather than stored, so the previous workspace's
    // rows can never render for a frame under a new workspace's heading.
    posts: ready ? posts : [],
    tray:  ready ? tray  : [],
    loading, error, pendingId, reload, move, unschedule,
  }
}
