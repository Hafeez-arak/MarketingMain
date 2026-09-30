import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { fetchScheduledPosts } from './scheduledPosts'

// ─── One platform's posts, for the TikTok and LinkedIn pages ───────────────
// Those pages used to count only the browser's local store (state.posts),
// which nothing in the real pipeline writes to: a LinkedIn post booked by a
// plan was in the database, on the calendar and in the Post Queue, and its
// own page still said "0 posts". This reads the same scheduled_posts view the
// calendar, the queue and the Instagram page read.
//
// `loaded` is false until the first answer (so the page shows skeletons, not
// "0 posts"), and a failed read is `error`, not an empty list.

export function toPagePost(r) {
  return {
    id: r.id,
    platform: r.platform,
    copy: r.caption || '',
    hashtags: r.hashtags || '',
    // Where the post really is once it has been sent, as the Instagram page
    // shows it; the review status before that.
    status: ['published', 'scheduled', 'publishing', 'failed'].includes(r.publish_status) ? r.publish_status : (r.status || 'draft'),
    scheduledAt: r.scheduled_publish_at || r.scheduled_date || null,
    campaignId: r.campaign_id || null,
    mediaUrls: (r.image_urls && r.image_urls.length) ? r.image_urls : [r.image_url].filter(Boolean),
    createdAt: r.created_at,
    _fromSupabase: true,
  }
}

export function usePlatformPosts(platform) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [posts, setPosts] = useState([])
  const [loadedFor, setLoadedFor] = useState(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const key = activeWorkspaceId && accessToken ? `${activeWorkspaceId}|${platform}|${nonce}` : ''

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    fetchScheduledPosts(activeWorkspaceId, accessToken, { platform, limit: 200, throwOnError: true })
      .then(rows => {
        if (cancelled) return
        setPosts(rows.map(toPagePost))
        setError('')
        setLoadedFor(key)
      })
      .catch(err => {
        if (cancelled) return
        setError(String(err?.message || err))
        setLoadedFor(key)
      })
    return () => { cancelled = true }
  }, [key, activeWorkspaceId, accessToken, platform])

  const reload = useCallback(() => setNonce(n => n + 1), [])
  // Loaded once anything has answered for this workspace: a reload keeps the
  // list on screen rather than dropping back to skeletons.
  const loaded = Boolean(loadedFor && loadedFor.startsWith(`${activeWorkspaceId}|${platform}|`))
  return { posts, loaded, error, reload }
}
