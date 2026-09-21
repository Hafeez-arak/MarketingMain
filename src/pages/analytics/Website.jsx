import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, Area, Line, LineChart, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
} from 'recharts'
import { Card, Button, Empty, Skeleton, IconBadge, Spinner } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { MetricInfoDot, ScopeBanner } from '../../components/analytics/MetricLabel'
import { Collapsible } from '../dashboard/Collapsible'
import { ChartCard } from './Dashboard'
import { fmt, pct, plural } from './format'
import { Ga4Panels, BioLinkPanel } from './WebsiteGa4'
import { useWebsiteAnalytics } from './useWebsiteAnalytics'
import { RangePicker } from '../../components/analytics/RangePicker'
import { isCustom, rangeLabel } from '../../lib/dateRange'
import { ExplainPanel, ImageSearchPanel, IndexHealthPanel } from './WebsiteDetail'

// ─── The Website tab ───────────────────────────────────────────────────────
//
// The Analytics page has always answered "how did Instagram do". This answers
// the same question about the thing the Instagram posts are trying to send
// people to, and it is the only channel on this page whose numbers come from
// somebody other than Zernio.
//
// ── THE TWO HALVES, AND WHY THEY ARE LABELLED APART ──
//
// SEARCH CONSOLE is what happens in Google's results: who searched, where we
// ranked, whether they chose us. It stops at the click, because the next thing
// that happens happens on our site, which is not Google's to report.
//
// GA4 starts exactly there: who arrived, by which route, what they read. It
// needs a tag on the website, and until somebody installs one it has nothing
// to report — which is a setup step, shown as steps, and never as a zero.
//
// Their numbers will never agree and the page says so rather than letting a
// reader discover it. A Search Console click is Google's count of a result
// being chosen; a GA4 session is our tag's count of a visit; the gap is ad
// blockers, refused consent, bots, redirects and people who leave before the
// tag fires. Two engagement rates one strip apart already cost this project
// once — see lib/analytics/metricInfo.js.

const COLORS = {
  impressions: '#7d98a1',
  clicks: '#325130',
  position: '#c9a35e',
  band: ['#325130', '#5c7a55', '#a3bf97', '#c9a35e', '#c5ccd4'],
}

const axisTick = { fontSize: 11, fill: '#7a848c' }
const shortDate = iso => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function Tile({ label, metric, value, hint, delta }) {
  return (
    <div className="p-4">
      <p className="eyebrow mb-2 truncate flex items-center gap-1">
        {label}
        <MetricInfoDot metric={metric} label={label} />
      </p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold text-text leading-none tabular-nums">{value}</p>
        {delta}
      </div>
      {hint && <p className="text-[11px] text-text-tertiary mt-1.5 leading-tight">{hint}</p>}
    </div>
  )
}

/**
 * A change, in the units of the tile it sits under.
 *
 * `invert` is for average position, where the arithmetic and the meaning point
 * opposite ways — the number going UP means we rank WORSE. The shift is shown
 * in the tile's own units and only the colour carries the judgement, so the
 * two numbers on one tile can never contradict each other.
 */
function Delta({ value, digits = 0, suffix = '', invert = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (Math.abs(value) < (digits ? 0.05 : 1)) return null
  const good = invert ? value < 0 : value > 0
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${good ? 'text-sage-700' : 'text-rose-600'}`}>
      {value > 0 ? '+' : '−'}{Math.abs(value).toFixed(digits)}{suffix}
    </span>
  )
}

/** A proportion drawn as a bar behind its own label — used for the breakdowns
 *  that are a ranked list rather than a shape over time. */
function ShareRow({ label, sub, value, share, right, color = '#a3bf97' }) {
  return (
    <li className="px-5 py-2.5">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-xs text-text truncate">{label}</span>
        <span className="text-[11px] text-text-secondary tabular-nums flex-shrink-0">{right ?? fmt(value)}</span>
      </div>
      <div className="h-1.5 bg-surface-muted overflow-hidden">
        <div className="h-full" style={{ width: `${Math.max(1, Math.min(100, share))}%`, background: color }} />
      </div>
      {sub && <p className="text-[10px] text-text-tertiary mt-1 tabular-nums">{sub}</p>}
    </li>
  )
}

/**
 * The footer that opens a long list.
 *
 * ── WHY THE FIRST FEW ROWS STAY VISIBLE, RATHER THAN THE WHOLE PANEL FOLDING ──
 *
 * `Collapsible` already exists and folds a section away behind its heading.
 * That is right for the technical notes at the bottom of this page, which you
 * go looking for. It is wrong here: the top queries are the point of the
 * panel, and a reader who has to click to see whether there is anything worth
 * seeing will mostly not click.
 *
 * So the head of the list is always on screen and only the tail folds. The
 * button says how many rows are behind it, because "Show more" alone gives no
 * reason to press it — 22 is a reason.
 *
 * A real <button> with `aria-expanded` and `aria-controls`, not a div with an
 * onClick: the control has to be reachable by keyboard and announced as one.
 * The rows themselves are unmounted rather than hidden with CSS, so a screen
 * reader and a find-in-page agree with what is drawn.
 */
function ShowMore({ open, hidden, onToggle, controls, noun = 'more' }) {
  if (hidden <= 0) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="w-full px-5 py-2.5 border-t border-border flex items-center justify-center gap-1.5
        text-xs font-semibold text-text-secondary hover:bg-surface-subtle transition-colors
        focus:outline-none focus-visible:bg-surface-subtle">
      {open ? 'Show fewer' : `Show ${hidden} ${noun}`}
      <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  )
}

function PanelHead({ title, subtitle, metric, icon = Icon.activity, tone = 'steel', right }) {
  return (
    <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <IconBadge tone={tone}>{icon}</IconBadge>
        <div className="min-w-0">
          <h3 className="font-semibold text-text text-sm leading-tight flex items-center gap-1.5">
            {title}
            <MetricInfoDot metric={metric} label={title} />
          </h3>
          {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

/** The steps, not a shrug. Every credential on this page is one somebody has
 *  to create by hand once, and "not connected" with nothing to do about it is
 *  the least useful thing a panel can say. */
export function SetupSteps({ title, description, steps = [], error, action }) {
  return (
    <div className="p-5">
      <p className="text-sm text-text-secondary mb-1">{description}</p>
      {error && <p className="text-xs text-rose-600 mb-3">{error}</p>}
      {title && <p className="eyebrow mt-4 mb-2">{title}</p>}
      <ol className="space-y-1.5 mb-4">
        {steps.map((step, i) => (
          <li key={step} className="text-xs text-text-secondary flex gap-2.5">
            <span className="w-4 h-4 border border-border bg-surface-subtle flex items-center justify-center
              text-[10px] font-bold text-text-tertiary flex-shrink-0 tabular-nums">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {action}
    </div>
  )
}

const PRIORITY = {
  high: { label: 'Now', classes: 'bg-rose-50 text-rose-600 border-rose-200' },
  medium: { label: 'Soon', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: 'Watch', classes: 'bg-stone-100 text-stone-600 border-stone-300' },
}
const KIND_NOTE = {
  'missing-page': 'Missing page',
  'new-page': 'Missing page',
  rewrite: 'Title & description',
  rising: 'Demand appearing',
  falling: 'Visibility lost',
}

export function WebsiteSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading website analytics">
      <Card className="overflow-hidden">
        <div className="px-5 py-2.5 bg-surface-subtle border-b border-border"><Skeleton className="h-3 w-64" /></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="p-4"><Skeleton className="h-2.5 w-20 mb-2.5" /><Skeleton className="h-7 w-16" /></div>
          ))}
        </div>
      </Card>
      <Card className="p-5"><Skeleton className="h-3.5 w-40 mb-4" /><Skeleton className="h-[240px] w-full" /></Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <Card key={i} className="p-5"><Skeleton className="h-3.5 w-32 mb-4" /><Skeleton className="h-[200px] w-full" /></Card>
        ))}
      </div>
    </div>
  )
}

/**
 * The tab as the page mounts it.
 *
 * The fetch lives here and not in the Analytics page, so that twenty-eight
 * Google requests are made when somebody actually opens the Website tab
 * rather than on every visit to /analytics to look at Instagram.
 *
 * `WebsiteAnalytics` below stays a pure function of its props, which is what
 * lets the whole tab be rendered against a recorded payload with no network,
 * no auth and no workspace.
 */
export function WebsiteTab() {
  return <WebsiteAnalytics {...useWebsiteAnalytics()} />
}

/**
 * How many rows of a long table are worth showing unprompted.
 *
 * Three, because that is where the list stops being a headline and starts
 * being a reference. The top three queries answer "what is this site known
 * for"; rows four to twenty-five answer "what else", which is a question you
 * ask deliberately.
 */
const PREVIEW_ROWS = 3

export function WebsiteAnalytics(w) {
  const navigate = useNavigate()
  // Declared before every early return below — a hook behind a condition is a
  // hook that changes order between renders.
  const [allQueries, setAllQueries] = useState(false)
  const queryBodyId = useId()
  const {
    range, setRange, days, loading, refreshing, refresh, error,
    search, ga4, bio, usable, summary, daily, types, bands, coverage, queries,
    pages, hosts, countries, devices, appearance, sitemaps, recommendations, ga4Summary,
    arrivals, arrivalsSummary,
    image, index, runIndexHealth, explain, runExplain, canExplain,
  } = w

  if (loading) return <WebsiteSkeleton />

  if (error) {
    return (
      <Card>
        <Empty icon={Icon.activity} title="Could not load website analytics" description={error}
          action={<Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>} />
      </Card>
    )
  }

  const host = (search?.site || '').replace(/^sc-domain:/, '')
  // The length the SERVER used, not one recomputed from the dates.
  //
  // `windowLabel` measures the gap between two days, which is right for Meta's
  // exclusive since/until range and one short for this one: Search Console's
  // window is inclusive at both ends, so 2026-08-21 to 2026-09-17 is 28 days
  // and the gap between them is 27. `searchWindows` built the range from
  // `days` in the first place, so the authoritative number is already here and
  // there is nothing to infer.
  // A fixed window is named by its dates; a rolling one by its length. Either
  // way the number comes from the SERVER's window, not one recomputed here.
  const serverDays = search?.windows?.days || days
  const label = isCustom(range) && search?.windows?.current
    ? rangeLabel({ from: search.windows.current.start, to: search.windows.current.end })
    : `Last ${serverDays} days`

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {/* A week is the floor here, not a style choice: below it a weekday
          effect reads as a trend and this site's volume makes three days
          mostly zeroes. The server refuses a shorter one too. */}
      <RangePicker value={range} onChange={setRange} presets={[7, 28, 90]} minDays={7} />
      <Button size="sm" variant="secondary" onClick={refresh} disabled={refreshing}>
        {refreshing ? <><Spinner size="sm" /> Refreshing…</> : 'Refresh'}
      </Button>
      <span className="text-[11px] text-text-tertiary">
        {host || 'No property configured'}
      </span>
    </div>
  )

  // ── Search Console not set up ──
  if (search && !search.configured) {
    return (
      <div className="space-y-4">
        {toolbar}
        <Card className="overflow-hidden">
          <PanelHead title="Search Console is not connected" icon={Icon.trending} tone="sage"
            subtitle="Nothing to read until a property is set up" />
          <SetupSteps description="Google Search Console is where the search half of this page comes from."
            error={search.error} steps={search.setup || []}
            action={<Button size="sm" variant="secondary" onClick={() => navigate('/brand-brain')}>Open Brand Brain</Button>} />
        </Card>
        <Ga4Panels ga4={ga4} summary={ga4Summary} days={days} />
      <BioLinkPanel ga4={ga4} bio={bio} arrivals={arrivals} summary={arrivalsSummary} days={days} />
      </div>
    )
  }

  // ── Set up and failing ──
  // Never folded into "no data". A dead credential that reads as "nobody is
  // searching for us" is the silent failure this project has paid for twice.
  if (search && !search.ok) {
    return (
      <div className="space-y-4">
        {toolbar}
        <Card className="overflow-hidden">
          <PanelHead title="Search Console did not answer" icon={Icon.trending} tone="sage" subtitle={host} />
          <div className="p-5">
            <Empty icon={Icon.activity} title="This is a connection problem, not an empty month"
              description={`${search.error} The numbers would be wrong, so none are shown.`}
              action={<Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>} />
          </div>
        </Card>
        <Ga4Panels ga4={ga4} summary={ga4Summary} days={days} />
      <BioLinkPanel ga4={ga4} bio={bio} arrivals={arrivals} summary={arrivalsSummary} days={days} />
      </div>
    )
  }

  const noRows = !usable || !summary || summary.impressions === 0
  const imageType = types.find(t => t.type === 'image')
  // The head of the list always; the tail only when asked for. See ShowMore.
  const shownQueries = allQueries ? queries : queries.slice(0, PREVIEW_ROWS)

  return (
    <div className="space-y-4">
      {toolbar}

      {/* A part of the pull failing must not look like a quiet week in that
          one panel, so it is named at the top rather than left to be inferred
          from an empty table. */}
      {search?.warnings?.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
          Some panels could not be loaded: {search.warnings.map(x => x.part).join(', ')}. Everything else on this page is complete.
        </p>
      )}

      {/* ── What this means ──
          Above the numbers rather than below them, because it is the only
          panel on the page written for somebody who does not already know how
          to read the rest. It renders whatever state it is in — including
          "not asked for yet", which is what it is on every page load. */}
      {usable && summary && summary.impressions > 0 && (
        <ExplainPanel explain={explain} onRun={runExplain} canRun={canExplain} />
      )}

      {noRows ? (
        <Card className="overflow-hidden">
          <PanelHead title="Website search" subtitle={host} icon={Icon.trending} tone="sage" />
          <div className="p-5">
            <Empty title="No search impressions in this window"
              description="The property answered and had nothing to report. For a site with very little search presence that is a real answer, not a failure." />
          </div>
        </Card>
      ) : (
        <>
          {/* ── What Google measured ── */}
          <Card className="overflow-hidden">
            <ScopeBanner
              title={`Google Search Console · ${label}`}
              subtitle={`What happens in Google's results for ${host}. Ends three days back, because the last few days are still settling and a window that includes them reads as a decline every time.`} />
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
              <Tile label="Impressions" metric="site.impressions" value={fmt(summary.impressions)}
                hint="Times we appeared in web results"
                delta={<Delta value={summary.impressionsDelta} />} />
              <Tile label="Clicks" metric="site.clicks" value={fmt(summary.clicks)}
                hint="Times somebody chose us"
                delta={<Delta value={summary.clicksDelta} />} />
              <Tile label="Click rate" metric="site.ctr" value={pct(summary.ctr)}
                hint="Appearances that became a click"
                delta={<Delta value={summary.ctrDelta} digits={1} suffix="pp" />} />
              <Tile label="Avg position" metric="site.position"
                value={summary.position === null ? '—' : summary.position.toFixed(1)}
                hint="Weighted by impressions"
                delta={<Delta value={summary.positionDelta === null ? null : -summary.positionDelta} digits={1} invert />} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border border-t border-border">
              {/* The number nobody thinks to ask for, and the one that matters.
                  On a small site most clicks are people typing the company's
                  own name, so counting those as demand makes a brand look like
                  it is winning a category it has not entered. */}
              <Tile label="Non-brand" metric="site.non_brand" value={fmt(summary.nonBrand.impressions)}
                hint="People not searching our name"
                delta={<Delta value={summary.nonBrandDelta} />} />
              <Tile label="Brand" metric="site.non_brand" value={fmt(summary.brand.impressions)}
                hint={`${fmt(summary.brand.clicks)} of ${fmt(summary.clicks)} clicks`} />
              <Tile label="Named queries" metric="site.coverage" value={fmt(summary.queries)}
                hint={coverage ? `${pct(coverage.share)} of impressions` : 'Distinct searches'} />
              <Tile label="All surfaces" metric="site.surfaces" value={fmt(summary.allSurfaces.impressions)}
                hint="Web, images, video and news together" />
            </div>

            {summary.baseline && (
              <p className="px-5 py-2.5 text-[11px] text-text-tertiary border-t border-border bg-surface-subtle">
                This is the first measured period for this window — the property holds nothing before it, so nothing
                here is a rise or a fall, and no deltas are shown. The next period has a baseline to move against.
              </p>
            )}
          </Card>

          {/* ── Search performance over time ── */}
          <ChartCard title="Search performance" metric="site.impressions"
            subtitle="Impressions and clicks per day. The dashed line is where the previous period ends."
            icon={Icon.trending} tone="sage">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e6e1" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e8e6e1' }}
                  tickFormatter={shortDate} minTickGap={28} />
                <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmt} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false}
                  tickFormatter={fmt} />
                <Tooltip
                  labelFormatter={shortDate}
                  formatter={(v, name) => [name === 'Click rate' ? pct(v) : fmt(v), name]}
                  contentStyle={{ fontSize: 12, border: '1px solid #e8e6e1', borderRadius: 0 }} />
                {/* Where the window being reported begins. Without it the chart
                    shows 56 days and nothing says which 28 the tiles above are
                    counting. */}
                {daily.find(d => d.current) && (
                  <ReferenceLine yAxisId="left" x={daily.find(d => d.current).date}
                    stroke="#b9a88f" strokeDasharray="4 4" />
                )}
                <Area yAxisId="left" type="monotone" dataKey="impressions" name="Impressions"
                  stroke={COLORS.impressions} fill={COLORS.impressions} fillOpacity={0.18} strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="clicks" name="Clicks"
                  stroke={COLORS.clicks} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ── Average position over time ── */}
            <ChartCard title="Average position" metric="site.position"
              subtitle="Lower is better, so the axis runs the other way up" icon={Icon.activity}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8e6e1" vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e8e6e1' }}
                    tickFormatter={shortDate} minTickGap={28} />
                  {/* Reversed, because rank 1 is the top. Drawn the normal way
                      up, every improvement looks like a fall. */}
                  <YAxis reversed domain={['dataMin - 2', 'dataMax + 2']} tick={axisTick}
                    tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(0)} />
                  <Tooltip labelFormatter={shortDate}
                    formatter={v => [v === null ? '—' : v.toFixed(1), 'Position']}
                    contentStyle={{ fontSize: 12, border: '1px solid #e8e6e1', borderRadius: 0 }} />
                  {/* connectNulls off: a day with no impressions has no rank at
                      all, and joining across it invents a measurement. */}
                  <Line type="monotone" dataKey="position" name="Position" stroke={COLORS.position}
                    strokeWidth={2} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* ── Where our visibility actually sits ── */}
            <ChartCard title="Impressions by rank" metric="site.bands"
              subtitle="One average position describes no page on the site; this splits it" icon={Icon.grid}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bands} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8e6e1" horizontal={false} />
                  <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="label" width={104} tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(v, _n, p) => [`${fmt(v)} impressions · ${p.payload.queries} queries · ${fmt(p.payload.clicks)} clicks`, p.payload.note]}
                    contentStyle={{ fontSize: 12, border: '1px solid #e8e6e1', borderRadius: 0 }} />
                  <Bar dataKey="impressions" name="Impressions">
                    {bands.map((b, i) => <Cell key={b.key} fill={COLORS.band[i] || '#c5ccd4'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {coverage && (
                <p className="text-[11px] text-text-tertiary mt-3 leading-relaxed">
                  Computed over the {fmt(coverage.namedQueries)} queries Google will name, which hold{' '}
                  {fmt(coverage.named)} of {fmt(coverage.all)} impressions ({pct(coverage.share)}). The rest are
                  searches too rare for Google to attribute without identifying the searcher.
                </p>
              )}
            </ChartCard>
          </div>

          {/* ── Search surfaces ── */}
          {types.length > 1 && (
            <Card className="overflow-hidden">
              <PanelHead title="Search surfaces" metric="site.surfaces" icon={Icon.image} tone="sage"
                subtitle="The same site, measured separately on each of Google's surfaces" />
              <ul className="divide-y divide-border">
                {types.map(t => (
                  <ShareRow key={t.type} label={t.label} share={t.share}
                    color={t.type === 'web' ? COLORS.clicks : COLORS.impressions}
                    right={`${plural(t.impressions, 'impression')} · ${plural(t.clicks, 'click')}`}
                    sub={`${pct(t.share)} of all impressions · click rate ${pct(t.ctr)} · position ${t.position === null ? '—' : t.position.toFixed(1)}`} />
                ))}
              </ul>
              {imageType && imageType.impressions > 0 && (
                <p className="px-5 py-3 text-[11px] text-text-tertiary border-t border-border bg-surface-subtle leading-relaxed">
                  Image search is {pct(imageType.share)} of this site's visibility at position{' '}
                  {imageType.position === null ? '—' : imageType.position.toFixed(1)} — visibility the web numbers
                  above do not include, and nothing else in this app has ever counted.
                </p>
              )}
            </Card>
          )}

          {/* ── What image search is being asked for ──
              Immediately under the surfaces panel, which is where the reader
              has just been told image search is a fifth of their visibility
              and earns nothing. The explanation belongs next to the claim. */}
          <ImageSearchPanel image={image} />

          {/* ── What people searched ── */}
          <Card className="overflow-hidden">
            {/* The subtitle has two jobs and they move independently: how much
                of the table is on screen, and how much of the property's
                visibility the table can account for at all. The second must
                not change when somebody presses a button, and the first must
                not claim twenty-five rows while three are showing. */}
            <PanelHead title="Search queries" metric="site.coverage" icon={Icon.cursor}
              subtitle={coverage
                ? `${allQueries ? `Top ${queries.length}` : `${shownQueries.length} of the top ${queries.length}`}` +
                  ` · ${fmt(coverage.namedQueries)} named queries hold ${pct(coverage.share)} of impressions`
                : 'What people typed to reach us'} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Query</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Impr.</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Clicks</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">CTR</th>
                    <th className="text-right px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Pos.</th>
                  </tr>
                </thead>
                <tbody id={queryBodyId} className="divide-y divide-border">
                  {shownQueries.map(q => (
                    <tr key={q.query} className="hover:bg-surface-subtle">
                      <td className="px-5 py-2.5 max-w-0">
                        {/* dir="auto" per cell, not on the table: these rows are
                            Arabic and English mixed, and a query's direction is
                            a property of that query. Without it an Arabic query
                            drags the punctuation around it to the wrong end. */}
                        <span dir="auto" className="block truncate text-text">{q.query}</span>
                        <span className="flex items-center gap-1.5 mt-0.5">
                          {q.brand && (
                            <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-1 py-px
                              bg-amber-50 text-amber-700 border border-amber-200 leading-[1.5]">Brand</span>
                          )}
                          {q.page && <span className="text-[10px] text-text-tertiary font-mono truncate">{q.page}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{fmt(q.impressions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{fmt(q.clicks)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{pct(q.ctr)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-text-secondary">{q.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ShowMore open={allQueries} hidden={queries.length - PREVIEW_ROWS}
              onToggle={() => setAllQueries(v => !v)} controls={queryBodyId} noun="more queries" />
          </Card>

          {/* ── What to do about it ──
              The same seoRecommendations() the dashboard card calls, on the
              same rows, so the two screens cannot rank one week differently.
              Open by default here: the dashboard folds them away because the
              urgent ones already appear above it in "What to do now", and on
              this page nothing else is saying them. */}
          <Card className="overflow-hidden">
            <PanelHead title="What to do about it" icon={Icon.checkCircle} tone="sage"
              subtitle="Computed from the numbers above — no guesswork, and the same list the dashboard shows" />
            {recommendations.length === 0 ? (
              <p className="px-5 py-5 text-xs text-text-tertiary">
                Nothing clears the reporting floor this period. That is a real answer at this volume, not a gap.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {recommendations.map(r => {
                  const tone = PRIORITY[r.priority] || PRIORITY.low
                  return (
                    <li key={r.id} className="px-5 py-3">
                      <div className="flex items-start gap-2.5">
                        <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border
                          leading-[1.4] flex-shrink-0 mt-0.5 ${tone.classes}`}>{tone.label}</span>
                        <div className="min-w-0 flex-1">
                          <p dir="auto" className="text-sm text-text leading-snug">{r.title}</p>
                          <p className="text-xs text-text-secondary mt-1 leading-relaxed">{r.action}</p>
                          <p className="text-[11px] text-text-tertiary mt-1.5 tabular-nums">
                            {KIND_NOTE[r.kind] || r.kind}
                            {typeof r.impressions === 'number' && ` · ${fmt(r.impressions)} impressions`}
                            {typeof r.position === 'number' && r.position > 0 && ` · position ${r.position.toFixed(1)}`}
                          </p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* ── Is Google holding these pages at all ──
              After the recommendations and before the page tables, because
              it reframes both: a recommendation to rewrite a page Google has
              never fetched is wasted work, and a page missing from the table
              below may be missing from the index rather than from demand. */}
          <IndexHealthPanel index={index} onRun={runIndexHealth} />

          {/* ── Pages, countries, devices ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="overflow-hidden">
              <PanelHead title="Pages taking impressions" icon={Icon.document}
                subtitle="Arabic and English folded together, as are the www and http variants" />
              <ul className="divide-y divide-border">
                {pages.map(p => (
                  <ShareRow key={p.path} label={p.label}
                    share={pages[0]?.impressions ? (p.impressions / pages[0].impressions) * 100 : 0}
                    right={`${fmt(p.impressions)} · pos ${p.position === null ? '—' : p.position.toFixed(1)}`}
                    sub={`${plural(p.clicks, 'click')} · CTR ${pct(p.ctr)}${p.variants > 1 ? ` · ${p.variants} URL variants` : ''}`} />
                ))}
              </ul>
            </Card>

            <div className="space-y-4">
              <Card className="overflow-hidden">
                <PanelHead title="Where they searched from" icon={Icon.users}
                  subtitle={`Top ${countries.length} countries by impressions`} />
                <ul className="divide-y divide-border">
                  {countries.map(c => (
                    <ShareRow key={c.code} label={c.name} share={c.share}
                      right={`${fmt(c.impressions)} · ${pct(c.share)}`}
                      sub={`${plural(c.clicks, 'click')} · position ${c.position === null ? '—' : c.position.toFixed(1)}`} />
                  ))}
                </ul>
              </Card>

              <Card className="overflow-hidden">
                <PanelHead title="Device" icon={Icon.eye} subtitle="Impressions and how each one ranks" />
                <ul className="divide-y divide-border">
                  {devices.map(d => (
                    <ShareRow key={d.device} label={d.label} share={d.share}
                      right={`${fmt(d.impressions)} · ${pct(d.share)}`}
                      sub={`${plural(d.clicks, 'click')} · CTR ${pct(d.ctr)} · position ${d.position === null ? '—' : d.position.toFixed(1)}`} />
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          {/* ── The technical notes: hosts, sitemaps, rich results ──
              Folded away. None of it changes week to week, and all of it is
              the kind of thing you go looking for once something above looks
              wrong — which is exactly what a Collapsible is for. */}
          <Card className="overflow-hidden">
            <PanelHead title="Indexing and delivery" metric="site.sitemap" icon={Icon.clock}
              subtitle="Why Google can or cannot see the site — the cheapest explanation for a page taking no impressions" />

            {sitemaps.length === 0 ? (
              <p className="px-5 py-4 text-xs text-text-tertiary">
                No sitemap is submitted for this property.{' '}
                {search?.sitemapError ? `(${search.sitemapError})` : 'Submitting one is the cheapest way to tell Google which pages exist.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {sitemaps.map(s => (
                  <li key={s.path} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-text font-mono truncate">{s.path}</span>
                      {s.stale
                        ? <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border
                            border-rose-200 bg-rose-50 text-rose-600 leading-[1.4] flex-shrink-0">Stale</span>
                        : <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border
                            border-sage-200 bg-sage-100 text-sage-800 leading-[1.4] flex-shrink-0">Read</span>}
                    </div>
                    <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">
                      {s.neverDownloaded
                        ? 'Google has never downloaded this sitemap.'
                        : `Last read by Google ${s.staleDays} days ago; submitted ${s.submittedDays} days ago.`}
                      {s.errors > 0 && ` ${s.errors} error${s.errors === 1 ? '' : 's'}.`}
                      {s.warnings > 0 && ` ${s.warnings} warning${s.warnings === 1 ? '' : 's'}.`}
                      {s.offCanonicalHost && ' It points at the www host, which redirects to the canonical one — Google follows the redirect, but this usually means the sitemap has not been resubmitted since the canonical host changed.'}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {hosts.length > 1 && (
              <Collapsible title="Hosts taking impressions"
                subtitle="A domain property reports every host separately" count={hosts.length}>
                <ul className="divide-y divide-border border-t border-border">
                  {hosts.map(h => (
                    <ShareRow key={h.host} label={h.host} share={h.share}
                      right={`${fmt(h.impressions)} · ${pct(h.share)}`}
                      sub={h.canonical ? 'The canonical host' : 'Redirects to the canonical host — impressions here mean something still links to it'} />
                  ))}
                </ul>
              </Collapsible>
            )}

            <Collapsible title="How results appeared"
              subtitle="Rich results, translated results and the rest" count={appearance.length}>
              {appearance.length === 0 ? (
                <p className="px-5 py-4 text-xs text-text-tertiary border-t border-border">
                  Google reported no special result types for this property. Every result was a plain blue link —
                  a real answer, and the opening for structured data if the site has products, FAQs or events to mark up.
                </p>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {appearance.map(a => (
                    <ShareRow key={a.key} label={a.label} share={100}
                      right={`${plural(a.impressions, 'impression')} · ${plural(a.clicks, 'click')}`}
                      sub={`CTR ${pct(a.ctr)} · position ${a.position === null ? '—' : a.position.toFixed(1)}`} />
                  ))}
                </ul>
              )}
            </Collapsible>
          </Card>
        </>
      )}

      {/* ── The website's own numbers ── */}
      <Ga4Panels ga4={ga4} summary={ga4Summary} days={days} />
      <BioLinkPanel ga4={ga4} bio={bio} arrivals={arrivals} summary={arrivalsSummary} days={days} />
    </div>
  )
}
