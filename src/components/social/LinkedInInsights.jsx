import { useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { IconBadge, Skeleton } from '../ui/index'
import { Icon } from '../ui/icons'
import { fmt, pct, windowLabel } from '../../pages/analytics/format'
import { MetricLabel, MetricInfoDot, ScopeBanner } from '../analytics/MetricLabel'

// ─── A LinkedIn company page, as a whole ───────────────────────────────────
// The page's own totals from LinkedIn's organisation statistics, read by
// /api/zernio/analytics as `linkedinPage` (totals) and `linkedinSeries` (by
// day). These cover every post on the page — including the ones made directly
// on LinkedIn, which the post table below only partly sees — plus follower
// gains and page views, which exist nowhere else.
//
// There is no "views" figure, on purpose. LinkedIn does not count views on an
// ordinary post; impressions is its measure of a post being seen. A Views tile
// here could only ever read 0, and a zero on a dashboard reads as nobody
// looking rather than as a number LinkedIn does not keep.

// `engagement_rate` is simply "Engagement rate", because it is now the only
// one on the page.
//
// It used to sit one strip above a second rate with almost the same name —
// 6.3% here against 3.2% there — and neither was broken. This is LinkedIn's
// own figure by LinkedIn's own formula (it counts clicks and follows as
// engagement) over every post the page carries; that one was interactions ÷
// reach across the posts in the chosen window. Naming the scopes apart made
// the pair legible without making it useful, so the post strip below no longer
// draws its own rate when this one exists. See src/lib/analytics/
// engagementSource.js for the rule and why the platform's figure wins.
const HEADLINE = [
  { key: 'impressions', info: 'li.impressions', label: 'Impressions', icon: Icon.eye },
  { key: 'unique_impressions', info: 'li.unique_impressions', label: 'Members reached', icon: Icon.users },
  { key: 'clicks', info: 'li.clicks', label: 'Clicks', icon: Icon.cursor },
  { key: 'engagement_rate', info: 'li.engagement_rate', label: 'Engagement rate', icon: Icon.activity },
  { key: 'followers_gained', info: 'li.followers_gained', label: 'New followers', icon: Icon.trending },
  { key: 'page_views_total', info: 'li.page_views_total', label: 'Page views', icon: Icon.document },
]

// The page-view split by tab — Overview, Careers, Jobs, Life — used to sit
// here and has been dropped. This is a marketing tool for a lighting
// manufacturer: nobody acts on how many people opened the Careers tab, and
// "Jobs views 2" beside "Life views 0" spent the reader's attention to say
// nothing. The `page_views_total` headline above keeps the part that matters.
const DETAIL = [
  { key: 'likes', info: 'li.likes', label: 'Reactions' },
  { key: 'comments', info: 'li.comments', label: 'Comments' },
  { key: 'shares', info: 'li.shares', label: 'Reposts' },
]

// Same colours the post charts use for these metrics.
const SERIES = [
  { key: 'impressions', label: 'Impressions', color: '#4c5e61' },
  { key: 'unique_impressions', label: 'Members reached', color: '#325130' },
  { key: 'clicks', label: 'Clicks', color: '#9ea3aa' },
]

const axisTick = { fontSize: 11, fill: '#7a848c' }
const shortDate = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function totalOf(metrics, key) {
  if (key === 'followers_gained') {
    // Organic and paid are reported separately; "new followers" is both. Null
    // only when LinkedIn reported neither.
    const organic = metrics.organic_followers_gained?.total
    const paid = metrics.paid_followers_gained?.total
    if (organic == null && paid == null) return null
    return (organic || 0) + (paid || 0)
  }
  return metrics[key]?.total ?? null
}

function display(key, value) {
  if (value === null || value === undefined) return '—'
  // LinkedIn reports engagement as a 0..1 fraction. `pct`, not a local
  // toFixed, so this tile and every other percentage in the app round the
  // same way — the previous mix of toFixed(1) and toFixed(0) is what made one
  // number look like two.
  if (key === 'engagement_rate') return pct(value * 100)
  return fmt(value)
}

export function LinkedInInsights({ dash, days, isPage }) {
  const page = dash?.linkedinPage
  const metrics = page?.metrics || {}

  const series = useMemo(() => {
    const byDate = new Map()
    for (const { key } of SERIES) {
      for (const point of dash?.linkedinSeries?.metrics?.[key]?.values || []) {
        const row = byDate.get(point.date) || { date: point.date, label: shortDate(point.date) }
        row[key] = point.value
        byDate.set(point.date, row)
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [dash?.linkedinSeries])

  if (!isPage) {
    return (
      <p className="px-5 py-4 text-sm text-text-secondary">
        This is a personal LinkedIn profile. LinkedIn gives page totals — impressions, followers
        gained, page views — only for company pages; the post numbers below still apply.
      </p>
    )
  }

  if (page?._error) {
    return <p className="px-5 py-4 text-sm text-text-secondary">Page insights did not load: {page._error}</p>
  }

  const answered = !!dash
  const seriesError = dash?.linkedinSeries?._error

  return (
    <>
      {/* The span LinkedIn actually gave us. It caps page totals at 88 days,
          so at "Last 90 days" this strip and the post strip below cover
          different windows; each says which. */}
      <ScopeBanner
        title="Straight from LinkedIn"
        subtitle="Your whole company page — every post on it, including ones published directly on LinkedIn, plus visits to the page itself."
        right={windowLabel(dash?.insightsFrom, dash?.toDate, Math.min(days, 88))}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border">
        {HEADLINE.map(m => (
          <div key={m.key} className="p-5 bg-white">
            <MetricLabel metric={m.info} label={m.label} icon={m.icon} className="mb-1.5" />
            {answered
              ? <p className="text-2xl font-bold text-text">{display(m.key, totalOf(metrics, m.key))}</p>
              : <Skeleton className="h-8 w-16" />}
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-border flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
        {DETAIL.map(m => (
          <span key={m.key} className="text-text-tertiary inline-flex items-center gap-1">
            {m.label}{' '}
            {answered
              ? <span className="font-semibold text-text">{display(m.key, totalOf(metrics, m.key))}</span>
              : <Skeleton className="inline-block h-3 w-6 align-middle" />}
            <MetricInfoDot metric={m.info} label={m.label} />
          </span>
        ))}
      </div>

      <div className="px-5 pt-4 pb-2 border-t border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-text flex items-center gap-1.5">
            Page activity by day
            <MetricInfoDot metric="li.impressions" label="Page activity by day" />
          </p>
          <div className="flex items-center gap-4">
            {SERIES.map(s => (
              <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
              </span>
            ))}
          </div>
        </div>
        {!answered ? (
          <Skeleton className="h-[200px] w-full" />
        ) : seriesError ? (
          <p className="h-[120px] flex items-center justify-center text-sm text-text-tertiary">Daily numbers did not load: {seriesError}</p>
        ) : series.length === 0 ? (
          <p className="h-[120px] flex items-center justify-center text-sm text-text-tertiary">No daily numbers in this window.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1ef" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }} minTickGap={24} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
              <Tooltip />
              {SERIES.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="px-5 py-2.5 border-t border-border flex items-center gap-2 text-[11px] text-text-tertiary">
        <IconBadge>{Icon.clock}</IconBadge>
        {/* The banner above now carries the scope, so this says only what the
            banner can't: the window's real start, and the two caveats. */}
        <span>
          {dash?.insightsFrom ? `Since ${dash.insightsFrom}. ` : ''}
          {days > 88 && 'LinkedIn page totals cover 88 days at most, so this window is shorter than the one you picked. '}
          Can lag up to 48 hours.
        </span>
      </div>
    </>
  )
}
