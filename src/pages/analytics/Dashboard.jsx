import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import { Card, Button, PlatformPill, Empty, PostImage, IconBadge, PillSelect } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { BestTimeHeatmap, MetricToggle } from './charts'
import { fmt } from './format'

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

// Interactions ÷ people reached (falls back to impressions when a platform
// doesn't report reach) — same definition used everywhere else in this app.
function engagementRate(a) {
  if (!a) return null
  const denom = a.reach || a.impressions || 0
  if (!denom) return null
  const interactions = (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0)
  return (interactions / denom) * 100
}

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

export function ChartCard({ title, subtitle, total, right, icon, tone, children }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5">
          {icon && <IconBadge tone={tone}>{icon}</IconBadge>}
          <div>
            <h3 className="font-semibold text-text text-sm leading-tight">{title}</h3>
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

const axisTick = { fontSize: 11, fill: '#7a848c' }

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
  const followerRows = useMemo(() => {
    const stats = dash?.followers?.stats || {}
    const fromStats = accountId ? (stats[accountId] || []) : Object.values(stats).flat()
    if (fromStats.length) return fromStats
    const values = dash?.followerHistory?.metrics?.follower_count?.values || []
    return values.map(v => ({ date: v.date, followers: v.value }))
  }, [dash?.followers?.stats, dash?.followerHistory, accountId])

  const totals = useMemo(() => {
    const acc = { ...ZERO_METRICS }
    for (const p of posts) { const a = p.analytics || {}; for (const k of Object.keys(acc)) acc[k] += a[k] || 0 }
    return acc
  }, [posts])

  const overallEngagementRate = useMemo(() => engagementRate(totals) ?? 0, [totals])

  // Zernio omits followersCount until its first daily snapshot, and the
  // follower-stats and history endpoints fill on the same clock — so take
  // the best any of them has rather than trusting one.
  const totalFollowers = useMemo(() => {
    const fromOverview = zAccounts
      .filter(a => !accountId || a._id === accountId)
      .reduce((s, a) => s + (a.followersCount || 0), 0)
    const fromStats = (dash?.followers?.accounts || [])
      .filter(a => !accountId || a._id === accountId)
      .reduce((s, a) => s + (a.currentFollowers || 0), 0)
    const latest = followerRows.length ? (followerRows[followerRows.length - 1].followers || 0) : 0
    return Math.max(fromOverview, fromStats, latest)
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
      {/* KPI strip — one flat row divided by rules, not five boxed
          cards. Reads as a single stat panel rather than a scatter
          of separate widgets. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border">
          <div className="p-5">
            <p className="text-xs text-text-tertiary mb-1.5">Engagement rate</p>
            <p className="text-2xl font-bold text-text">{overallEngagementRate.toFixed(1)}%</p>
          </div>
          <div className="p-5">
            <p className="text-xs text-text-tertiary mb-1.5">Total reach</p>
            <p className="text-2xl font-bold text-text flex items-center gap-1.5">
              <span className="text-text-tertiary">{Icon.eye}</span>{fmt(totals.reach)}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs text-text-tertiary mb-1.5">Total followers</p>
            <p className="text-2xl font-bold text-text flex items-center gap-1.5">
              <span className="text-text-tertiary">{Icon.users}</span>{fmt(totalFollowers)}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs text-text-tertiary mb-1.5">Posts this period</p>
            <p className="text-2xl font-bold text-text flex items-center gap-1.5">
              <span className="text-text-tertiary">{Icon.document}</span>{overviewMeta.totalPosts ?? posts.length}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs text-text-tertiary mb-1.5">Best post</p>
            {bestPost ? (
              <div className="flex items-center gap-2">
                <PostImage src={bestPost.thumbnailUrl} className="w-8 h-8 object-cover flex-shrink-0 border border-border" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text leading-tight">{bestPost._er >= 0 ? `${bestPost._er.toFixed(0)}%` : '—'}</p>
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
            description="Publish a post from Post Approvals, or widen the date range above."
            action={<Button onClick={() => navigate('/social/approvals')}>Go to Post Approvals</Button>}
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
            <ChartCard title="Posts over time" subtitle="Posts per week" total={posts.length} icon={Icon.trending}>
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
                <div className="text-left">
                  <p className="text-xs text-text-tertiary">Eng. rate</p>
                  <span className="flex items-center gap-1.5 mt-1 pl-0.5">
                    <span className="text-sage-600 flex-shrink-0">{Icon.trending}</span>
                    <span className="text-xl font-bold leading-none text-text">{overallEngagementRate.toFixed(0)}%</span>
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Best time to post / Follower history */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Best time to post" icon={Icon.clock}>
              <BestTimeHeatmap slots={bestTimeSlots} />
            </ChartCard>
            <ChartCard title="Follower history" icon={Icon.users} tone="sage">
              {followerRows.length === 0 ? (
                <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2">
                  <svg className="w-8 h-8 text-text-disabled" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <p className="text-sm font-medium text-text">No data available</p>
                  <p className="text-xs text-text-tertiary">Zernio records followers once a day, so a newly connected account fills in from tomorrow.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={followerRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                    <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="followers" stroke="#657b81" strokeWidth={2} dot={false} />
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
                      <th className="text-left px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Platform</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Posts</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Likes</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Comments</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Shares</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Saves</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Views</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Impr.</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Reach</th>
                      <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">ER</th>
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
                            : <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-sage-100 text-sage-800 uppercase tracking-[0.08em]">{r.er.toFixed(0)}%</span>}
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
                    <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Likes</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Comments</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Views</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Impr.</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Reach</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">ER</th>
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
                      <td className="px-5 py-3 text-right text-text">{fmt(p.analytics?.views)}</td>
                      <td className="px-5 py-3 text-right text-text">{fmt(p.analytics?.impressions)}</td>
                      <td className="px-5 py-3 text-right text-text-tertiary">{p.analytics?.reach ? fmt(p.analytics.reach) : '–'}</td>
                      <td className="px-5 py-3 text-right font-medium text-text">
                        {p._er === null ? <span className="text-text-tertiary">—</span> : `${p._er.toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Posting frequency vs engagement / Engagement accumulation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Posting frequency vs engagement" subtitle="Optimal cadence per platform" icon={Icon.activity} tone="sage">
              {frequencyRows.length === 0 ? (
                <p className="text-sm text-text-tertiary py-8 text-center">Not enough history yet.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={frequencyRows.map(r => ({ label: `${r.posts_per_week}/wk`, rate: r.avg_engagement_rate, platform: r.platform }))} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" horizontal={false} />
                      <XAxis type="number" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} unit="%" />
                      <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={50} />
                      <Tooltip formatter={v => `${v.toFixed(0)}%`} />
                      <Bar dataKey="rate" fill="#558050" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {frequencyRows.map(r => (
                      <span key={`${r.platform}-${r.posts_per_week}`} className="text-[10px] px-1.5 py-0.5 bg-surface-subtle border border-border text-text-secondary">
                        <span className="capitalize font-medium">{r.platform}</span> · {r.posts_per_week}/wk · {r.avg_engagement_rate.toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>
            <ChartCard title="Engagement accumulation" subtitle="How engagement builds up after publishing" icon={Icon.trending}>
              {decayBuckets.length === 0 ? (
                <p className="text-sm text-text-tertiary py-8 text-center">Not enough history yet.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={decayBuckets}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
                      <XAxis dataKey="bucket_label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} unit="%" />
                      <Tooltip formatter={v => `${v.toFixed(0)}%`} />
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
