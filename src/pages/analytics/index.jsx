import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import { useApp } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Card, Button, PlatformPill, Empty, Spinner, PostImage } from '../../components/ui/index'
import { fetchSocialAccounts, syncZernio, fetchZernioDashboard } from '../../lib/zernio'
import { BestTimeHeatmap, IconBadge, PillSelect, Icon, MetricToggle } from './charts'

// ─── Analytics ───────────────────────────────────────────────────────────
// Live proxy of Zernio's own analytics — the browser never talks to Zernio
// directly (see src/lib/zernio.js), but the numbers themselves are fetched
// fresh on every load rather than pre-synced into Supabase. Zernio already
// aggregates all of this (best time to post, posting-frequency curves,
// content decay, daily rollups) server-side; re-deriving it from our own
// post_analytics rows would mean re-implementing their stats engine for no
// benefit, and would only ever cover posts published through OUR pipeline —
// this covers everything on the connected account, same as Zernio's own
// dashboard does.

const fmt = n => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(Math.round(n) || 0)

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
const DEFAULT_LINE_METRICS = ['likes', 'comments', 'views', 'impressions']
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

function timeAgo(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const ZERO_METRICS = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0 }

function ChartCard({ title, subtitle, total, right, icon, tone, children }) {
  return (
    <Card className="p-5 shadow-none border-border/80">
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

export function Analytics() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const navigate = useNavigate()

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dash, setDash] = useState(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')

  const [platform, setPlatform] = useState('instagram')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [days, setDays] = useState(30)
  const [barMetric, setBarMetric] = useState('likes')
  const [lineMetrics, setLineMetrics] = useState(() => new Set(DEFAULT_LINE_METRICS))

  // Connected accounts — straight Supabase read, independent of the Zernio
  // proxy, so the account picker still works even if that webhook is down.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!activeWorkspaceId) { setLoading(false); return }
      const accts = await fetchSocialAccounts(activeWorkspaceId, accessToken)
      if (cancelled) return
      setAccounts(accts)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  const loadDashboard = useCallback(async () => {
    setDashLoading(true)
    const result = await fetchZernioDashboard(state.webhooks?.zernioDashboard, { platform, accountId: selectedAccount, days })
    setDashLoading(false)
    return result
  }, [state.webhooks?.zernioDashboard, platform, selectedAccount, days])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await loadDashboard()
      if (!cancelled) setDash(result)
    })()
    return () => { cancelled = true }
  }, [loadDashboard])

  async function handleSync() {
    setSyncing(true); setNote('')
    const result = await syncZernio(state.webhooks?.zernioSync, activeWorkspaceId)
    setSyncing(false)
    setNote(result.error || result.analytics_skipped
      || `Synced ${result.accounts_synced ?? 0} account(s), ${result.rows_written ?? 0} metric row(s).`)
    setDash(await loadDashboard())
  }

  function toggleLineMetric(key) {
    setLineMetrics(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Derive everything from the last dashboard response ──────────────────
  // Each key is fetched independently server-side (see the n8n workflow's
  // `safe()` wrapper) so one add-on hiccuping — rate limit, 402, timeout —
  // doesn't blank the whole page. But `overview` failing to load must not
  // be silently read as "zero posts": those are different states the user
  // needs to tell apart, so surface it explicitly instead of falling back.
  const overviewError = dash?.overview?._error || null
  const posts = dash?.overview?.posts || []
  const overviewMeta = dash?.overview?.overview || {}
  const zAccounts = dash?.overview?.accounts || []
  const hasAnalyticsAccess = dash?.overview?.hasAnalyticsAccess !== false
  const platformBreakdownRaw = dash?.daily?.platformBreakdown || []
  const dailyRows = dash?.daily?.dailyData || []
  const bestTimeSlots = dash?.bestTime?.slots || []
  const frequencyRows = dash?.frequency?.frequency || []
  const decayBuckets = [...(dash?.decay?.buckets || [])].sort((a, b) => a.bucket_order - b.bucket_order)
  const followerRows = (() => {
    const stats = dash?.followers?.stats || {}
    const arr = selectedAccount ? (stats[selectedAccount] || []) : Object.values(stats).flat()
    return arr
  })()

  const totals = useMemo(() => {
    const acc = { ...ZERO_METRICS }
    for (const p of posts) { const a = p.analytics || {}; for (const k of Object.keys(acc)) acc[k] += a[k] || 0 }
    return acc
  }, [posts])

  const overallEngagementRate = useMemo(() => engagementRate(totals) ?? 0, [totals])
  const totalFollowers = useMemo(() => zAccounts.reduce((s, a) => s + (a.followersCount || 0), 0), [zAccounts])

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

  const postsOverTime = useMemo(() => {
    const m = new Map()
    for (const p of posts) {
      const wk = weekOf((p.publishedAt || '').slice(0, 10))
      m.set(wk, (m.get(wk) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([wk, count]) => ({ week: shortDate(wk), count }))
  }, [posts])

  const metricPerPlatform = useMemo(() =>
    platformBreakdownRaw.map(r => ({ platform: r.platform, value: r[barMetric] || 0 }))
  , [platformBreakdownRaw, barMetric])

  const weeklyBuckets = useMemo(() => {
    const m = new Map()
    for (const r of dailyRows) {
      const wk = weekOf(r.date)
      if (!m.has(wk)) m.set(wk, { week: wk, ...ZERO_METRICS })
      const e = m.get(wk)
      for (const k of Object.keys(ZERO_METRICS)) e[k] += (r.metrics && r.metrics[k]) || 0
    }
    return [...m.values()].sort((a, b) => a.week.localeCompare(b.week)).map(e => ({ ...e, weekLabel: shortDate(e.week) }))
  }, [dailyRows])

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

  if (loading) {
    return <div className="max-w-7xl"><Card className="p-12 flex items-center justify-center"><Spinner /></Card></div>
  }

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">Analytics</h1>
          <p className="text-sm text-text-secondary mt-1">Real performance pulled live from your connected accounts.</p>
        </div>
        <div className="text-right">
          <Button size="xs" variant="ghost" onClick={handleSync} disabled={syncing}>
            {syncing ? <><Spinner size="sm" /> Syncing…</> : '↻ Refresh from Zernio'}
          </Button>
          {note && <p className="text-[10px] text-text-tertiary mt-1 max-w-[260px]">{note}</p>}
        </div>
      </div>

      {accounts.length === 0 ? (
        <Card className="p-6 border-dashed bg-surface-muted">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-text mb-1">No connected accounts yet</h3>
              <p className="text-sm text-text-secondary mb-3">
                Connect your accounts in the Zernio dashboard, then hit Refresh — they'll appear here with real reach, engagement and follower data.
              </p>
              <Button onClick={() => navigate('/integrations')}>Set up integrations</Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <PillSelect value={platform} onChange={e => setPlatform(e.target.value)} className="w-32">
              <option value="">All platforms</option>
              <option value="instagram">Instagram</option>
              <option value="linkedin">LinkedIn</option>
            </PillSelect>
            {accounts.length > 1 && (
              <PillSelect value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="w-40">
                <option value="">All profiles</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.zernio_account_id}>{a.username ? `@${a.username}` : a.display_name}</option>
                ))}
              </PillSelect>
            )}
            <PillSelect value={String(days)} onChange={e => setDays(Number(e.target.value))} className="w-32">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </PillSelect>
            {dashLoading && <Spinner size="sm" />}
            <div className="ml-auto text-[11px] text-text-tertiary text-right leading-tight">
              {overviewMeta.lastSync && <p>Last sync: {timeAgo(overviewMeta.lastSync)}</p>}
            </div>
          </div>

          {dash?.error ? (
            <Card className="p-6 border-dashed bg-surface-muted">
              <Empty
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
                title="Couldn't reach Zernio"
                description={dash.error}
              />
            </Card>
          ) : !hasAnalyticsAccess ? (
            <Card className="p-6 border-dashed bg-surface-muted">
              <Empty title="Analytics add-on not enabled" description="This Zernio plan doesn't include the analytics add-on yet." />
            </Card>
          ) : (
            <>
              {/* KPI strip — one flat row divided by rules, not five boxed
                  cards. Reads as a single stat panel rather than a scatter
                  of separate widgets. */}
              <Card className="shadow-none border-border/80 overflow-hidden">
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
                        <PostImage src={bestPost.thumbnailUrl} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
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
                  <Empty
                    icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
                    title="Couldn't load post data"
                    description={overviewError}
                    action={<Button onClick={handleSync}>Try again</Button>}
                  />
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
                  {/* Posts per platform / Posts over time */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                  </div>

                  {/* Metric per platform / Metric over time — shared metric selector */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <ChartCard title={`${METRIC_OPTIONS.find(m => m.key === barMetric)?.label} per platform`}
                      total={fmt(metricPerPlatform.reduce((s, r) => s + r.value, 0))}
                      icon={metricIcon(barMetric)} tone={METRIC_TONE[barMetric]}
                      right={<PillSelect value={barMetric} onChange={e => setBarMetric(e.target.value)} className="w-28">
                        {METRIC_OPTIONS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </PillSelect>}>
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
                    <ChartCard title={`${METRIC_OPTIONS.find(m => m.key === barMetric)?.label} over time`} subtitle="Per week"
                      icon={metricIcon(barMetric)} tone={METRIC_TONE[barMetric]}>
                      <ResponsiveContainer width="100%" height={200}>
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
                  <Card className="p-5 shadow-none border-border/80">
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
                            {METRIC_OPTIONS.filter(m => lineMetrics.has(m.key)).map(m => (
                              <Line key={m.key} type="natural" dataKey={m.key} name={m.label} stroke={LINE_COLORS[m.key]}
                                strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-x-6 gap-y-5 lg:w-56 lg:flex-shrink-0 lg:border-l lg:border-border lg:pl-6">
                        {METRIC_OPTIONS.map(m => (
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
                          <p className="text-xs text-text-tertiary">Follower history will appear here once data is collected.</p>
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
                  <Card className="overflow-hidden shadow-none border-border/80">
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
                            <tr key={r.platform} className="hover:bg-surface-muted/60 transition-colors">
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
                                  : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sage-50 text-sage-700">{r.er.toFixed(0)}%</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {/* Top performing posts */}
                  <Card className="overflow-hidden shadow-none border-border/80">
                    <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
                      <IconBadge tone="rose">{Icon.trophy}</IconBadge>
                      <h3 className="font-semibold text-text text-sm">Top performing posts</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
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
                            <tr key={p._id} className="hover:bg-surface-muted/60 transition-colors">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3 max-w-xs">
                                  <PostImage src={p.thumbnailUrl} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <PlatformPill platform={p.platform} />
                                      <span className="text-[10px] text-text-tertiary">{(p.publishedAt || '').slice(0, 10)}</span>
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
                              <span key={r.platform} className="text-[10px] px-2 py-1 rounded-full bg-surface-muted text-text-secondary">
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
                          {decayBuckets.length > 0 && (
                            <p className="text-xs text-text-secondary mt-2">
                              Half of engagement lands by <span className="font-semibold">
                                {decayBuckets.find(b => b.avg_pct_of_final >= 50)?.bucket_label || decayBuckets[decayBuckets.length - 1].bucket_label}
                              </span>
                            </p>
                          )}
                        </>
                      )}
                    </ChartCard>
                  </div>
                </>
              )}
            </>
          )}

          {/* Connected accounts — always shown regardless of dashboard state */}
          <Card className="overflow-hidden shadow-none border-border/80">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
              <IconBadge>{Icon.users}</IconBadge>
              <div>
                <h3 className="font-semibold text-text text-sm">Connected accounts</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Managed in Zernio — reconnect there if a token expires</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              {accounts.map(a => {
                const active = selectedAccount === a.zernio_account_id
                return (
                  <div key={a.id}
                    onClick={() => setSelectedAccount(active ? '' : a.zernio_account_id)}
                    className={`flex items-center gap-4 px-5 py-3 cursor-pointer transition-colors ${active ? 'bg-amber-50/60' : 'hover:bg-surface-subtle'}`}>
                    <PlatformPill platform={a.platform} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text truncate">{a.display_name || a.username || a.platform}</p>
                      {a.username && <p className="text-xs text-text-tertiary truncate">@{a.username}</p>}
                    </div>
                    <div className="text-sm text-text-secondary">{fmt(a.followers_count || 0)} followers</div>
                    {a.needs_reconnection
                      ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">Reconnect needed</span>
                      : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sage-50 text-sage-700">Connected</span>}
                    {active && <span className="text-[10px] font-semibold text-amber-700">Viewing</span>}
                    {a.profile_url && (
                      <a href={a.profile_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="text-[11px] font-semibold text-amber-700 hover:underline">Open ↗</a>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
