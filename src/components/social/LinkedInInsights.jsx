import { useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { IconBadge, Skeleton } from '../ui/index'
import { Icon } from '../ui/icons'
import { fmt } from '../../pages/analytics/format'

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

const HEADLINE = [
  { key: 'impressions', label: 'Impressions', icon: Icon.eye },
  { key: 'unique_impressions', label: 'Members reached', icon: Icon.users },
  { key: 'clicks', label: 'Clicks', icon: Icon.cursor },
  { key: 'engagement_rate', label: 'Engagement rate', icon: Icon.activity },
  { key: 'followers_gained', label: 'New followers', icon: Icon.trending },
  { key: 'page_views_total', label: 'Page views', icon: Icon.document },
]

const DETAIL = [
  { key: 'likes', label: 'Reactions' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Reposts' },
  { key: 'page_views_overview', label: 'Overview views' },
  { key: 'page_views_careers', label: 'Careers views' },
  { key: 'page_views_jobs', label: 'Jobs views' },
  { key: 'page_views_life', label: 'Life views' },
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
  // LinkedIn reports engagement as a 0..1 fraction.
  if (key === 'engagement_rate') return `${(value * 100).toFixed(1)}%`
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border">
        {HEADLINE.map(m => (
          <div key={m.key} className="p-5 bg-white">
            <p className="text-xs text-text-tertiary mb-1.5 flex items-center gap-1.5">
              <span className="text-text-tertiary">{m.icon}</span>{m.label}
            </p>
            {answered
              ? <p className="text-2xl font-bold text-text">{display(m.key, totalOf(metrics, m.key))}</p>
              : <Skeleton className="h-8 w-16" />}
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-border flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
        {DETAIL.map(m => (
          <span key={m.key} className="text-text-tertiary">
            {m.label}{' '}
            {answered
              ? <span className="font-semibold text-text">{display(m.key, totalOf(metrics, m.key))}</span>
              : <Skeleton className="inline-block h-3 w-6 align-middle" />}
          </span>
        ))}
      </div>

      <div className="px-5 pt-4 pb-2 border-t border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-text">Page activity by day</p>
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
        <span>
          Whole page{dash?.insightsFrom ? ` since ${dash.insightsFrom}` : ''} — every post, including ones made directly on LinkedIn.
          {' '}LinkedIn counts impressions, not views, on ordinary posts.
          {days > 88 && ' LinkedIn page totals cover 88 days at most.'}
          {' '}Can lag up to 48 hours.
        </span>
      </div>
    </>
  )
}
