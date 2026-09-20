import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  Card, Button, Skeleton, IconBadge, Empty, PostImage, PlatformPill,
} from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { PLATFORM_META } from '../../lib/utils'
import { MetricInfoDot } from '../../components/analytics/MetricLabel'
import { fmt, pct, windowLabel } from '../analytics/format'
import { RangePicker } from '../../components/analytics/RangePicker'
import { resolveRange } from '../../lib/dateRange'
import { metricFacets, followerChange } from '../../lib/dashboardOverview'

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

function Tile({ label: name, value, hint, delta, metric }) {
  return (
    <div className="p-4">
      <p className="eyebrow mb-2 flex items-center gap-1.5 min-w-0">
        <span className="truncate">{name}</span>
        <MetricInfoDot metric={metric} label={name} />
      </p>
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

/**
 * The metrics drawn, as many as you like at once.
 *
 * Toggles rather than a dropdown for the same reason the platforms above are:
 * what is on and what is off is the whole state of the chart, and a closed
 * <select> showing "Views" cannot say that likes and comments are also drawn.
 *
 * One metric always stays ticked. Unticking the last one would leave the card
 * with nothing to draw and no obvious way back into it.
 */
export function MetricPicker({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Metrics">
      {options.map(m => {
        const on = selected.includes(m.key)
        const last = on && selected.length === 1
        return (
          <button key={m.key} onClick={() => onToggle(m.key)} aria-pressed={on} disabled={last}
            title={last ? 'At least one metric stays selected' : undefined}
            className={`text-xs font-medium px-2.5 py-1.5 border transition-colors flex items-center gap-1.5
              ${on ? 'border-stone-400 bg-surface-subtle text-text' : 'border-border text-text-tertiary hover:text-text'}
              ${last ? 'cursor-default' : ''}`}>
            <span className={`w-3 h-3 flex-shrink-0 border flex items-center justify-center
              ${on ? 'bg-text border-text text-white' : 'border-border-strong'}`}>
              {on && (
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="4">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              )}
            </span>
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One metric's trend: a line per platform, plus their combined total.
 *
 * `compact` is the small-multiple version — same marks, same colours, smaller
 * type and fewer ticks, and no legend of its own because the panels share one.
 */
function TrendChart({ rows, platforms, height, compact = false }) {
  const tick = compact ? { ...axisTick, fontSize: 10 } : axisTick
  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* The negative left margin pulls the plot back under Recharts' default
          60px axis gutter. A compact panel narrows the gutter itself instead —
          doing both clips the tick labels down to a stray bracket. */}
      <LineChart data={rows} margin={{ top: 4, right: 8, left: compact ? 0 : -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#e7e5e4" vertical={false} />
        <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: '#e7e5e4' }}
          minTickGap={compact ? 42 : 18} interval={compact ? 'preserveStartEnd' : 'preserveEnd'} />
        <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={fmt}
          width={compact ? 36 : undefined} tickCount={compact ? 3 : undefined} />
        <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 0 }}
          formatter={(v, name) => [fmt(v), name === 'total' ? 'Total' : label(name)]} />
        {!compact && (
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline"
            formatter={v => (v === 'total' ? 'Total' : label(v))} />
        )}
        {/* The combined line first so it sits under the per-platform ones —
            the total is context, each platform is the answer. */}
        {platforms.length > 1 && (
          <Line type="monotone" dataKey="total" stroke="#a8a29e" strokeWidth={2.5}
            strokeDasharray="4 3" dot={false} />
        )}
        {platforms.map(p => (
          <Line key={p} type="monotone" dataKey={p} stroke={PLATFORM_LINE[p] || '#7a848c'}
            strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

/** The legend the small multiples share, so five panels do not carry five. */
function SharedLegend({ platforms }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
      {platforms.length > 1 && (
        <span className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <span className="w-4 border-t-2 border-dashed" style={{ borderColor: '#a8a29e' }} />
          Total
        </span>
      )}
      {platforms.map(p => (
        <span key={p} className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <span className="w-4 border-t-2" style={{ borderColor: PLATFORM_LINE[p] || '#7a848c' }} />
          {label(p)}
        </span>
      ))}
    </div>
  )
}

/**
 * The posts that earned the numbers above.
 *
 * ── WHY THIS IS ON THE DASHBOARD AND NOT ONLY ON /analytics ──
 *
 * The tiles say 1.1k interactions and the chart says which week they landed
 * in. Neither says which post did it, and that is the only one of the three
 * a person can act on — the next post is written from this list, not from a
 * total. combineOverview has been ranking these since it was written; nothing
 * rendered them, so the answer was computed on every load and thrown away.
 *
 * Kept to a list rather than /analytics' table on purpose. This is the
 * altitude where the question is "which one", not "by how much across seven
 * columns"; the table is one click away and the row links straight out to the
 * post itself.
 */
function TopPosts({ posts, windowText, onDetails }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <IconBadge tone="sage">{Icon.heart}</IconBadge>
          <div className="min-w-0">
            <h3 className="font-semibold text-text text-sm leading-tight">What worked</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Most interactions{windowText ? ` · ${windowText.toLowerCase()}` : ''}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDetails}>Details</Button>
      </div>

      {posts.length === 0 ? (
        <p className="px-4 py-5 text-xs text-text-tertiary">
          No post in this window has been credited with a like, comment, share or save yet —
          the platforms can lag by up to 48 hours.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {posts.map(p => (
            <div key={p._id || `${p.platform}-${p.publishedAt}`} className="px-4 py-3 flex items-center gap-3">
              <PostImage src={p.thumbnailUrl} alt=""
                className="w-10 h-10 object-cover flex-shrink-0 border border-border" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <PlatformPill platform={p.platform} />
                  <span className="text-[10px] text-text-tertiary">{(p.publishedAt || '').slice(0, 10)}</span>
                  {p.platformPostUrl && (
                    <a href={p.platformPostUrl} target="_blank" rel="noreferrer"
                      className="text-[10px] font-semibold text-amber-700 hover:underline">View ↗</a>
                  )}
                </div>
                {/* `content` is what /analytics reads and `caption` is what
                    the dev harness writes, and nothing in this repo sets
                    either — the shape is Zernio's, passed straight through.
                    Reading both costs one `||` and is cheaper than a card
                    that silently shows "No caption" against every post. */}
                <p className="text-xs text-text-secondary truncate">
                  {(p.content || p.caption || '').split('\n')[0]
                    || <span className="text-text-tertiary">No caption</span>}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-text tabular-nums leading-none">{fmt(p._interactions)}</p>
                {/* A rate nobody could compute prints as nothing rather than
                    as 0% — a post whose reach has not landed yet has not
                    earned a zero. */}
                <p className="text-[10px] text-text-tertiary mt-1">
                  interactions{p._er === null ? '' : ` · ${pct(p._er)}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
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

export function AnalyticsOverview({ summaries, overview, measured, range, onRange, selected, loading, settling }) {
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState(() => new Set(['views']))

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
  // rewrite a choice the user made and would get back by re-ticking it. A
  // selection that the current platforms cannot fill falls back to the one
  // metric every platform can.
  //
  // Ordered by SERIES_METRICS, not by the order they were ticked, so the
  // panels do not rearrange themselves under the cursor.
  const activeMetrics = useMemo(() => {
    const keep = metricOptions.filter(m => metrics.has(m.key)).map(m => m.key)
    return keep.length ? keep : ['interactions']
  }, [metricOptions, metrics])

  function toggleMetric(key) {
    setMetrics(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (activeMetrics.length <= 1) return prev
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const series = useMemo(
    () => metricFacets(scoped, { metrics: activeMetrics, fromDate: measured.fromDate, toDate: measured.toDate }),
    [scoped, activeMetrics, measured.fromDate, measured.toDate],
  )

  const followers = useMemo(() => followerChange(scoped), [scoped])

  if (loading) return <AnalyticsOverviewSkeleton />

  const facets = series.facets.map(f => ({
    ...f,
    label: metricOptions.find(m => m.key === f.metric)?.label || f.metric,
    rows: f.rows.map(r => ({ ...r, label: shortDay(r.bucket) })),
  }))
  const hasSeries = facets.some(f => f.total > 0)
  const single = facets.length === 1
  // The window these numbers actually cover — see the Posts published tile.
  const measuredLabel = windowLabel(measured.fromDate, measured.toDate, resolveRange(range).days)
  const heading = single ? `${facets[0].label} over time`
    : facets.length <= 3 ? `${facets.map(f => f.label).join(', ')} over time`
      : `${facets.length} metrics over time`

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
          <Tile label="Followers" value={stat(overview.followers)} metric="home.followers"
            hint={followers ? undefined : 'Counted daily'}
            delta={followers ? <Delta value={followers.delta} /> : null} />
          <Tile label="Accounts reached" value={stat(overview.reach)} metric="home.reach"
            hint="People, not impressions" />
          {/* Named by whose number it is when it is not everybody's. LinkedIn
              takes no view count on an ordinary post, so a mixed selection's
              "post views" is the Instagram and TikTok half — saying so is the
              difference between a partial number and a wrong one. */}
          <Tile label="Post views" value={stat(overview.postViews)} metric="home.post_views"
            hint={overview.postViews === null
              ? 'Not reported by these platforms'
              : overview.postViewPlatforms.length < overview.byPlatform.length
                ? `${overview.postViewPlatforms.map(label).join(' and ')} only`
                : 'Videos and images'} />
          {/* The distinction the user asked for in as many words. Instagram
              counts these across every surface — feed, stories, explore and
              the profile itself — so they are NOT the post views above and
              must never be added to them. */}
          <Tile label="Profile views" value={stat(overview.accountViews)} metric="home.account_views"
            hint="Profile and page, all surfaces" />
          <Tile label="Engagement" value={pct(overview.engagementRate)}
            metric="home.engagement_rate"
            hint={`${fmt(overview.interactions)} interactions`} />
          {/* The window these numbers ACTUALLY cover, not the one in the
              picker. Meta refuses more than 30 days between `since` and
              `until` on account insights, so asking for 90 gets you 29 — and
              until this read the dates back off the response, the tile printed
              "Last 90 days" over a figure Zernio measured across a month.
              `range` is Zernio's own fromDate/toDate, the same pair the chart's
              x-axis is drawn from, so the tile and the axis cannot disagree. */}
          <Tile label="Posts published" value={String(overview.posts)} metric="home.posts"
            hint={measuredLabel} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* The trend, one line per platform plus the combined total.
            Several metrics at once become one panel each rather than several
            lines on one axis — see metricFacets for why that is not a style
            preference. */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="flex items-start gap-2.5">
              <IconBadge>{Icon.trending}</IconBadge>
              <div>
                <h3 className="font-semibold text-text text-sm leading-tight">{heading}</h3>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {series.mode === 'week' ? 'By week' : 'By day'} · {scoped.length === 0 ? 'nothing selected'
                    : `${series.platforms.map(label).join(', ')}`}
                  {!single && ' · each metric on its own scale'}
                </p>
              </div>
            </div>
            <RangePicker value={range} onChange={onRange} />
          </div>

          {/* The metrics on their own row rather than in the header: with five
              of them they do not fit beside a title, and they are the control
              most likely to be used twice in a row. */}
          <div className="mb-4 pb-3 border-b border-border-light">
            <MetricPicker options={metricOptions} selected={activeMetrics} onToggle={toggleMetric} />
          </div>

          {!hasSeries ? (
            <div className="h-[240px] flex items-center justify-center">
              <Empty title={settling ? 'Still loading' : 'Nothing measured in this window'}
                description={settling
                  ? 'Waiting for the remaining accounts.'
                  : 'No posts went out in this range, or the platforms have not reported yet — reach and views can lag by up to 48 hours.'} />
            </div>
          ) : single ? (
            <TrendChart rows={facets[0].rows} platforms={series.platforms} height={240} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                {facets.map(f => (
                  <div key={f.metric}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-text">{f.label}</span>
                      <span className="text-xs text-text-tertiary tabular-nums">{fmt(f.total)}</span>
                    </div>
                    {/* Whose number it is, when it is not everybody's. A panel
                        summed over a platform that never reports the metric
                        would otherwise read as that platform's quiet month.

                        The row is always here, empty or not: the panels are
                        read against each other, and one caption pushing its
                        plot 14px below its neighbour's puts the two baselines
                        out of line, which is exactly the comparison the shared
                        x-axis exists to make. */}
                    <p className="text-[10px] text-text-tertiary h-3.5 leading-[0.875rem] mb-1 truncate">
                      {f.partial ? `${f.sources.map(label).join(' and ')} only` : ' '}
                    </p>
                    <TrendChart rows={f.rows} platforms={series.platforms} height={132} compact />
                  </div>
                ))}
              </div>
              <SharedLegend platforms={series.platforms} />
            </div>
          )}
        </Card>

        {/* The side column. Two cards rather than one because the trend card
            beside it grows with every metric ticked, and a single short card
            left a column of white space the height of four panels. */}
        <div className="space-y-4">
        {/* ── Platforms, as one card ──
            "Most active platform" and "By platform" were two boxes stacked on
            top of each other answering the same question at two altitudes —
            which platform matters, and how each one is doing. They are one
            list now, with the leader carrying its numbers in full and the rest
            compact underneath.

            Most active is ranked by INTERACTIONS, not by how often we posted:
            "most active" is a question about where the audience is, not about
            where we happen to be typing. Posts and rate sit on the same row so
            the other reading of the word is never more than a glance away. */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <IconBadge tone="sage">{Icon.trophy}</IconBadge>
              <div className="min-w-0">
                <h3 className="font-semibold text-text text-sm leading-tight">Platforms</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Most active first</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/analytics')}>Details</Button>
          </div>

          {overview.byPlatform.length === 0 ? (
            <p className="px-4 py-5 text-xs text-text-tertiary">No connected platform reported numbers.</p>
          ) : (
            <div className="divide-y divide-border">
              {overview.byPlatform.map(p => {
                const leader = overview.mostActive?.platform === p.platform
                return (
                  <div key={p.platform} className={`px-4 ${leader ? 'py-4 bg-surface-subtle' : 'py-3'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`flex-shrink-0 ${leader ? 'w-2.5 h-2.5' : 'w-2 h-2'}`}
                          style={{ background: PLATFORM_LINE[p.platform] || '#7a848c' }} />
                        <span className={`truncate text-text ${leader ? 'text-base font-bold' : 'text-xs font-semibold'}`}>
                          {label(p.platform)}
                        </span>
                        {leader && (
                          <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5
                            leading-[1.4] bg-sage-100 text-sage-700 flex-shrink-0">Most active</span>
                        )}
                      </span>
                      <span className="text-right flex-shrink-0">
                        <span className={`block text-text tabular-nums ${leader ? 'text-base font-bold' : 'text-xs font-semibold'}`}>
                          {stat(p.followers)}
                        </span>
                        <span className="block text-[10px] text-text-tertiary">followers</span>
                      </span>
                    </div>
                    <p className={`text-[11px] text-text-tertiary tabular-nums ${leader ? 'mt-2.5' : 'mt-1.5'}`}>
                      {p.posts} post{p.posts === 1 ? '' : 's'} · {fmt(p.interactions)} interactions
                      {p.engagementRate !== null && ` · ${pct(p.engagementRate)}`}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <TopPosts posts={overview.topPosts} windowText={measuredLabel}
          onDetails={() => navigate('/analytics')} />
        </div>
      </div>
    </div>
  )
}
