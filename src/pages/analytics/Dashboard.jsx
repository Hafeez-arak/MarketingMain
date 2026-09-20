import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import { Card, Button, PlatformPill, Empty, PostImage, IconBadge, PillSelect, Skeleton } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { BestTimeHeatmap, MetricToggle } from './charts'
import { MetricLabel, MetricInfoDot, ScopeBanner } from '../../components/analytics/MetricLabel'
import { fmt, pct, windowLabel, foldFollowers } from './format'
// The one definition of engagement rate, imported rather than restated. This
// file used to carry its own copy — identical to dashboardOverview's on the
// day it was written, and with nothing but good intentions keeping it that
// way. Two rates that disagree by a tenth on two screens is a bug report
// nobody can close, so there is now only one of them to edit.
import { engagementRate } from '../../lib/dashboardOverview'
import { platformEngagementRate } from '../../lib/analytics/engagementSource'

// ─── The Analytics graphs, drawn from one Zernio dashboard response ────────
// Shared by /analytics (the workspace view, fed by the Zernio Dashboard n8n
// workflow) and a platform page's Analytics tab (one account, fed by
// /api/zernio/analytics). Both hand over the same response shape:
//   { fromDate, toDate, overview, bestTime, frequency, decay, daily, followers }
// plus, from the per-account route only, `followerHistory`.
//
// `perPlatform={false}` drops the charts that compare platforms. On a single
// account's page every one of them is a single bar.

const METRIC_OPTIONS = [
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'views', label: 'Views' },
  { key: 'impressions', label: 'Impressions' },
  { key: 'reach', label: 'Reach' },
  { key: 'clicks', label: 'Clicks' },
]
const LINE_COLORS = { likes: '#e0687a', comments: '#657b81', shares: '#a3bf97', saves: '#c9a35e', views: '#7d98a1', impressions: '#4c5e61', reach: '#325130', clicks: '#9ea3aa' }
// `impressions` deliberately absent: Instagram has not reported it since
// Graph v22, so defaulting a line to it draws a flat zero on first load.
const DEFAULT_LINE_METRICS = ['likes', 'comments', 'views', 'reach']
const METRIC_TONE = { likes: 'rose', comments: 'steel', shares: 'sage', saves: 'steel', views: 'steel', impressions: 'steel', reach: 'sage', clicks: 'steel' }
const metricIcon = key => ({
  likes: Icon.heart, comments: Icon.message, shares: Icon.trending, saves: Icon.document,
  views: Icon.eye, impressions: Icon.activity, reach: Icon.users, clicks: Icon.trending,
}[key] || Icon.activity)

// Monday-start week bucket key (YYYY-MM-DD of that week's Monday).
function weekOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // 0=Mon .. 6=Sun
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}
const shortDate = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Every Monday from fromDate's week through toDate's week, inclusive — the
// full x-axis scaffold. Without this, a chart with data on only one real
// week has nothing to build up FROM: Zernio's own charts owe their "flat,
// then rises" shape entirely to zero-filled weeks earlier in the range: a
// chart that only plots weeks with data literally can't draw that curve,
// no matter how the line itself is styled.
function weeksInRange(fromDate, toDate) {
  if (!fromDate || !toDate) return []
  const weeks = []
  let cur = weekOf(fromDate)
  const end = weekOf(toDate)
  let guard = 0
  while (cur <= end && guard++ < 60) {
    weeks.push(cur)
    const d = new Date(`${cur}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 7)
    cur = d.toISOString().slice(0, 10)
  }
  return weeks
}

const ZERO_METRICS = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0 }

const EMPTY = []

// `metric` is a key into src/lib/analytics/metricInfo.js. A chart whose title
// alone doesn't say what it plots — "Engagement accumulation", "Posting
// frequency vs engagement" — passes one and gets an ⓘ beside the heading.
export function ChartCard({ title, subtitle, total, right, icon, tone, metric, children }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5">
          {icon && <IconBadge tone={tone}>{icon}</IconBadge>}
          <div>
            <h3 className="font-semibold text-text text-sm leading-tight flex items-center gap-1.5">
              {title}
              <MetricInfoDot metric={metric} label={title} />
            </h3>
            {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {right}
          {total !== undefined && (
            <div className="text-right">
              <p className="text-lg font-bold text-text leading-none">{total}</p>
            </div>
          )}
        </div>
      </div>
      {children}
    </Card>
  )
}

// Stands in for the KPI strip and the first row of charts until a response
// exists. AnalyticsDashboard drawn over no response prints "0.0%" and
// "0 followers" — which reads as an account with no audience, not as a page
// that is still loading.
export function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading analytics">
      <Card className="overflow-hidden">
        {/* Stands in for the ScopeBanner too. Without it the strip grows a
            36px band the moment the answer lands, and the whole page below
            jumps down by that much. */}
        <div className="px-5 py-2.5 bg-surface-subtle border-b border-border">
          <Skeleton className="h-3 w-56" />
        </div>
        {/* Four, matching the strip's widest real form — engagement rate,
            followers, posts, best post. A LinkedIn page settles to three,
            because its rate lives in LinkedIn's own strip above. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="p-5">
              <Skeleton className="h-3 w-20 mb-2.5" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <Card key={i} className="p-5">
            <div className="flex items-start gap-2.5 mb-4">
              <Skeleton className="w-7 h-7" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
            </div>
            <Skeleton className="h-[220px] w-full" />
          </Card>
        ))}
      </div>
    </div>
  )
}

const axisTick = { fontSize: 11, fill: '#7a848c' }

// A table heading that can explain itself. Both tables abbreviate — "Impr.",
// "ER" — and an abbreviation is exactly the case where a reader needs the
// definition and has nowhere to get it. `align` because only the first column
// of each table is left-aligned.
// Class names are written out rather than interpolated: Tailwind generates
// only the literals it finds in the source, and a `text-${align}` would
// compile to nothing the day the last hard-coded `text-left` is deleted.
function Th({ metric, label, align = 'right' }) {
  const right = align === 'right'
  return (
    <th className={`${right ? 'text-right' : 'text-left'} px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary`}>
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        <MetricInfoDot metric={metric} label={label} />
        {label}
      </span>
    </th>
  )
}

const alertIcon = <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>

export function AnalyticsDashboard({ dash, days, accountId = '', onRetry, perPlatform = true }) {
  const navigate = useNavigate()
  const [barMetric, setBarMetric] = useState('likes')
  const [lineMetrics, setLineMetrics] = useState(() => new Set(DEFAULT_LINE_METRICS))

  function toggleLineMetric(key) {
    setLineMetrics(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Derive everything from the dashboard response ───────────────────────
  // Each key is fetched independently server-side so one add-on hiccuping —
  // rate limit, 402, timeout — doesn't blank the whole page. But `overview`
  // failing to load must not be silently read as "zero posts": those are
  // different states the user needs to tell apart, so surface it explicitly
  // instead of falling back.
  //
  // Which metric switches to show at all. Instagram reports neither
  // impressions (removed in Graph v22, superseded by views) nor any per-media
  // click metric, so those two can only ever read 0 — and a permanently-zero
  // toggle on a dashboard reads as a broken integration rather than as a
  // measurement the platform does not take. The server says what it can
  // fill; absent that, show everything, which is the old behaviour.
  const supported = dash?.metricsSupported
  const metricOptions = useMemo(
    () => (Array.isArray(supported) && supported.length
      ? METRIC_OPTIONS.filter(m => supported.includes(m.key))
      : METRIC_OPTIONS),
    [supported],
  )

  // The post table follows the same rule as the toggles. `shown` keeps a
  // column unless the server said the platform cannot fill it; `listed`
  // shows one only when the server said it can — for clicks, which only
  // LinkedIn reports, and which would otherwise be a column of zeros.
  const shown = key => !Array.isArray(supported) || !supported.length || supported.includes(key)
  const listed = key => Array.isArray(supported) && supported.includes(key)
  const overviewError = dash?.overview?._error || null
  const posts = dash?.overview?.posts || EMPTY
  const overviewMeta = dash?.overview?.overview || {}
  const zAccounts = dash?.overview?.accounts || EMPTY
  const hasAnalyticsAccess = dash?.overview?.hasAnalyticsAccess !== false
  const platformBreakdownRaw = dash?.daily?.platformBreakdown || EMPTY
  const dailyRows = dash?.daily?.dailyData || EMPTY
  const bestTimeSlots = dash?.bestTime?.slots || EMPTY
  const frequencyRows = dash?.frequency?.frequency || EMPTY
  const decayBuckets = [...(dash?.decay?.buckets || EMPTY)].sort((a, b) => a.bucket_order - b.bucket_order)

  // Follower history, from whichever source has points. follower-stats is
  // cross-platform; Instagram's own follower-history is the per-account
  // route's second source. Both are filled by Zernio's DAILY snapshotter, so
  // an account connected today has neither until tomorrow.
  // ── WHICHEVER SOURCE HAS MORE HISTORY, NOT WHICHEVER ANSWERED ──
  //
  // This used to take follower-stats whenever it returned anything at all and
  // only fall back to Instagram's own follower-history when it was empty. The
  // two are filled by different pipelines on the same daily clock, so the one
  // that answers first is not the one with the most behind it: a
  // single-point follower-stats would hide a sixty-point history and the
  // chart would show one day inside a ninety-day window.
  //
  // Measured 2026-09-20: both currently hold six days (15–20 Sept) for both
  // connected accounts, and asking for 7, 30 or 90 days returns the same six
  // — Zernio has no follower snapshots before the accounts were connected.
  // No window setting can produce history that was never recorded.
  const followerRows = useMemo(() => {
    const stats = dash?.followers?.stats || {}
    const fromStats = accountId ? (stats[accountId] || []) : Object.values(stats).flat()
    const fromHistory = (dash?.followerHistory?.metrics?.follower_count?.values || [])
      .map(v => ({ date: v.date, followers: v.value }))
    return fromHistory.length > fromStats.length ? fromHistory : fromStats
  }, [dash?.followers?.stats, dash?.followerHistory, accountId])

  // What the series actually covers, which is not what the picker asked for.
  const followerSpan = useMemo(() => {
    if (!followerRows.length) return ''
    const first = followerRows[0]?.date
    const last = followerRows[followerRows.length - 1]?.date
    const n = followerRows.length
    return `${n} day${n === 1 ? '' : 's'} recorded · ${first}${first === last ? '' : ` to ${last}`}`
  }, [followerRows])

  const totals = useMemo(() => {
    const acc = { ...ZERO_METRICS }
    for (const p of posts) { const a = p.analytics || {}; for (const k of Object.keys(acc)) acc[k] += a[k] || 0 }
    return acc
  }, [posts])

  const overallEngagementRate = useMemo(() => engagementRate(totals) ?? 0, [totals])

  // Whether THIS strip draws the engagement rate, or leaves it to the
  // platform's own strip above. LinkedIn publishes a rate and Instagram does
  // not, so on a LinkedIn page the tile below is absent and the only rate on
  // screen is LinkedIn's own; on Instagram it is the only rate on screen and
  // it is ours. Either way: exactly one.
  const ourRateShown = platformEngagementRate(dash) === null

  // Zernio omits followersCount until its first daily snapshot, and the
  // follower-stats and history endpoints fill on the same clock — so take
  // the best any of them has rather than trusting one.
  //
  // null, not 0, when NONE of the three has anything. Every source reports an
  // uncounted account as zero: `followersCount: null`, and follower-stats
  // returns `currentFollowers: 0` beside `dataPoints: 0` and an empty series —
  // a default computed over no observations. Folding those with `|| 0` and
  // Math.max produced a confident "0" in the KPI tile, which reads as an
  // account with no audience rather than one nobody has counted yet.
  //
  // `dataPoints` is the discriminator, and it is why this cannot be done by
  // looking at the number alone: an account genuinely at zero followers has
  // snapshots behind it and must still read as 0.
  const totalFollowers = useMemo(() => {
    const scoped = a => !accountId || a._id === accountId
    return foldFollowers(
      zAccounts.filter(scoped),
      (dash?.followers?.accounts || []).filter(scoped),
      followerRows,
    )
  }, [zAccounts, dash?.followers?.accounts, followerRows, accountId])

  const bestPost = useMemo(() => {
    const withEr = posts.map(p => ({ ...p, _er: p.analytics?.engagementRate ?? engagementRate(p.analytics) ?? -1 }))
    withEr.sort((a, b) => b._er - a._er)
    return withEr[0] || null
  }, [posts])

  const postsPerPlatform = useMemo(() => {
    const m = new Map()
    for (const p of posts) m.set(p.platform, (m.get(p.platform) || 0) + 1)
    return [...m.entries()].map(([platform, count]) => ({ platform, count }))
  }, [posts])

  const rangeWeeks = useMemo(() => weeksInRange(dash?.fromDate, dash?.toDate), [dash?.fromDate, dash?.toDate])

  const postsOverTime = useMemo(() => {
    const m = new Map(rangeWeeks.map(wk => [wk, 0]))
    for (const p of posts) {
      const wk = weekOf((p.publishedAt || '').slice(0, 10))
      m.set(wk, (m.get(wk) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([wk, count]) => ({ week: shortDate(wk), count }))
  }, [posts, rangeWeeks])

  const metricPerPlatform = useMemo(() =>
    platformBreakdownRaw.map(r => ({ platform: r.platform, value: r[barMetric] || 0 }))
  , [platformBreakdownRaw, barMetric])

  const weeklyBuckets = useMemo(() => {
    const m = new Map(rangeWeeks.map(wk => [wk, { week: wk, ...ZERO_METRICS }]))
    for (const r of dailyRows) {
      const wk = weekOf(r.date)
      if (!m.has(wk)) m.set(wk, { week: wk, ...ZERO_METRICS })
      const e = m.get(wk)
      for (const k of Object.keys(ZERO_METRICS)) e[k] += (r.metrics && r.metrics[k]) || 0
    }
    return [...m.values()].sort((a, b) => a.week.localeCompare(b.week)).map(e => ({ ...e, weekLabel: shortDate(e.week) }))
  }, [dailyRows, rangeWeeks])

  const metricOverTime = useMemo(() =>
    weeklyBuckets.map(w => ({ week: w.weekLabel, value: w[barMetric] || 0 }))
  , [weeklyBuckets, barMetric])

  const platformBreakdown = useMemo(() =>
    platformBreakdownRaw.map(r => ({ ...r, er: engagementRate(r) }))
  , [platformBreakdownRaw])

  const topPosts = useMemo(() =>
    [...posts]
      .map(p => ({ ...p, _er: p.analytics?.engagementRate ?? engagementRate(p.analytics) ?? null }))
      .sort((a, b) => (b._er ?? -1) - (a._er ?? -1))
      .slice(0, 8)
  , [posts])

  if (dash?.error) {
    return (
      <Card className="p-6 border-dashed bg-surface-muted">
        <Empty icon={alertIcon} title="Couldn't reach Zernio" description={dash.error} />
      </Card>
    )
  }
  if (!hasAnalyticsAccess) {
    return (
      <Card className="p-6 border-dashed bg-surface-muted">
        <Empty title="Analytics add-on not enabled" description="This Zernio plan doesn't include the analytics add-on yet." />
      </Card>
    )
  }

  const metricLabel = metricOptions.find(m => m.key === barMetric)?.label
  const metricPicker = (
    <PillSelect value={barMetric} onChange={e => setBarMetric(e.target.value)} className="w-28">
      {metricOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
    </PillSelect>
  )

  return (
    <>
      {/* KPI strip — one flat row divided by rules, not boxed cards. Reads as
          a single stat panel rather than a scatter of separate widgets.

          ── WHAT IS DELIBERATELY NOT HERE ──

          "Total reach" used to sit second in this row, and on a platform page
          it landed directly under the platform's own account figures, where it
          contradicted them in plain sight: "Accounts reached 10" above "Total
          reach 16". Both were right — 10 distinct people, and the eight posts'
          reach added together, which counts a person once per post they saw —
          but a summed reach is the one figure a reader will always take for
          the real one. It is gone. The strip above already gives reach, counted
          the way anybody means it.

          The engagement rate is here only when the platform publishes none of
          its own; LinkedIn's sits in the strip above instead. One rate per
          page, whichever one is truest — see lib/analytics/engagementSource.js. */}
      <Card className="overflow-hidden">
        <ScopeBanner
          title="Your posts, added up"
          subtitle="Each post's own numbers added together. Someone who saw several posts is counted once per post."
          right={`${overviewMeta.totalPosts ?? posts.length} post${(overviewMeta.totalPosts ?? posts.length) === 1 ? '' : 's'} · ${windowLabel(dash?.fromDate, dash?.toDate, days).toLowerCase()}`}
        />
        <div className={`grid grid-cols-2 ${ourRateShown ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border`}>
          {ourRateShown && (
            <div className="p-5">
              <MetricLabel metric="post.engagement_rate" label="Engagement rate" className="mb-1.5" />
              <p className="text-2xl font-bold text-text">{pct(overallEngagementRate)}</p>
            </div>
          )}
          <div className="p-5">
            <MetricLabel metric="post.followers" label="Total followers" className="mb-1.5" />
            <p className="text-2xl font-bold text-text flex items-center gap-1.5">
              <span className="text-text-tertiary">{Icon.users}</span>
              {/* An em dash, not a zero. The chart below already says when the
                  first snapshot lands; the tile must not contradict it with a
                  number nobody measured. */}
              {totalFollowers === null
                ? <span className="text-text-tertiary" title="Zernio records followers once a day. A newly connected account has no count until its first snapshot.">—</span>
                : fmt(totalFollowers)}
            </p>
          </div>
          <div className="p-5">
            <MetricLabel metric="post.count" label="Posts this period" className="mb-1.5" />
            <p className="text-2xl font-bold text-text flex items-center gap-1.5">
              <span className="text-text-tertiary">{Icon.document}</span>{overviewMeta.totalPosts ?? posts.length}
            </p>
          </div>
          <div className="p-5">
            <MetricLabel metric="post.best" label="Best post" className="mb-1.5" />
            {bestPost ? (
              <div className="flex items-center gap-2">
                <PostImage src={bestPost.thumbnailUrl} className="w-8 h-8 object-cover flex-shrink-0 border border-border" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text leading-tight">{bestPost._er >= 0 ? pct(bestPost._er) : '—'}</p>
                  {bestPost.platformPostUrl && (
                    <a href={bestPost.platformPostUrl} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-700 hover:underline">View ↗</a>
                  )}
                </div>
              </div>
            ) : <p className="text-2xl font-bold text-text-tertiary">—</p>}
          </div>
        </div>
      </Card>

      {overviewError ? (
        <Card>
          <Empty icon={alertIcon} title="Couldn't load post data" description={overviewError}
            action={onRetry && <Button onClick={onRetry}>Try again</Button>} />
        </Card>
      ) : posts.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
            title="No posts in this window"
            description="Publish a post from the Post Queue, or widen the date range above."
            action={<Button onClick={() => navigate('/social/approvals')}>Go to Post Queue</Button>}
          />
        </Card>
      ) : (
        <>
          {/* Posts and the chosen metric, per platform and over time. A
              single account drops the per-platform half: one bar each. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {perPlatform && (
              <ChartCard title="Posts per platform" subtitle="Top platforms by post count in this window" total={posts.length} icon={Icon.document}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={postsPerPlatform}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                    <XAxis dataKey="platform" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} className="capitalize" />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#657b81" radius={[6, 6, 0, 0]} maxBarSize={56} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            <ChartCard title="Posts over time" subtitle="Posts per week" total={posts.length} icon={Icon.trending} metric="calc.posts_over_time">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={postsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                  <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#657b81" radius={[6, 6, 0, 0]} maxBarSize={56} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            {perPlatform && (
              <ChartCard title={`${metricLabel} per platform`}
                total={fmt(metricPerPlatform.reduce((s, r) => s + r.value, 0))}
                icon={metricIcon(barMetric)} tone={METRIC_TONE[barMetric]}
                right={metricPicker}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={metricPerPlatform}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                    <XAxis dataKey="platform" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill={LINE_COLORS[barMetric] || '#657b81'} radius={[6, 6, 0, 0]} maxBarSize={56} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            <ChartCard title={`${metricLabel} over time`} subtitle="Per week"
              total={perPlatform ? undefined : fmt(totals[barMetric])}
              icon={metricIcon(barMetric)} tone={METRIC_TONE[barMetric]}
              right={perPlatform ? undefined : metricPicker}>
              <ResponsiveContainer width="100%" height={perPlatform ? 200 : 220}>
                <BarChart data={metricOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                  <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill={LINE_COLORS[barMetric] || '#657b81'} radius={[6, 6, 0, 0]} maxBarSize={56} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Engagement over time — multi-metric, legend doubles as
              the metric toggle (Zernio's layout: chart left, a
              grid of icon+value cells right, rather than a plain
              checkbox row stacked above the chart). */}
          <Card className="p-5">
            <div className="flex items-start gap-2.5 mb-5">
              <IconBadge>{Icon.trending}</IconBadge>
              <div>
                <h3 className="font-semibold text-text text-sm leading-tight">Engagement over time</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Per week · last {days} days</p>
              </div>
            </div>
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 min-w-0">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={weeklyBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef1ef" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                    <Tooltip />
                    {metricOptions.filter(m => lineMetrics.has(m.key)).map(m => (
                      <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={LINE_COLORS[m.key]}
                        strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-x-6 gap-y-5 lg:w-56 lg:flex-shrink-0 lg:border-l lg:border-border lg:pl-6">
                {metricOptions.map(m => (
                  <MetricToggle key={m.key} active={lineMetrics.has(m.key)} color={LINE_COLORS[m.key]}
                    icon={metricIcon(m.key)} label={m.label} value={fmt(totals[m.key])}
                    onClick={() => toggleLineMetric(m.key)} />
                ))}
                {/* An engagement rate used to hang off the end of this legend,
                    reading "19%" while the KPI tile 200px above read "18.8%" —
                    one variable, two roundings, and a reader with no way to
                    know it was one number. It is gone rather than rounded to
                    match: everything else in this column is a metric you can
                    toggle a line for, a rate is not, and the page already
                    states its rate once, higher up, where it is read first. */}
              </div>
            </div>
          </Card>

          {/* Best time to post / Follower history */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Best time to post" icon={Icon.clock} metric="calc.best_time">
              <BestTimeHeatmap slots={bestTimeSlots} />
            </ChartCard>
            <ChartCard title="Follower history" icon={Icon.users} tone="sage" metric="calc.follower_history"
              subtitle={followerSpan || undefined}>
              {followerRows.length === 0 ? (
                <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2">
                  <svg className="w-8 h-8 text-text-disabled" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <p className="text-sm font-medium text-text">No data available</p>
                  <p className="text-xs text-text-tertiary">Zernio records followers once a day, so a newly connected account fills in from tomorrow. Reconnecting an account starts the series again.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={followerRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                    <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    {/* Dots below a fortnight of points, and this is not
                        cosmetic: a line through ONE point draws nothing at
                        all, so an account with a single snapshot rendered an
                        empty chart that read as "no followers" rather than as
                        "counted once so far". */}
                    <Line type="monotone" dataKey="followers" stroke="#657b81" strokeWidth={2}
                      dot={followerRows.length <= 14} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* Platform breakdown */}
          {perPlatform && (
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
                <IconBadge>{Icon.grid}</IconBadge>
                <h3 className="font-semibold text-text text-sm">Platform breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <Th metric="calc.platform_breakdown" label="Platform" align="left" />
                      <Th metric="post.count" label="Posts" />
                      <Th metric="post.likes" label="Likes" />
                      <Th metric="post.comments" label="Comments" />
                      <Th metric="post.shares" label="Shares" />
                      <Th metric="post.saves" label="Saves" />
                      <Th metric="post.views" label="Views" />
                      <Th metric="post.impressions" label="Impr." />
                      <Th metric="post.reach" label="Reach" />
                      <Th metric="post.engagement_rate" label="ER" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {platformBreakdown.map(r => (
                      <tr key={r.platform} className="hover:bg-surface-muted transition-colors">
                        <td className="px-5 py-3"><PlatformPill platform={r.platform} /></td>
                        <td className="px-5 py-3 text-right text-text">{r.postCount}</td>
                        <td className="px-5 py-3 text-right text-text">{fmt(r.likes)}</td>
                        <td className="px-5 py-3 text-right text-text">{fmt(r.comments)}</td>
                        <td className="px-5 py-3 text-right text-text-tertiary">{r.shares ? fmt(r.shares) : '–'}</td>
                        <td className="px-5 py-3 text-right text-text-tertiary">{r.saves ? fmt(r.saves) : '–'}</td>
                        <td className="px-5 py-3 text-right text-text">{fmt(r.views)}</td>
                        <td className="px-5 py-3 text-right text-text">{fmt(r.impressions)}</td>
                        <td className="px-5 py-3 text-right text-text-tertiary">{r.reach ? fmt(r.reach) : '–'}</td>
                        <td className="px-5 py-3 text-right font-medium">
                          {r.er === null
                            ? <span className="text-text-tertiary">—</span>
                            : <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-sage-100 text-sage-800 uppercase tracking-[0.08em]">{pct(r.er)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Top performing posts */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
              <IconBadge tone="rose">{Icon.trophy}</IconBadge>
              <h3 className="font-semibold text-text text-sm">Top performing posts</h3>
            </div>
            <div className="overflow-auto max-h-[360px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[inset_0_-1px_0_#dde3e2]">
                  <tr>
                    <th className="text-left px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Post</th>
                    {/* `row.*`, not `post.*`: every cell here is one post, not
                        the window's posts added up. */}
                    <Th metric="row.likes" label="Likes" />
                    <Th metric="row.comments" label="Comments" />
                    {shown('views') && <Th metric="row.views" label="Views" />}
                    {shown('impressions') && <Th metric="row.impressions" label="Impr." />}
                    {shown('reach') && <Th metric="row.reach" label="Reach" />}
                    {listed('clicks') && <Th metric="row.clicks" label="Clicks" />}
                    <Th metric="row.engagement_rate" label="ER" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {topPosts.map(p => (
                    <tr key={p._id} className="hover:bg-surface-muted transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 max-w-xs">
                          <PostImage src={p.thumbnailUrl} className="w-9 h-9 object-cover flex-shrink-0 border border-border" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <PlatformPill platform={p.platform} />
                              <span className="text-[10px] text-text-tertiary">{(p.publishedAt || '').slice(0, 10)}</span>
                              {p.platformPostUrl && (
                                <a href={p.platformPostUrl} target="_blank" rel="noreferrer"
                                  className="text-[10px] font-semibold text-amber-700 hover:underline">View ↗</a>
                              )}
                            </div>
                            <p className="text-xs text-text-secondary truncate">{(p.content || '').split('\n')[0]}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-text">{fmt(p.analytics?.likes)}</td>
                      <td className="px-5 py-3 text-right text-text">{fmt(p.analytics?.comments)}</td>
                      {shown('views') && <td className="px-5 py-3 text-right text-text">{fmt(p.analytics?.views)}</td>}
                      {shown('impressions') && <td className="px-5 py-3 text-right text-text">{fmt(p.analytics?.impressions)}</td>}
                      {shown('reach') && <td className="px-5 py-3 text-right text-text-tertiary">{p.analytics?.reach ? fmt(p.analytics.reach) : '–'}</td>}
                      {listed('clicks') && <td className="px-5 py-3 text-right text-text">{fmt(p.analytics?.clicks)}</td>}
                      <td className="px-5 py-3 text-right font-medium text-text">
                        {p._er === null ? <span className="text-text-tertiary">—</span> : pct(p._er)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Posting frequency vs engagement / Engagement accumulation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Posting frequency vs engagement" subtitle="Optimal cadence per platform" icon={Icon.activity} tone="sage" metric="calc.frequency">
              {frequencyRows.length === 0 ? (
                <p className="text-sm text-text-tertiary py-8 text-center">Not enough history yet.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={frequencyRows.map(r => ({ label: `${r.posts_per_week}/wk`, rate: r.avg_engagement_rate, platform: r.platform }))} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" horizontal={false} />
                      <XAxis type="number" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} unit="%" />
                      <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={50} />
                      <Tooltip formatter={v => pct(v)} />
                      <Bar dataKey="rate" fill="#558050" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {frequencyRows.map(r => (
                      <span key={`${r.platform}-${r.posts_per_week}`} className="text-[10px] px-1.5 py-0.5 bg-surface-subtle border border-border text-text-secondary">
                        <span className="capitalize font-medium">{r.platform}</span> · {r.posts_per_week}/wk · {pct(r.avg_engagement_rate)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>
            <ChartCard title="Engagement accumulation" subtitle="How engagement builds up after publishing" icon={Icon.trending} metric="calc.decay">
              {decayBuckets.length === 0 ? (
                <p className="text-sm text-text-tertiary py-8 text-center">Not enough history yet.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={decayBuckets}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                      <XAxis dataKey="bucket_label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} unit="%" />
                      <Tooltip formatter={v => pct(v)} />
                      <Line type="monotone" dataKey="avg_pct_of_final" stroke="#657b81" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-text-secondary mt-2">
                    Half of engagement lands by <span className="font-semibold">
                      {decayBuckets.find(b => b.avg_pct_of_final >= 50)?.bucket_label || decayBuckets[decayBuckets.length - 1].bucket_label}
                    </span>
                  </p>
                </>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </>
  )
}
