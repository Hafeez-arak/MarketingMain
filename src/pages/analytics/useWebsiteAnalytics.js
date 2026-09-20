import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchWebsiteAnalytics } from '../../lib/websiteSearch'
import { seoRecommendations } from '../../lib/seoAdvice'
import {
  websiteSummary, dailySeries, searchTypes, positionBands, pageRows, hostSplit,
  queryRows, countryRows, deviceRows, appearanceRows, sitemapHealth, queryCoverage,
} from '../../lib/analytics/websiteAnalytics'
import { ga4Summary } from '../../lib/agent/ga4'

// ─── The Website tab's data, fetched once and derived once ─────────────────
//
// Every number the tab draws comes from one response, so nothing on the screen
// can be computed from a different pull than the panel beside it. The window
// picker refetches rather than re-slicing: Search Console aggregates on its
// side, and a 7-day figure is not a 28-day figure cut down — its average
// position is computed over different rows.
//
// The derivations are memoised here rather than inside the panels because
// several of them are read twice. `queryRows` at full length feeds both the
// table and the position bands, and two components deriving it independently
// would give the bands and the table two different definitions of the same
// row set the first time either changed.

export function useWebsiteAnalytics() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [days, setDays] = useState(28)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // A slow answer for a previously chosen window must not land on top of the
  // one now chosen — the same guard AccountAnalytics uses for accounts.
  const seq = useRef(0)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!activeWorkspaceId || !accessToken) return
    const n = ++seq.current
    if (quiet) setRefreshing(true); else setLoading(true)
    const res = await fetchWebsiteAnalytics(activeWorkspaceId, accessToken, days)
    if (n !== seq.current) return
    setData(res)
    setLoading(false)
    setRefreshing(false)
  }, [activeWorkspaceId, accessToken, days])

  // Deferred a tick, like every other first fetch in this app: `load` flips a
  // loading flag before its first await, and writing state from an effect BODY
  // is a cascading render React flags.
  useEffect(() => { queueMicrotask(() => load()) }, [load])

  const search = data?.search || null
  const ga4 = data?.ga4 || null
  const usable = !!search?.ok && !!search?.configured

  // Full-length query rows: the one derivation read by more than one panel.
  const allQueries = useMemo(
    () => (usable ? queryRows(search.queries, search.pages, search.brandTerms, { limit: 10_000 }) : []),
    [usable, search],
  )

  return {
    days,
    setDays,
    loading,
    refreshing,
    refresh: () => load({ quiet: true }),
    error: data && data.ok === false ? (data.error || 'The server did not answer.') : '',

    search,
    ga4,
    usable,

    summary: useMemo(() => (usable ? websiteSummary(search) : null), [usable, search]),
    daily: useMemo(() => (usable ? dailySeries(search.daily, search.windows) : []), [usable, search]),
    types: useMemo(() => (usable ? searchTypes(search.types) : []), [usable, search]),
    bands: useMemo(() => (usable ? positionBands(allQueries) : []), [usable, allQueries]),
    coverage: useMemo(() => (usable ? queryCoverage(search.queries, search.types) : null), [usable, search]),
    queries: useMemo(() => allQueries.slice(0, 25), [allQueries]),
    pages: useMemo(
      () => (usable ? pageRows(search.pageTotals, search.previousPageTotals, { limit: 15 }) : []),
      [usable, search],
    ),
    hosts: useMemo(() => (usable ? hostSplit(search.pageTotals, search.site) : []), [usable, search]),
    countries: useMemo(() => (usable ? countryRows(search.countries, { limit: 10 }) : []), [usable, search]),
    devices: useMemo(() => (usable ? deviceRows(search.devices, search.previousDevices) : []), [usable, search]),
    appearance: useMemo(() => (usable ? appearanceRows(search.appearance) : []), [usable, search]),
    sitemaps: useMemo(
      () => (search?.sitemaps ? sitemapHealth(search.sitemaps, { site: search.site }) : []),
      [search],
    ),
    // The advice the dashboard card shows, computed by the same function from
    // the same rows — so the two screens cannot rank the same week differently.
    recommendations: useMemo(
      () => (usable ? seoRecommendations({ ...search, limit: 10 }) : []),
      [usable, search],
    ),
    ga4Summary: useMemo(
      () => (ga4?.ok && ga4?.configured ? ga4Summary(ga4) : null),
      [ga4],
    ),
  }
}
