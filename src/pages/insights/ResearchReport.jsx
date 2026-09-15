import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Card, Empty, Skeleton, PillSelect, Button } from '../../components/ui/index'
import { fetchRuns } from '../../lib/agentRun'
import {
  ReportDoc, ReportToolbar, ReportMasthead, ReportSection,
  ReportTable, ReportRow, Cell, Caveats, ReportFooter,
} from '../../components/report/ReportShell'
import { useReportFilename } from '../../lib/reports/print'
import {
  splitByAudience, partitionByClock, lensStates, lensHeadline, ownChannelRows,
  marketDirection, actionPlan, deadlineLabel, basisLabel, compact, signed, pct,
} from '../../lib/researchBrief'

// ─── /insights/report — the research brief, as a document ──────────────────
// The Research tab is built for reading on a screen: a sticky rail, four
// zones, folds that open. None of that survives paper, and none of it helps
// the person who has to forward this week's findings to someone who does not
// have a login.
//
// So this is the same brief, flattened into the order a reader without a
// scroll bar needs: what moved, what to do about it, the evidence under it,
// and how much of the run actually worked. Every section comes out of
// researchBrief.js — the identical selectors the tab renders from — so the
// sheet and the screen can never disagree about what the run said.
//
// ── WHAT IS DELIBERATELY DROPPED ──
//
// Sources are printed as plain domains rather than links, findings that have
// already passed their date are omitted, and the per-lens audit strip becomes
// two lines. A brief is a queue of things to do; anything that cannot change
// what someone does this week is weight on a page that has to be readable in
// one sitting.

const fmtDate = iso => {
  const t = Date.parse(iso || '')
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
}

/** A source list as bare domains — a printed URL nobody can click is noise. */
function sourceLine(sources = []) {
  const domains = [...new Set(
    sources.map(s => {
      try { return new URL(s.url || s).hostname.replace(/^www\./, '') } catch { return '' }
    }).filter(Boolean),
  )]
  return domains.length ? domains.slice(0, 4).join(', ') : ''
}

function ReportSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the brief">
      <Skeleton className="h-6 w-72" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  )
}

export function ResearchReport() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const wanted = params.get('run') || ''

  const [runs, setRuns] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  // One clock for the whole render, so two findings a millisecond apart cannot
  // disagree about what "today" means.
  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let cancelled = false
    // No setLoaded(false) here: `loaded` starts false, this effect runs once
    // per workspace, and switching workspaces remounts the whole subtree
    // (AppProvider is keyed on it). Re-arming it in the effect body would
    // cascade a render for no gain — see React's set-state-in-effect rule.
    fetchRuns(activeWorkspaceId, accessToken, 12)
      .then(rows => {
        if (cancelled) return
        setRuns(rows || [])
        setLoaded(true)
      })
      .catch(err => {
        if (cancelled) return
        setError(String(err?.message || err))
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  /**
   * Which brief to print.
   *
   * Defaults to the newest run that actually produced one, NOT simply the
   * newest run. Three of the last five runs on this workspace failed before
   * writing a report, and defaulting to runs[0] would open the report page on
   * an empty sheet whose only content is an error — for a person who pressed
   * "Download PDF" expecting last week's findings.
   */
  const run = useMemo(() => {
    if (wanted) return runs.find(r => r.id === wanted) || null
    return runs.find(r => r.status === 'complete' && r.report?.headline) || runs[0] || null
  }, [runs, wanted])

  const report = useMemo(() => run?.report || {}, [run])
  const { marketing, technical } = useMemo(
    () => splitByAudience(report.findings || [], now), [report, now],
  )
  const { act, standing } = useMemo(() => partitionByClock(marketing, now), [marketing, now])
  const states = useMemo(() => lensStates(report), [report])
  const channels = useMemo(() => ownChannelRows(report), [report])
  const direction = useMemo(() => marketDirection(report), [report])
  const plan = useMemo(() => actionPlan(report), [report])
  const board = report.competitor_board || []

  const brand = activeWorkspace?.name || 'This brand'
  const runDate = run ? fmtDate(run.started_at) : ''

  useReportFilename(
    run ? `${brand} — research brief — ${String(run.started_at || '').slice(0, 10)}` : '',
  )

  if (!activeWorkspaceId) {
    return <Empty title="No workspace selected" description="Pick a workspace to read its research." />
  }

  return (
    <div className="max-w-[900px]">
      <ReportToolbar backTo="/insights" backLabel="Back to research">
        {runs.length > 1 && (
          <PillSelect
            value={run?.id || ''}
            onChange={e => setParams({ run: e.target.value }, { replace: true })}
            className="w-52"
          >
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {new Date(r.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                {' — '}
                {(r.error ? 'failed' : r.report?.headline || r.status).slice(0, 44)}
              </option>
            ))}
          </PillSelect>
        )}
      </ReportToolbar>

      {!loaded ? (
        <Card className="p-6"><ReportSkeleton /></Card>
      ) : error ? (
        <Card className="p-6">
          <Empty
            title="Could not load the research"
            description={`${error}. This is a connection problem rather than missing data — nothing has been lost.`}
          />
        </Card>
      ) : !run ? (
        <Card className="p-6">
          <Empty
            title="No research has been run for this brand yet"
            description="A run measures every competitor with a verified Instagram handle, then investigates what changed. Start one from the Research page and this report will have something to print."
            action={<Button onClick={() => { window.location.href = '/insights' }}>Go to Research</Button>}
          />
        </Card>
      ) : (
        <Card className="p-7 print:border-0 print:shadow-none print:p-0">
          <ReportDoc>
            <ReportMasthead
              kind="Research brief"
              brand={brand}
              line={run.error
                ? `This run did not finish: ${run.error}`
                : report.headline || 'This run produced no headline.'}
              meta={[runDate, report.period?.days ? `${report.period.days}-day window` : '']}
            />

            {/* ── Where the market is moving ── */}
            {direction.items.length > 0 && (
              <ReportSection
                title="Where the market is moving"
                note={direction.derived
                  ? 'Assembled from this run\'s per-rival reads — this brief predates the agent writing the section itself.'
                  : 'Read across the competitor board, the movements and the week\'s sources. Not a new finding.'}
              >
                <ul className="space-y-2.5">
                  {direction.items.map((m, i) => (
                    <li key={i} data-print-keep className="border-l-2 border-text pl-3">
                      <p className="text-[13px] text-text leading-snug">{m.movement}</p>
                      {m.so_what && (
                        <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                          <span className="font-semibold">For us: </span>{m.so_what}
                        </p>
                      )}
                      {basisLabel(m.basis) && (
                        <p className="text-[10px] text-text-tertiary mt-1 uppercase tracking-wide">
                          {basisLabel(m.basis)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── Do this ──
                Dated findings first and in clock order: the entire ordering
                rule of the brief is how long you have. */}
            {act.length > 0 && (
              <ReportSection
                title="Dated — act on these first"
                note="Findings with a real deadline attached, soonest first. The date is the reason each one is above the rest, not its importance."
              >
                <ul className="space-y-3">
                  {act.map((f, i) => (
                    <li key={i} data-print-keep>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[13px] font-semibold text-text leading-snug">{f.headline}</p>
                        {deadlineLabel(f, now) && (
                          <span className="text-[11px] font-semibold shrink-0 tabular-nums whitespace-nowrap">
                            {deadlineLabel(f, now)}
                          </span>
                        )}
                      </div>
                      {f.suggested_action && (
                        <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                          <span className="font-semibold">Do: </span>{f.suggested_action}
                        </p>
                      )}
                      {f.detail && (
                        <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">{f.detail}</p>
                      )}
                      <p className="text-[10px] text-text-tertiary mt-1 uppercase tracking-wide">
                        {f.lens}
                        {f.confidence != null && ` · confidence ${pct(f.confidence)}`}
                        {sourceLine(f.sources) && ` · ${sourceLine(f.sources)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── Gaps and the content that closes them ── */}
            {(plan.blocks.length > 0 || plan.loose.length > 0) && (
              <ReportSection
                title="Gaps, and the content that closes them"
                note="A gap is something the market is saying that we are not. The ideas under each one are this run's proposal for closing it — proposals only; nothing here has been scheduled or published."
              >
                <div className="space-y-3.5">
                  {plan.blocks.map((block, i) => (
                    <div key={block.gap.id || i} data-print-keep>
                      <p className="text-[13px] text-text leading-snug">{block.gap.gap}</p>
                      {block.gap.our_position && (
                        <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
                          <span className="font-semibold">Us: </span>{block.gap.our_position}
                        </p>
                      )}
                      {block.gap.suggested_response && (
                        <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                          <span className="font-semibold">Response: </span>{block.gap.suggested_response}
                        </p>
                      )}
                      {block.ideas.length > 0 && (
                        <ul className="mt-1.5 ml-3 border-l border-border pl-3 space-y-1.5">
                          {block.ideas.map((idea, j) => (
                            <li key={j}>
                              <p className="text-[11px] font-semibold text-text">{idea.title || idea.angle}</p>
                              {idea.title && idea.angle && (
                                <p className="text-[11px] text-text-secondary leading-relaxed">{idea.angle}</p>
                              )}
                              {idea.suggested_format && (
                                <p className="text-[10px] text-text-tertiary">{idea.suggested_format}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}

                  {plan.loose.map((idea, i) => (
                    <div key={`loose-${i}`} data-print-keep>
                      <p className="text-[12px] font-semibold text-text">{idea.title || idea.angle}</p>
                      {idea.title && idea.angle && (
                        <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{idea.angle}</p>
                      )}
                      {idea.rationale && (
                        <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{idea.rationale}</p>
                      )}
                    </div>
                  ))}
                </div>
              </ReportSection>
            )}

            {/* ── Evidence: our channels ── */}
            {channels.length > 0 && (
              <ReportSection
                title="Our own channels"
                note="Per-post engagement from our own analytics, on every platform we publish to. Not comparable to the competitor figures below, which are per-profile and Instagram-only."
                breakBefore={act.length + plan.blocks.length > 5}
              >
                <ReportTable
                  head={[
                    { label: 'Channel' },
                    { label: 'Posts', align: 'right' },
                    { label: 'Measured', align: 'right' },
                    { label: 'Eng / post', align: 'right' },
                    { label: 'Change', align: 'right' },
                    { label: 'Status' },
                  ]}
                >
                  {channels.map(p => (
                    <ReportRow key={p.platform}>
                      <Cell first><span className="font-semibold">{p.label}</span></Cell>
                      <Cell align="right">{p.state === 'not_connected' ? '—' : p.posts}</Cell>
                      <Cell align="right">{p.state === 'not_connected' ? '—' : p.measured}</Cell>
                      <Cell align="right">{p.avg_engagement ?? '—'}</Cell>
                      <Cell align="right">
                        {p.change ? `${p.change.direction === 'up' ? '+' : '−'}${p.change.change_pct}%` : '—'}
                      </Cell>
                      <Cell muted={p.state !== 'measured'}>
                        {p.state === 'measured' ? (p.weak ? 'Thin sample' : 'Measured') : p.note}
                      </Cell>
                    </ReportRow>
                  ))}
                </ReportTable>
              </ReportSection>
            )}

            {/* ── Evidence: the competitor board ── */}
            {board.length > 0 && (
              <ReportSection
                title="Competitor board"
                note="Per-profile figures from Instagram's business_discovery. A rival with no Instagram account we can measure is listed on web evidence only — TikTok and LinkedIn have no public equivalent at any price."
              >
                <ReportTable
                  head={[
                    { label: 'Competitor' },
                    { label: 'Followers', align: 'right' },
                    { label: 'Change', align: 'right' },
                    { label: 'Posts/wk', align: 'right' },
                    { label: 'Eng/1k', align: 'right' },
                    { label: 'Read' },
                  ]}
                >
                  {board.map((c, i) => (
                    <ReportRow key={c.handle || c.name || i}>
                      <Cell first>
                        <span className="font-semibold">{c.name}</span>
                        {c.handle && <span className="text-text-tertiary"> @{c.handle}</span>}
                      </Cell>
                      <Cell align="right">{c.data === 'instagram' ? compact(c.followers) : '—'}</Cell>
                      <Cell align="right">{c.followers_delta != null ? signed(c.followers_delta) : '—'}</Cell>
                      <Cell align="right">{c.posts_per_week ?? '—'}</Cell>
                      <Cell align="right">{c.engagement_per_1k ?? '—'}</Cell>
                      <Cell muted className="max-w-[240px]">
                        {c.read || (c.data === 'instagram' ? '' : 'Web evidence only.')}
                      </Cell>
                    </ReportRow>
                  ))}
                </ReportTable>
              </ReportSection>
            )}

            {/* ── Standing findings, compressed to one line each ── */}
            {standing.length > 0 && (
              <ReportSection
                title="Standing findings"
                note="True and useful, but with no clock on them. They keep until the dated work above is done."
              >
                <ul className="space-y-1.5">
                  {standing.slice(0, 8).map((f, i) => (
                    <li key={i} className="text-[11px] text-text-secondary leading-relaxed flex gap-2">
                      <span className="text-text-tertiary shrink-0">—</span>
                      <span>
                        <span className="text-text font-medium">{f.headline}</span>
                        {f.suggested_action && ` ${f.suggested_action}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── For the technical team ── */}
            {technical.length > 0 && (
              <ReportSection
                title="For the technical team"
                note="Findings with no publishable angle — certifications, standards, specification changes. Separated out so they cannot crowd the marketing queue above."
              >
                <ul className="space-y-1.5">
                  {technical.slice(0, 6).map((f, i) => (
                    <li key={i} className="text-[11px] text-text-secondary leading-relaxed flex gap-2">
                      <span className="text-text-tertiary shrink-0">—</span>
                      <span>
                        <span className="text-text font-medium">{f.headline}</span>
                        {deadlineLabel(f, now) && ` (${deadlineLabel(f, now)})`}
                        {f.technical_note && ` ${f.technical_note}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── How much of the run worked ── */}
            <ReportSection title="How this run went" keep>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {states.length
                  ? `${states.length} question${states.length === 1 ? '' : 's'} checked · ${lensHeadline(states)}.`
                  : 'This run recorded no per-question results.'}
              </p>
              {states.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {states.map(s => (
                    <li key={s.key} className="text-[11px] leading-relaxed flex gap-2">
                      <span className="w-[120px] shrink-0 font-medium text-text">{s.label}</span>
                      <span className={s.state === 'failed' ? 'text-red-600' : 'text-text-tertiary'}>
                        {s.state === 'failed'
                          ? `could not answer${s.error ? ` — ${s.error}` : ''}`
                          : s.state === 'found'
                            ? `${s.count} finding${s.count === 1 ? '' : 's'}`
                            : 'looked, found nothing'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ReportSection>

            <Caveats items={report.unanswered || []} />

            <ReportFooter>
              {brand} · research brief from the run of {runDate}
              {report.period?.days ? `, covering the ${report.period.days} days before it` : ''}. Competitor
              and own-channel numbers are computed in code from platform analytics; the readings, gaps and
              ideas are written by the research agent from those numbers and the sources it cites. Nothing
              in this brief has been published or scheduled.
            </ReportFooter>
          </ReportDoc>
        </Card>
      )}
    </div>
  )
}
