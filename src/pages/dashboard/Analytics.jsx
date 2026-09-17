import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Card, Button, Skeleton, IconBadge, PillSelect, Empty } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { PLATFORM_META } from '../../lib/utils'
import { fmt } from '../analytics/format'
import { platformSeries, followerChange } from '../../lib/dashboardOverview'

// ─── The dashboard's analytics overview ────────────────────────────────────
// What the old page had instead of this was a list of recent posts drawn from
// a localStorage store nothing writes to — five zeroes and an empty list. This
// is the question the dashboard is actually asked: how are we doing, across
// every platform at once.
//
// /analytics stays the place to go one account deep. This is the altitude
// above it, and the difference is the platform picker: several platforms
// combined into one set of numbers, with each one still drawn separately in
// the chart so a total never hides which platform earned it.

// Muted rather than each platform's own brand colour. Instagram's #E1306C and
// LinkedIn's #0A66C2 next to each other on one chart fight for attention and
// neither belongs to this app's palette; these are the tones the rest of the
// product already uses.
const PLATFORM_LINE = {
  instagram: '#e0687a',
  linkedin: '#657b81',
  tiktok: '#325130',
  snapchat: '#c9a35e',
}

const SERIES_METRICS = [
  { key: 'views', label: 'Views' },
  { key: 'interactions', label: 'Engagement' },
  { key: 'reach', label: 'Reach' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
]

const axisTick = { fontSize: 11, fill: '#7a848c' }
const label = p => PLATFORM_META[p]?.label || p

const shortDay = iso => {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** A metric that nobody measured prints as an em dash, never as zero. */
const stat = v => (typeof v === 'number' ? fmt(v) : '—')

function Delta({ value, suffix = '', invert = false }) {
  if (typeof value !== 'number' || value === 0) return null
  const good = invert ? value < 0 : value > 0
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${good ? 'text-sage-700' : 'text-rose-600'}`}>
      {value > 0 ? '+' : ''}{fmt(Math.abs(value)) === '0' ? value : (value > 0 ? fmt(value) : `-${fmt(Math.abs(value))}`)}{suffix}
    </span>
  )
}

function Tile({ label: name, value, hint, delta }) {
  return (
    <div className="p-4">
      <p className="eyebrow mb-2 truncate">{name}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold text-text leading-none tabular-nums">{value}</p>
        {delta}
      </div>
      {hint && <p className="text-[11px] text-text-tertiary mt-1.5 leading-tight">{hint}</p>}
    </div>
  )
}

export function PlatformPicker({ platforms, selected, onToggle }) {
  if (platforms.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {platforms.map(p => {
        const on = selected.has(p)
        return (
          <button key={p} onClick={() => onToggle(p)} aria-pressed={on}
            className={`text-xs font-medium px-2.5 py-1.5 border transition-colors flex items-center gap-1.5
              ${on ? 'border-stone-400 bg-surface-subtle text-text' : 'border-border text-text-tertiary hover:text-text'}`}>
            <span className="w-2 h-2 flex-shrink-0"
              style={{ background: on ? (PLATFORM_LINE[p] || '#7a848c') : 'transparent',
                       boxShadow: on ? 'none' : `inset 0 0 0 1px ${PLATFORM_LINE[p] || '#7a848c'}` }} />
            {label(p)}
          </button>
        )
      })}
    </div>
  )
}

export function AnalyticsOverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading analytics">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="p-4">
              <Skeleton className="h-2.5 w-16 mb-2.5" />
              <Skeleton className="h-7 w-14" />
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <Skeleton className="h-4 w-40 mb-4" />
        <Skeleton className="h-[240px] w-full" />
      </Card>
    </div>
  )
}

export function AnalyticsOverview({ summaries, overview, range, days, onDays, selected, loading, settling }) {
  const navigate = useNavigate()
  const [metric, setMetric] = useState('views')

  const scoped = useMemo(
    () => summaries.filter(s => !selected.size || selected.has(s.platform)),
    [summaries, selected],
  )

  // Only metrics the selected platforms can actually fill. Offering "Views"
  // for a LinkedIn-only selection draws a flat zero line, which reads as a
  // month with no views rather than as a number LinkedIn never takes.
  //
  // `interactions` is always offered because nothing reports it — it is likes,
  // comments, shares and saves added up here, which every platform has.
  const metricOptions = useMemo(() => {
    const supported = new Set()
    let unknown = false
    for (const s of scoped) {
      if (!Array.isArray(s.supports)) { unknown = true; break }
      for (const k of s.supports) supported.add(k)
    }
    if (unknown || !scoped.length) return SERIES_METRICS
    return SERIES_METRICS.filter(m => m.key === 'interactions' || supported.has(m.key))
  }, [scoped])

  // Derived, not corrected in state: unticking a platform must not silently
  // rewrite a choice the user made and would get back by re-ticking it.
  const activeMetric = metricOptions.some(m => m.key === metric) ? metric : 'interactions'

  const series = useMemo(
    () => platformSeries(scoped, { metric: activeMetric, fromDate: range.fromDate, toDate: range.toDate }),
    [scoped, activeMetric, range.fromDate, range.toDate],
  )

  const followers = useMemo(() => followerChange(scoped), [scoped])

  if (loading) return <AnalyticsOverviewSkeleton />

  const rows = series.rows.map(r => ({ ...r, label: shortDay(r.bucket) }))
  const hasSeries = rows.some(r => r.total > 0)
  const metricLabel = metricOptions.find(m => m.key === activeMetric)?.label || activeMetric

  return (
    <div className="space-y-4">
      {/* Anything that failed is named. An account missing from a total reads
          as a platform that had a quiet month, which is the wrong thing to
          believe about an expired token. */}
      {overview.errors.length > 0 && (
        <Card className="px-4 py-3 border-amber-200 bg-amber-50">
          <p className="text-xs text-amber-900">
            {overview.errors.map(e => (
              <span key={`${e.platform}-${e.username}`} className="block">
                <span className="font-semibold">{label(e.platform)}{e.username ? ` (${e.username})` : ''}</span> did not
                report: {e.error} These numbers are the rest.
              </span>
            ))}
          </p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 divide-x divide-border">
          <Tile label="Followers" value={stat(overview.followers)}
            hint={followers ? undefined : 'Counted daily'}
            delta={followers ? <Delta value={followers.delta} /> : null} />
          <Tile label="Accounts reached" value={stat(overview.reach)}
            hint="People, not impressions" />
          {/* Named by whose number it is when it is not everybody's. LinkedIn
              takes no view count on an ordinary post, so a mixed selection's
              "post views" is the Instagram and TikTok half — saying so is the
              difference between a partial number and a wrong one. */}
          <Tile label="Post views" value={stat(overview.postViews)}
            hint={overview.postViews === null
              ? 'Not reported by these platforms'
              : overview.postViewPlatforms.length < overview.byPlatform.length
                ? `${overview.postViewPlatforms.map(label).join(' and ')} only`
                : 'Videos and images'} />
          {/* The distinction the user asked for in as many words. Instagram
              counts these across every surface — feed, stories, explore and
              the profile itself — so they are NOT the post views above and
              must never be added to them. */}
          <Tile label="Profile views" value={stat(overview.accountViews)}
            hint="Profile and page, all surfaces" />
          <Tile label="Engagement" value={overview.engagementRate === null ? '—' : `${overview.engagementRate.toFixed(1)}%`}
            hint={`${fmt(overview.interactions)} interactions`} />
          <Tile label="Posts published" value={String(overview.posts)}
            hint={`Last ${days} days`} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* The trend, one line per platform plus the combined total. */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-2.5">
              <IconBadge>{Icon.trending}</IconBadge>
              <div>
                <h3 className="font-semibold text-text text-sm leading-tight">{metricLabel} over time</h3>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {series.mode === 'week' ? 'By week' : 'By day'} · {scoped.length === 0 ? 'nothing selected'
                    : `${series.platforms.map(label).join(', ')}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PillSelect value={activeMetric} onChange={e => setMetric(e.target.value)} className="w-32">
                {metricOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </PillSelect>
              <PillSelect value={String(days)} onChange={e => onDays(Number(e.target.value))} className="w-32">
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </PillSelect>
            </div>
          </div>

          {!hasSeries ? (
            <div className="h-[240px] flex items-center justify-center">
              <Empty title={settling ? 'Still loading' : 'Nothing measured in this window'}
                description={settling
                  ? 'Waiting for the remaining accounts.'
                  : 'No posts went out in this range, or the platforms have not reported yet — reach and views can lag by up to 48 hours.'} />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} minTickGap={18} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmt} />
                <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 0 }}
                  formatter={(v, name) => [fmt(v), name === 'total' ? 'Total' : label(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline"
                  formatter={v => (v === 'total' ? 'Total' : label(v))} />
                {/* The combined line first so it sits under the per-platform
                    ones — the total is context, each platform is the answer. */}
                {series.platforms.length > 1 && (
                  <Line type="monotone" dataKey="total" stroke="#a8a29e" strokeWidth={2.5}
                    strokeDasharray="4 3" dot={false} />
                )}
                {series.platforms.map(p => (
                  <Line key={p} type="monotone" dataKey={p} stroke={PLATFORM_LINE[p] || '#7a848c'}
                    strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <div className="space-y-4">
          {/* Most active platform. Ranked by interactions rather than by how
              often we posted — "most active" is a question about where the
              audience is, and posts sit underneath so the other reading of the
              word is one glance away. */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
              <IconBadge tone="sage">{Icon.trophy}</IconBadge>
              <div className="min-w-0">
                <h3 className="font-semibold text-text text-sm leading-tight">Most active platform</h3>
                <p className="text-xs text-text-tertiary mt-0.5">By engagement in this window</p>
              </div>
            </div>
            {!overview.mostActive ? (
              <p className="px-4 py-5 text-xs text-text-tertiary">Nothing measured yet.</p>
            ) : (
              <div className="px-4 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 flex-shrink-0"
                    style={{ background: PLATFORM_LINE[overview.mostActive.platform] || '#7a848c' }} />
                  <p className="text-lg font-bold text-text leading-none">{label(overview.mostActive.platform)}</p>
                </div>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">Interactions</dt>
                    <dd className="font-semibold text-text tabular-nums">{fmt(overview.mostActive.interactions)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">Posts</dt>
                    <dd className="font-semibold text-text tabular-nums">{overview.mostActive.posts}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">Engagement rate</dt>
                    <dd className="font-semibold text-text tabular-nums">
                      {overview.mostActive.engagementRate === null ? '—' : `${overview.mostActive.engagementRate.toFixed(1)}%`}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </Card>

          {/* Per-platform table. The old "Platform overview" card counted posts
              in an empty demo store and listed Facebook and X, which are not
              platforms in this app at all. */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <IconBadge>{Icon.grid}</IconBadge>
                <h3 className="font-semibold text-text text-sm">By platform</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/analytics')}>Details</Button>
            </div>
            {overview.byPlatform.length === 0 ? (
              <p className="px-4 py-5 text-xs text-text-tertiary">No connected platform reported numbers.</p>
            ) : (
              <div className="divide-y divide-border">
                {overview.byPlatform.map(p => (
                  <div key={p.platform} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 flex-shrink-0" style={{ background: PLATFORM_LINE[p.platform] || '#7a848c' }} />
                        <span className="text-xs font-semibold text-text truncate">{label(p.platform)}</span>
                      </span>
                      <span className="text-xs font-semibold text-text tabular-nums">{stat(p.followers)}</span>
                    </div>
                    <p className="text-[11px] text-text-tertiary tabular-nums">
                      {p.posts} post{p.posts === 1 ? '' : 's'} · {fmt(p.interactions)} interactions
                      {p.engagementRate !== null && ` · ${p.engagementRate.toFixed(1)}%`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
