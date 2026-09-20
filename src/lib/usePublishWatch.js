import { useEffect, useRef } from 'react'
import { useApp } from '../store/app'
import { useAuth } from '../store/auth'
import { fetchScheduledPosts } from './scheduledPosts'
import { recordPublished } from './publishSeen'
import { formatBrandDateTime } from './brandTime'
import { PLATFORM_META } from './utils'

// ─── "Tell me when it's published" ─────────────────────────────────────────
// Mounted once, at the layout, so a post that goes out while you are on
// Analytics still reaches the bell. Nothing pushes to this app — Zernio
// publishes on its own schedule and the workflow writes the row — so the only
// honest way to notice is to look, and this polls.
//
// It asks a deliberately small question: rows whose published_at is newer than
// the last one we saw. That is a handful of rows on a normal day and zero on
// most polls, rather than re-reading the month to diff it.
//
// publishSeen decides what is actually NEW: the first poll for a workspace
// records everything already out as history and announces nothing, because
// signing in should not produce forty notifications about last month.

const POLL_MS = 90_000        // Zernio's own publish is not to the second;
                              // a minute and a half is well inside "I noticed".
const LOOKBACK_MS = 36 * 60 * 60 * 1000   // first poll of a session looks back
                                          // far enough to cover an overnight run

const textOf = p => (p.caption || p.topic || p.hook || '').replace(/\s+/g, ' ').trim()

export function usePublishWatch() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const { dispatch } = useApp()

  // The newest published_at already folded in. Kept in a ref rather than state
  // so advancing it never re-renders the whole app — nothing on screen depends
  // on the watermark itself, only on what it let through.
  const sinceRef = useRef('')

  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return
    // A workspace switch is a different history; start its watermark fresh or
    // the new workspace inherits the old one's high-water mark and misses rows.
    sinceRef.current = ''
    let cancelled = false

    async function poll() {
      const since = sinceRef.current || new Date(Date.now() - LOOKBACK_MS).toISOString()
      let rows
      try {
        rows = await fetchScheduledPosts(activeWorkspaceId, accessToken, {
          publishStatus: 'published',
          publishedSince: since,
          order: 'published_at.desc',
          limit: 40,
        })
      } catch { return }   // offline, or a bad token mid-refresh. Try again next tick.
      if (cancelled || !rows?.length) return

      // Advance the watermark BEFORE announcing, and off the rows themselves
      // rather than the clock: a row written with a slightly skewed timestamp
      // still moves us forward exactly as far as we have actually read.
      for (const r of rows) {
        if (r.published_at && r.published_at > sinceRef.current) sinceRef.current = r.published_at
      }

      const fresh = recordPublished(activeWorkspaceId, rows)
      if (cancelled) return
      for (const post of fresh) {
        const label = PLATFORM_META[post.platform]?.label || post.platform || 'A post'
        const text = textOf(post)
        dispatch({
          type: 'ADD_NOTIFICATION',
          payload: {
            id: `published-${post.id}`,
            kind: 'published',
            postId: post.id,
            message: `Published to ${label}${text ? ` — “${text.slice(0, 70)}${text.length > 70 ? '…' : ''}”` : ''}`
              + (post.published_at ? ` at ${formatBrandDateTime(post.published_at)}` : ''),
            createdAt: post.published_at || new Date().toISOString(),
          },
        })
      }
    }

    // Deferred a tick, like every other first-load effect here: dispatching
    // synchronously from an effect body is a cascading render.
    queueMicrotask(() => { if (!cancelled) void poll() })
    const id = setInterval(() => { void poll() }, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // `dispatch` from useReducer is stable for the life of the provider, so
    // naming it here does not restart the poller on every render.
  }, [activeWorkspaceId, accessToken, dispatch])
}
