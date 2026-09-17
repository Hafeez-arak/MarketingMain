import { useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchScheduledPosts } from '../../lib/scheduledPosts'
import { queueBucket } from '../../lib/postLock'

// ─── The post queue, fetched once for the whole page ───────────────────────
//
// Lifted out of Queue.jsx so the priority list at the top of the dashboard and
// the cards at the bottom read one answer rather than two — and so Queue.jsx
// exports only components, which is what Fast Refresh needs.

/** How far ahead "going out next" looks. */
export const DAYS_AHEAD = 14

const TRAY_STATUSES = ['not_published', 'failed']

/**
 * Both lists in one fetch pass.
 *
 * Two queries rather than one, for the reason the calendar needs two: a post
 * with no slot has `scheduled_publish_at = NULL`, and NULL fails both `gte`
 * and `lte`, so no single range can return the stuck ones alongside the
 * booked ones however wide it is opened.
 */
export function useQueue() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [state, setState] = useState({ upcoming: [], attention: [], loading: true })

  // Deferred a tick, like every other first fetch in this app: both branches
  // write state, and doing that from an effect BODY is a cascading render.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(async () => {
      if (cancelled) return
      if (!activeWorkspaceId || !accessToken) {
        setState({ upcoming: [], attention: [], loading: false })
        return
      }
      setState(s => ({ ...s, loading: true }))
      const now = new Date()
      const to = new Date(now.getTime() + DAYS_AHEAD * 86_400_000)
      const [booked, tray] = await Promise.all([
        fetchScheduledPosts(activeWorkspaceId, accessToken, {
          from: now.toISOString(), to: to.toISOString(), limit: 40,
        }),
        fetchScheduledPosts(activeWorkspaceId, accessToken, {
          unscheduled: true, publishStatus: TRAY_STATUSES, limit: 40,
        }),
      ])
      if (cancelled) return
      setState({
        // `queueBucket` rather than the raw status: a post whose slot has just
        // passed is already gone, and listing it as "upcoming" would be the
        // dashboard telling somebody to wait for something that has happened.
        upcoming: booked.filter(p => queueBucket(p) === 'upcoming'),
        attention: tray,
        loading: false,
      })
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  return state
}
