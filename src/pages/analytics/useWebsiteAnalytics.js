import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchWebsiteAnalytics, fetchIndexHealth, fetchWebsiteExplanation } from '../../lib/websiteSearch'
import { resolveRange } from '../../lib/dateRange'
import { seoRecommendations } from '../../lib/seoAdvice'
import {
  websiteSummary, dailySeries, searchTypes, positionBands, pageRows, hostSplit,
  queryRows, countryRows, deviceRows, appearanceRows, sitemapHealth, queryCoverage,
  imageSearch,
} from '../../lib/analytics/websiteAnalytics'
import { explainFacts } from '../../lib/agent/websiteExplain'
import { ga4Summary, platformArrivals, arrivalsSummary } from '../../lib/agent/ga4'

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
//
// ── THE TWO THINGS THAT ARE NOT FETCHED HERE ON MOUNT ──
//
// Index health (about forty seconds and up to 120 Google calls) and the
// written explanation (about two cents of somebody's monthly cap) are both
// asked for by a person pressing a button. Their state lives in this hook
// rather than in the panels, so that `WebsiteAnalytics` stays a pure function
// of its props and the whole tab can still be rendered against a recorded
// payload with no network, no auth and no workspace — which is the only way
// its loading and failure states have ever been verifiable.
//
// Both are cleared when the window changes. An explanation of the last 28
// days sitting above a chart of the last 7 is worse than no explanation: it
// is confidently about a period nobody is looking at.

export function useWebsiteAnalytics() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [range, setRange] = useState({ days: 28 })
  // One comparable string: `range` is an object, and depending on it directly
  // would refetch Search Console and GA4 on every render of the tab.
  const rangeKey = range.from && range.to ? `${range.from}..${range.to}` : `d${range.days}`
  // What index health and the explanation are stamped against — a custom
  // from/to range has no `.days` of its own, so this resolves it the same
  // way the fetch itself does rather than assuming a preset was chosen.
  const days = resolveRange(range).days
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // ── The two on-demand answers, stamped with what they are about ──
  //
  // A window change has to invalidate both: an explanation of the last 28
  // days sitting above a chart of the last 7 is worse than no explanation,
  // because it is confidently about a period nobody is looking at. Index
  // health is not about a period, but it was ordered by the pages that earned
  // impressions in the old one.
  //
  // The invalidation is a STAMP CHECKED ON RENDER rather than an effect that
  // resets state. Clearing it from an effect body is the cascading render
  // React (and this repo's lint) rejects, and it would also paint one frame
  // of a stale answer under the new window before the reset landed.
  const IDLE_INDEX = { state: 'idle', data: null, error: '', forDays: 0, forWorkspace: '' }
  const IDLE_EXPLAIN = { state: 'idle', points: [], error: '', cost: 0, capped: false, forDays: 0, forWorkspace: '' }
  const [indexState, setIndex] = useState(IDLE_INDEX)
  const [explainState, setExplain] = useState(IDLE_EXPLAIN)
  const current = s => (s.forDays === days && s.forWorkspace === activeWorkspaceId)
  const index = current(indexState) ? indexState : IDLE_INDEX
  const explain = current(explainState) ? explainState : IDLE_EXPLAIN

  // A slow answer for a previously chosen window must not land on top of the
  // one now chosen — the same guard AccountAnalytics uses for accounts.
  const seq = useRef(0)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!activeWorkspaceId || !accessToken) return
    const n = ++seq.current
    if (quiet) setRefreshing(true); else setLoading(true)
    const res = await fetchWebsiteAnalytics(activeWorkspaceId, accessToken, range)
    if (n !== seq.current) return
    setData(res)
    setLoading(false)
    setRefreshing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, accessToken, rangeKey])

  // Deferred a tick, like every other first fetch in this app: `load` flips a
  // loading flag before its first await, and writing state from an effect BODY
  // is a cascading render React flags.
  useEffect(() => { queueMicrotask(() => load()) }, [load])



  const search = data?.search || null
  const ga4 = data?.ga4 || null
  // The bio link: GA4's arrivals on one side, Instagram's taps on the other.
  // Two sources, so it arrives as its own object rather than inside `ga4`.
  const bio = data?.bio || null
  const usable = !!search?.ok && !!search?.configured

  // Social sessions per platform. Read twice — by the panel and by its own
  // summary line — so it is derived once here, like `allQueries` below.
  const arrivals = useMemo(() => platformArrivals(ga4?.social || []), [ga4])

  // Full-length query rows: the one derivation read by more than one panel.
  const allQueries = useMemo(
    () => (usable ? queryRows(search.queries, search.pages, search.brandTerms, { limit: 10_000 }) : []),
    [usable, search],
  )

  const summary = useMemo(() => (usable ? websiteSummary(search) : null), [usable, search])
  const coverage = useMemo(() => (usable ? queryCoverage(search.queries, search.types) : null), [usable, search])
  const types = useMemo(() => (usable ? searchTypes(search.types) : []), [usable, search])
  const bands = useMemo(() => (usable ? positionBands(allQueries) : []), [usable, allQueries])
  const pagesRows = useMemo(
    () => (usable ? pageRows(search.pageTotals, search.previousPageTotals, { limit: 15 }) : []),
    [usable, search],
  )
  const sitemaps = useMemo(
    () => (search?.sitemaps ? sitemapHealth(search.sitemaps, { site: search.site }) : []),
    [search],
  )
  // Image search in words. `lines` travels with the payload because the
  // brand's own business vocabulary is what decides whether a query is about
  // something we sell — see imageSearch()'s note on what `unrelated` claims.
  const image = useMemo(
    () => (usable ? imageSearch({
      imageQueries: search.imageQueries, imagePages: search.imagePages,
      brandTerms: search.brandTerms, lines: search.lines, types: search.types,
    }) : null),
    [usable, search],
  )

  // Exactly what the model is shown, built from the same memoised rows the
  // panels render. Computed here — not in the route, and not in the panel —
  // so the sentence and the tile can only ever be reading the same numbers.
  const facts = useMemo(() => (usable ? explainFacts({
    summary, coverage, types, image,
    windowDays: search?.windows?.days || days,
    site: search?.site || '',
    queries: allQueries.slice(0, 25),
    pages: pagesRows,
    bands,
    sitemap: sitemaps[0] || null,
    index: index.data?.health || null,
  }) : null), [usable, summary, coverage, types, image, search, days, allQueries, pagesRows, bands, sitemaps, index.data])

  const runIndexHealth = useCallback(async () => {
    if (!activeWorkspaceId || !accessToken) return
    const stamp = { forDays: days, forWorkspace: activeWorkspaceId }
    setIndex({ ...stamp, state: 'loading', data: null, error: '' })
    const res = await fetchIndexHealth(activeWorkspaceId, accessToken)
    setIndex(res?.ok
      ? { ...stamp, state: 'done', data: res, error: '' }
      : { ...stamp, state: 'error', data: res || null, error: res?.error || 'The check did not finish.' })
  }, [activeWorkspaceId, accessToken, days])

  const runExplain = useCallback(async () => {
    if (!activeWorkspaceId || !accessToken || !facts) return
    const stamp = { forDays: days, forWorkspace: activeWorkspaceId }
    setExplain(e => ({ ...e, ...stamp, state: 'loading', error: '' }))
    const res = await fetchWebsiteExplanation(activeWorkspaceId, accessToken, facts)
    setExplain({
      ...stamp,
      state: res?.ok ? 'done' : 'error',
      points: res?.points || [],
      error: res?.ok ? '' : (res?.error || 'The explanation could not be generated.'),
      cost: res?.cost || 0,
      capped: !!res?.capped,
    })
  }, [activeWorkspaceId, accessToken, facts, days])

  return {
    range,
    setRange,
    days,
    loading,
    refreshing,
    refresh: () => load({ quiet: true }),
    error: data && data.ok === false ? (data.error || 'The server did not answer.') : '',

    search,
    ga4,
    bio,
    usable,

    summary,
    daily: useMemo(() => (usable ? dailySeries(search.daily, search.windows) : []), [usable, search]),
    types,
    bands,
    coverage,
    queries: useMemo(() => allQueries.slice(0, 25), [allQueries]),
    pages: pagesRows,
    hosts: useMemo(() => (usable ? hostSplit(search.pageTotals, search.site) : []), [usable, search]),
    countries: useMemo(() => (usable ? countryRows(search.countries, { limit: 10 }) : []), [usable, search]),
    devices: useMemo(() => (usable ? deviceRows(search.devices, search.previousDevices) : []), [usable, search]),
    appearance: useMemo(() => (usable ? appearanceRows(search.appearance) : []), [usable, search]),
    sitemaps,
    // The advice the dashboard card shows, computed by the same function from
    // the same rows — so the two screens cannot rank the same week differently.
    recommendations: useMemo(
      () => (usable ? seoRecommendations({ ...search, limit: 10 }) : []),
      [usable, search],
    ),
    // Social arrivals, per platform, derived once here for the same reason as
    // everything else on this page: the panel and its summary line must count
    // the same rows.
    arrivals,
    arrivalsSummary: useMemo(() => arrivalsSummary(arrivals), [arrivals]),
    ga4Summary: useMemo(
      () => (ga4?.ok && ga4?.configured ? ga4Summary(ga4) : null),
      [ga4],
    ),

    // Image search, in words rather than as one total.
    image,

    // The two the reader asks for. Each carries its own state, because
    // "not asked for yet" and "asked for and failed" are different panels.
    index,
    runIndexHealth,
    explain,
    runExplain,
    canExplain: !!facts,
  }
}
