import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchWebsiteSearch } from '../../lib/websiteSearch'
import { searchSummary, seoRecommendations, pagePerformance } from '../../lib/seoAdvice'

// ─── Search Console, fetched once for the whole page ───────────────────────
//
// Lifted out of WebsiteCard when the priority list started needing the same
// answer. Two components calling this independently would mean two Search
// Console round trips on every dashboard visit — Google's, not ours, and the
// slowest call on the page.
//
// The derived values live here too, so the card and the list cannot compute
// "urgent" differently from the same rows.

export function useWebsiteSearch() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  // Deferred a tick, like every other first fetch in this app: the loading
  // flag is set before the first await, and writing state from an effect BODY
  // is a cascading render React flags.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(async () => {
      if (cancelled) return
      setLoading(true)
      const res = await fetchWebsiteSearch(activeWorkspaceId, accessToken)
      if (cancelled) return
      setData(res)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  const usable = data?.ok && data.configured

  return {
    data,
    loading,
    summary: useMemo(() => (usable ? searchSummary(data) : null), [data, usable]),
    recommendations: useMemo(() => (usable ? seoRecommendations(data) : []), [data, usable]),
    pages: useMemo(() => (usable ? pagePerformance(data.pages || []) : []), [data, usable]),
  }
}
