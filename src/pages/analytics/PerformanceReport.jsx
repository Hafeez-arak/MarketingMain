import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { Card, Empty, Skeleton, PillSelect, Button } from '../../components/ui/index'
import {
  ReportDoc, ReportToolbar, ReportMasthead, ReportSection, StatBand,
  ReportTable, ReportRow, Cell, Caveats, ReportFooter,
} from '../../components/report/ReportShell'
import { useReportFilename } from '../../lib/reports/print'
import {
  fetchPerformanceReport, periodLabel, headline, summaryStats, channelRows,
  caveats, big, avg, changeLabel, stateWord, pageInsightRows,
} from '../../lib/reports/performanceReport'

// ─── /analytics/report — how our posts are doing, on one or two sheets ─────
// The Analytics page is four graphs and an account picker: excellent for
// "what happened on Instagram on the 9th", useless for "send me how we did
// last month". This is the second thing — a document, one page where the
// month allows it, that states the numbers, names the strongest channel, and
// is honest about which of the four channels it could not measure.
//
// ── WHY THE CAVEATS ARE ON PAGE ONE AND NOT AN APPENDIX ──
//
// Arak's measured sample is single digits today. Every average on this sheet
// is exact and almost none of them is yet representative, and those are not
// the same claim. A report that prints "3.5 interactions per post" without
// "over 2 measured posts" next to it is not shorter, it is wrong — so the
// sample size travels with the figure and the caveats block is part of the
// report rather than something under a fold.

/** LinkedIn page insights refuse a window longer than 88 days. */
const PERIODS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 88, label: 'Last 88 days' },
]

const fmtDay = iso => {
  const t = Date.parse(iso || '')
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—'
}

/** A caption trimmed to a line, since the sheet has one line for it. */
const oneLine = (text, max = 68) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled post'
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function ReportSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Building the report">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export function PerformanceReport() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const [days, setDays] = useState(30)
  // Separate from `!data`, which is also true before the first answer — see
  // the no-placeholder-flash rule: a page that paints zeros and "Not
  // connected" for half a second teaches people the product is broken.
  const [loaded, setLoaded] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  // A counter, not a re-set of `days`: setDays(d => d) stores the same value,
  // React bails out of the render, and the effect never re-runs — so "Try
  // again" would do nothing at all, which is the one thing a retry button
  // must not do.
  const [tick, setTick] = useState(0)

  // The skeleton is re-armed by whoever asks for a new report — the period
  // picker and the retry button — rather than by the effect body. Calling
  // setState synchronously in an effect cascades a render, and React's lint
  // rule is right to refuse it; the two callers are the only ways in.
  const reload = useCallback(() => {
    setLoaded(false)
    setError('')
    setTick(t => t + 1)
  }, [])

  const changePeriod = useCallback(next => {
    setLoaded(false)
    setError('')
    setDays(next)
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let cancelled = false
    fetchPerformanceReport({ workspaceId: activeWorkspaceId, accessToken, periodDays: days })
      .then(out => {
        if (cancelled) return
        if (out?.ok) setData(out)
        else setError(out?.error || 'The report could not be built.')
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken, days, tick])

  const brand = activeWorkspace?.name || 'This brand'
  // NOT named `window`. It shadowed the global inside this component, which is
  // fine until the day something here reaches for window.print or
  // window.location and silently gets a date string.
  const windowLabel = useMemo(() => periodLabel(data?.period), [data])

  // Named before the print dialog opens, or every report saves over the last
  // one as "Arak Marketing.pdf".
  useReportFilename(
    data ? `${brand} — performance report — ${String(data.period?.end || '').slice(0, 10)}` : '',
  )

  const rows = useMemo(() => channelRows(data), [data])
  const stats = useMemo(() => summaryStats(data), [data])
  const notes = useMemo(() => caveats(data), [data])
  const pages = useMemo(() => pageInsightRows(data), [data])
  const best = data?.best_posts || []

  if (!activeWorkspaceId) {
    return <Empty title="No workspace selected" description="Pick a workspace to build its report." />
  }

  return (
    <div className="max-w-[900px]">
      <ReportToolbar backTo="/analytics" backLabel="Back to analytics">
        <PillSelect value={String(days)} onChange={e => changePeriod(Number(e.target.value))} className="w-36">
          {PERIODS.map(p => <option key={p.days} value={p.days}>{p.label}</option>)}
        </PillSelect>
      </ReportToolbar>

      {!loaded ? (
        <Card className="p-6"><ReportSkeleton /></Card>
      ) : error ? (
        <Card className="p-6">
          <Empty
            title="Could not build the report"
            description={`${error} This is a connection or permission problem rather than missing data — nothing has been lost.`}
            action={<Button onClick={reload}>Try again</Button>}
          />
        </Card>
      ) : (
        <Card className="p-7 print:border-0 print:shadow-none print:p-0">
          <ReportDoc>
            <ReportMasthead
              kind="Performance report"
              brand={brand}
              line={headline(data)}
              meta={[windowLabel, `${data.period?.days} days`]}
            />

            <StatBand stats={stats} />

            <ReportSection
              title="By channel"
              note="Every channel we could be publishing on, including the ones we are not. Interactions are likes, comments, shares and saves — not reach, which measures how far the platform chose to push a post rather than whether anyone cared."
            >
              <ReportTable
                head={[
                  { label: 'Channel' },
                  { label: 'Followers', align: 'right' },
                  { label: 'Posts', align: 'right' },
                  { label: 'Measured', align: 'right' },
                  { label: 'Avg / post', align: 'right' },
                  { label: 'vs previous', align: 'right' },
                  { label: 'Status' },
                ]}
              >
                {rows.map(p => (
                  <ReportRow key={p.platform}>
                    <Cell first>
                      <span className="font-semibold">{p.label}</span>
                      {p.username && <span className="text-text-tertiary"> @{p.username}</span>}
                    </Cell>
                    <Cell align="right">{p.connected ? big(p.followers) : '—'}</Cell>
                    <Cell align="right">{p.connected ? p.posts : '—'}</Cell>
                    <Cell align="right">{p.connected ? p.measured : '—'}</Cell>
                    <Cell align="right">{avg(p.avg_engagement)}</Cell>
                    <Cell
                      align="right"
                      className={p.change?.direction === 'up' ? 'text-sage-700'
                        : p.change?.direction === 'down' ? 'text-red-600' : ''}
                    >
                      {changeLabel(p.change)}
                    </Cell>
                    <Cell muted={p.state !== 'measured'}>{stateWord(p.state)}</Cell>
                  </ReportRow>
                ))}
              </ReportTable>

              {/* The per-channel sentences, for the rows that have nothing in
                  their number columns. Without these a dark channel is one
                  word, "Not connected", and the reader has to already know
                  what that costs. */}
              {rows.filter(p => p.note).length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {rows.filter(p => p.note).map(p => (
                    <li key={p.platform} className="text-[11px] text-text-tertiary leading-relaxed">
                      <span className="font-semibold text-text-secondary">{p.label}:</span> {p.note}
                    </li>
                  ))}
                </ul>
              )}
            </ReportSection>

            {/* ── Page-level totals ──
                A different measurement from the table above, and kept apart
                on purpose: that table counts interactions on posts WE
                published, this counts everything the page did. ARAK's
                LinkedIn row reads one post and 17 interactions while its page
                reads 2,433 impressions and 52 new followers over the same
                window. Merging them would tell a reader the brand's strongest
                channel is doing nothing. */}
            {pages.map(page => (
              <ReportSection
                key={page.platform}
                title={`${page.label} page — everything on it`}
                note={`Whole-page totals for ${page.name}, including posts made directly on ${page.label} rather than through this app. Not comparable to the per-post averages above.`}
                keep
              >
                <div className="grid grid-cols-4 gap-px bg-border border border-border">
                  {page.stats.map(s => (
                    <div key={s.label} className="bg-white px-3 py-2">
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
                        {s.label}
                      </p>
                      <p className="mt-0.5 text-base font-semibold tabular-nums leading-none text-text">
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>
              </ReportSection>
            ))}

            {best.length > 0 && (
              <ReportSection
                title="Best posts of the period"
                note="Ranked by interactions. Posts with no analytics row are absent rather than last — we do not know how they did, which is not the same as knowing they did badly."
              >
                <ReportTable
                  head={[
                    { label: 'Post' },
                    { label: 'Channel' },
                    { label: 'Date' },
                    { label: 'Interactions', align: 'right' },
                    { label: 'Reach', align: 'right' },
                  ]}
                >
                  {best.map(p => (
                    <ReportRow key={p.id}>
                      <Cell first>
                        <span className="block">{oneLine(p.topic)}</span>
                        {p.posted_directly && (
                          <span className="text-[10px] text-text-tertiary">
                            posted directly on the platform, not through this app
                          </span>
                        )}
                      </Cell>
                      <Cell>{p.label}</Cell>
                      <Cell>{fmtDay(p.published_at)}</Cell>
                      <Cell align="right" className="font-semibold">{big(p.engagement)}</Cell>
                      <Cell align="right" muted>{big(p.reach ?? p.views)}</Cell>
                    </ReportRow>
                  ))}
                </ReportTable>
              </ReportSection>
            )}

            <Caveats items={notes} />

            <ReportFooter>
              {brand} · performance for {windowLabel} · generated{' '}
              {new Date(data.generated_at).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              . Every figure on this sheet is computed in code from analytics synced off the
              platforms themselves — none of it is written or estimated by a model.
            </ReportFooter>
          </ReportDoc>
        </Card>
      )}
    </div>
  )
}
