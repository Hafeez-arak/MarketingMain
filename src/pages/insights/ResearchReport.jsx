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
import { lensStates, pct, readableReport } from '../../lib/researchBrief'
import {
  TEAMS, sectionVisible, forTeam, topThree, salesRows, competitorMoves, movesByLine,
  globalView, lineView, linesIn, socialActivity, eventsView,
  marketNotes, marketingRecommendations, newCompetitors, sourceList, openItems, freshnessLabel,
  searchDemand, isRunFault,
} from '../../lib/marketReport'
import { fetchIntel } from '../../lib/marketIntel'
import { fetchAgenda } from '../../lib/agentAgenda'
import { plainRunProblem, partRun, readingLine } from './plainWords'

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

const shortDate = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')

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

/** "Best: a carousel post" — never "Best: untitled", which is a null in print. */
function bestLine(p) {
  if (!p.best_post) return p.weak ? 'Thin sample' : 'Measured'
  const named = String(p.best_post.topic || '').trim() ||
    (p.best_post.format ? `a ${p.best_post.format} post` : '')
  return named ? `Best: ${named}` : `Best post: ${p.best_post.engagement} interactions`
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
  const team = TEAMS.some(t => t.key === params.get('team')) ? params.get('team') : 'all'

  const [runs, setRuns] = useState([])
  const [intel, setIntel] = useState({ signals: [], opportunities: [], events: [] })
  const [agendaCompetitors, setAgendaCompetitors] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  // One clock for the whole render, so two findings a millisecond apart cannot
  // disagree about what "today" means.
  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let cancelled = false
    // No setLoaded(false) here: `loaded` starts false, this effect runs once
    // per workspace, and switching workspaces remounts the whole subtree.
    Promise.all([
      fetchRuns(activeWorkspaceId, accessToken, 12, { throwOnError: true }),
      fetchIntel(activeWorkspaceId, accessToken),
      fetchAgenda(activeWorkspaceId, accessToken),
    ])
      .then(([rows, i, a]) => {
        if (cancelled) return
        setRuns(rows || [])
        setIntel(i)
        setAgendaCompetitors(a?.competitors || [])
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
   * Which report to print. Defaults to the newest run that actually produced
   * one, NOT simply the newest run — a failed run would open an empty sheet
   * for a person who pressed "Download PDF" expecting last week's findings.
   */
  const run = useMemo(() => {
    if (wanted) return runs.find(r => r.id === wanted) || null
    return runs.find(r => r.status === 'complete' && r.report?.headline) || runs[0] || null
  }, [runs, wanted])

  const report = useMemo(() => readableReport(run?.report), [run])
  const top = useMemo(() => topThree(report, now), [report, now])
  const sales = useMemo(() => salesRows({ report, opportunities: intel.opportunities, runId: run?.id, now }), [report, intel, run, now])
  // The watchlist lines a rival known only from an Instagram board read, the
  // same way the on-screen tab does — see competitorMoves.
  const moves = useMemo(
    () => competitorMoves(report, { watchlist: agendaCompetitors }),
    [report, agendaCompetitors])
  const lines = useMemo(() => linesIn(report), [report])
  const world = useMemo(() => globalView(report), [report])
  const poles = useMemo(() => lineView(report, 'poles'), [report])
  const social = useMemo(() => socialActivity({ report, signals: intel.signals, now }), [report, intel, now])
  const events = useMemo(() => eventsView({ report, events: intel.events, runId: run?.id, now }), [report, intel, run, now])
  const notes = useMemo(() => marketNotes(report, now), [report, now])
  const search = useMemo(() => searchDemand(report), [report])
  const plan = useMemo(() => marketingRecommendations(report), [report])
  const candidates = useMemo(() => newCompetitors({ report, agendaCompetitors }), [report, agendaCompetitors])
  const sources = useMemo(() => sourceList(report), [report])
  const states = useMemo(() => lensStates(report), [report])
  // Read across runs, not out of this one: an item raised three weeks running
  // and never closed is the thing this report kept losing.
  const open = useMemo(() => openItems({ runs }), [runs])

  const brand = activeWorkspace?.name || 'This brand'
  const runDate = run ? fmtDate(run.started_at) : ''
  const teamLabel = TEAMS.find(t => t.key === team)?.label || ''
  const show = key => sectionVisible(key, team)

  useReportFilename(
    run ? `${brand} — market report${team !== 'all' ? ` (${teamLabel})` : ''} — ${String(run.started_at || '').slice(0, 10)}` : '',
  )

  if (!activeWorkspaceId) {
    return <Empty title="No brand selected" description="Pick a brand to read its research." />
  }

  const setParam = (key, value) => setParams(prev => {
    const n = new URLSearchParams(prev)
    if (value && value !== 'all') n.set(key, value); else n.delete(key)
    return n
  }, { replace: true })

  const topItems = top.items.filter(t => team === 'all' || t.team === team)
  const moveItems = moves.items.filter(m => forTeam(team, m.teams))
  // Printed grouped, for the same reason the screen groups: a controls
  // integrator and a lighting supplier are never in the same room, and on
  // paper there is no filter to fall back on.
  const moveGroups = movesByLine(moveItems, lines)
  const noteItems = notes.filter(x => forTeam(team, x.teams))

  return (
    <div className="max-w-[900px]">
      <ReportToolbar backTo="/insights" backLabel="Back to research">
        <PillSelect value={team} onChange={e => setParam('team', e.target.value)} className="w-32">
          {TEAMS.map(t => <option key={t.key} value={t.key}>{t.key === 'all' ? 'All teams' : t.label}</option>)}
        </PillSelect>
        {runs.length > 1 && (
          <PillSelect value={run?.id || ''} onChange={e => setParam('run', e.target.value)} className="w-52">
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {new Date(r.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                {' — '}
                {r.status === 'failed' ? 'did not finish' : partRun(r) ? 'partly finished' : (readableReport(r.report).headline || 'complete').slice(0, 44)}
              </option>
            ))}
          </PillSelect>
        )}
      </ReportToolbar>

      {!loaded ? (
        <Card className="p-6"><ReportSkeleton /></Card>
      ) : error ? (
        <Card className="p-6">
          <Empty title="The research could not be loaded" description="This is a connection problem, not missing research — nothing has been lost. Please try again." />
        </Card>
      ) : !run ? (
        <Card className="p-6">
          <Empty
            title="No research yet"
            description="Run research from the Research page and this report will have something to print."
            action={<Button onClick={() => { window.location.href = '/insights' }}>Go to Research</Button>}
          />
        </Card>
      ) : (
        <Card className="p-7 print:border-0 print:shadow-none print:p-0">
          <ReportDoc>
            <ReportMasthead
              kind={`Weekly market report${team !== 'all' ? ` · for ${teamLabel}` : ''}`}
              brand={brand}
              line={run.status === 'failed' ? `This research did not finish. ${plainRunProblem(run.error)}` : report.headline || 'This research has no summary.'}
              meta={[runDate, report.period?.days ? `${report.period.days}-day window` : '']}
            />

            {/* ── Top 3 ── */}
            <ReportSection title="Top priorities this week" keep>
              {topItems.length ? (
                <ol className="space-y-2">
                  {topItems.map((t, i) => (
                    <li key={i} data-print-keep className="flex gap-2.5">
                      <span className="text-[13px] font-semibold tabular-nums shrink-0">{i + 1}.</span>
                      <div>
                        <p className="text-[13px] font-semibold text-text leading-snug">{t.finding}
                          <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-text-tertiary">{t.team}</span></p>
                        {t.action && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed"><span className="font-semibold">What to do: </span>{t.action}</p>}
                        {sourceLine(t.pieces.map(p => p.url).filter(Boolean)) && (
                          <p className="text-[10px] text-text-tertiary mt-0.5">{sourceLine(t.pieces.map(p => p.url).filter(Boolean))}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-[11px] text-text-tertiary">Nothing new rose above the rest this week.</p>}
            </ReportSection>

            {/* ── Sales ── */}
            {show('sales') && (
              <ReportSection title="Leads, tenders and projects"
                note={sales.trackerAvailable ? 'Every open opening we are tracking, with its current status.' : 'Openings found in this research.'}>
                {sales.open.length ? (
                  <ReportTable head={[{ label: 'Opening' }, { label: 'Details' }, { label: 'Deadline' }, { label: 'What to do' }]}>
                    {sales.open.map((r, i) => (
                      <ReportRow key={r.id || i}>
                        <Cell first className="w-[30%]">
                          <span className="font-semibold">{r.name}</span>
                          <span className="block text-[10px] text-text-tertiary uppercase tracking-wide">
                            {[r.type, r.relevance, r.status, r.isNew ? 'new' : '', r.changed ? 'changed' : ''].filter(Boolean).join(' · ')}
                          </span>
                          {r.changed && <span className="block text-[10px] text-text-secondary">{r.changed}</span>}
                        </Cell>
                        <Cell className="w-[26%]" muted>
                          {r.details.join(' · ') || '—'}
                          {sourceLine([r.url]) && <span className="block text-[10px]">{sourceLine([r.url])}</span>}
                        </Cell>
                        {/* A published date when there is one; otherwise the
                            stage's own window, labelled as the estimate it is.
                            Six blank deadlines made this table unsortable. */}
                        <Cell className="w-[16%]">
                          {r.deadline ? shortDate(r.deadline) : ''}
                          <span className="block text-[10px] text-text-secondary">{r.window.label}</span>
                          {r.window.basis === 'stage' && (
                            <span className="block text-[10px] text-text-tertiary">estimated from stage, not published</span>
                          )}
                        </Cell>
                        <Cell className="w-[32%]">{r.action || '—'}</Cell>
                      </ReportRow>
                    ))}
                  </ReportTable>
                ) : <p className="text-[11px] text-text-tertiary">No open leads, tenders or projects.</p>}
              </ReportSection>
            )}

            {/* ── Competitor moves ── */}
            <ReportSection title="Competitor moves"
              note="Pieced together from competitors' websites, LinkedIn, job ads, social posts and the press.">
              {moveItems.length ? (
                <div className="space-y-3">
                  {moveGroups.map(g => (
                    <div key={g.key || 'unlined'} className="space-y-3">
                      {moveGroups.length > 1 && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                          {g.label} · {g.items.length} rival{g.items.length === 1 ? '' : 's'}
                        </p>
                      )}
                      {g.items.map((m, i) => (
                    <div key={i} data-print-keep className="border-l-2 border-text pl-3">
                      <p className="text-[13px] font-semibold text-text">{m.competitor}
                        <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-text-tertiary">
                          {[m.relevance && `${m.relevance} priority`, freshnessLabel(m.freshness), ...m.channels]
                            .filter(Boolean).join(' · ')}
                        </span>
                      </p>
                      {m.whatChanged && <p className="text-[12px] text-text mt-0.5 leading-snug">{m.whatChanged}</p>}
                      {m.picture && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed"><span className="font-semibold">Why we think so: </span>{m.picture}</p>}
                      {m.effect && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed"><span className="font-semibold">What it means for us: </span>{m.effect}</p>}
                      {sourceLine(m.pieces.map(p => p.url).filter(Boolean)) && (
                        <p className="text-[10px] text-text-tertiary mt-0.5">{sourceLine(m.pieces.map(p => p.url).filter(Boolean))}</p>
                      )}
                    </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-text-tertiary">No competitor did anything new that was found this week.</p>}
            </ReportSection>

            {/* ── Social activity ── */}
            {show('social') && (social.ours.length > 0 || social.theirs.length > 0) && (
              <ReportSection title="Social activity" note="Our channels from our own analytics; competitors by what they posted about.">
                {social.ours.length > 0 && (
                  <ReportTable head={[{ label: 'Our channel' }, { label: 'Posts', align: 'right' }, { label: 'Eng / post', align: 'right' }, { label: 'Change', align: 'right' }, { label: 'Note' }]}>
                    {social.ours.map(p => (
                      <ReportRow key={p.platform}>
                        <Cell first><span className="font-semibold">{p.label}</span></Cell>
                        <Cell align="right">{p.state === 'not_connected' ? '—' : p.posts}</Cell>
                        <Cell align="right">{p.avg_engagement ?? '—'}</Cell>
                        <Cell align="right">{p.change ? `${p.change.direction === 'up' ? '+' : '−'}${p.change.change_pct}%` : '—'}</Cell>
                        <Cell muted>{p.state === 'measured' ? bestLine(p) : p.note}</Cell>
                      </ReportRow>
                    ))}
                  </ReportTable>
                )}
                {social.theirs.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {social.theirs.map(g => (
                      <li key={g.competitor} data-print-keep className="text-[11px] text-text-secondary leading-relaxed">
                        <span className="font-semibold text-text">{g.competitor}</span> ({g.platforms.join(', ')}): {g.items.slice(0, 3).map(i => `“${i.text}”`).join(' · ')}
                      </li>
                    ))}
                  </ul>
                )}
              </ReportSection>
            )}

            {/* ── Events ── */}
            {show('events') && (
              <ReportSection title="Events and expos"
                note="Our industry's shows, the expos where our buyers gather, and the conferences that shape demand.">
                {events.count ? (
                  <div className="space-y-3">
                    {[['Next 90 days', events.soon, false], ['Later this year', events.later, false], ['Recently — what happened', events.recent, true]]
                      .filter(([, rows]) => rows.length)
                      .map(([label, rows, recent]) => (
                        <div key={label}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">{label}</p>
                          <ReportTable head={recent
                            ? [{ label: 'Event' }, { label: 'Dates' }, { label: 'Competitors' }, { label: 'What came of it' }]
                            : [{ label: 'Event' }, { label: 'Dates' }, { label: 'Exhibitor deadline' }, { label: 'Competitors' }, { label: 'Recommendation' }]}>
                            {rows.map((e, i) => (
                              <ReportRow key={e.id || i}>
                                <Cell first className="w-[28%]">
                                  <span className="font-semibold">{e.name}</span>
                                  {e.venue && <span className="block text-[10px] text-text-tertiary">{e.venue}</span>}
                                  {e.decision && e.decision !== 'undecided' && <span className="block text-[10px] text-text-tertiary">We are: {e.decision}</span>}
                                </Cell>
                                <Cell className="w-[13%] whitespace-nowrap">{e.start ? `${shortDate(e.start)}${e.end && e.end !== e.start ? ` – ${shortDate(e.end)}` : ''}` : 'TBC'}</Cell>
                                {!recent && (
                                  <Cell className="w-[15%]">
                                    {e.exhibitorDeadline ? shortDate(e.exhibitorDeadline) : ''}
                                    <span className="block text-[10px] text-text-tertiary">{e.deadlineStatus}</span>
                                  </Cell>
                                )}
                                <Cell className="w-[14%]" muted>{e.competitors.join(', ') || '—'}</Cell>
                                <Cell className={recent ? 'w-[45%]' : 'w-[32%]'}>{(recent ? e.takeaway || e.recommendation : e.recommendation) || '—'}</Cell>
                              </ReportRow>
                            ))}
                          </ReportTable>
                        </div>
                      ))}
                  </div>
                ) : <p className="text-[11px] text-text-tertiary">No expo, conference or awards opening is on the books.</p>}
                {/* Public holidays and seasonal dates are computed, not found,
                    and they are not something anyone exhibits at. Listing them
                    among the expos made an empty table look full. */}
                {events.dates.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">
                      Dates to plan content around
                    </p>
                    <ul className="space-y-1">
                      {events.dates.map((d, i) => (
                        <li key={i} className="text-[11px] text-text-secondary leading-relaxed">
                          <span className="font-semibold text-text">{shortDate(d.start)}</span> · {d.name}
                          {d.recommendation && ` — ${d.recommendation}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </ReportSection>
            )}

            {/* ── Search demand ── */}
            {/* Printed even when the lens found nothing, unlike most sections:
                an absent section reads as "we did not look", and the whole
                point of this one is to say what people are searching for AND
                to be honest when the answer is "almost nothing". */}
            {show('search') && (search.present || report.website?.summary) && (
              <ReportSection title="Website"
                note="How our website did over the last 28 days on Google.">
                {report.website?.summary && (
                  <div className="mb-3" data-print-keep>
                    <p className="text-[12px] text-text leading-snug" dir="auto">{report.website.summary}</p>
                    {(report.website.numbers || []).length > 0 && (
                      <p className="text-[11px] text-text-secondary mt-1.5">
                        {report.website.numbers.map(x => `${x.label}: ${x.value}`).join(' · ')}
                      </p>
                    )}
                    {(report.website.suggestions || []).map((t, i) => (
                      <p key={i} className="text-[11px] text-text-secondary mt-1"><span className="font-semibold">Do: </span>{t}</p>
                    ))}
                  </div>
                )}
                {search.note && <p className="text-[12px] text-text leading-snug mb-2" dir="auto">{search.note}</p>}
                {search.byLine.length > 0 && (
                  <p className="text-[10px] text-text-tertiary mb-2">
                    {search.byLine.map(l => `${l.label}: ${l.impressions} impressions`).join(' · ')}
                  </p>
                )}
                {search.opportunities.length + search.movers.length === 0 ? (
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Nothing in the search numbers changed enough to report this time.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {[...search.opportunities, ...search.movers].slice(0, 10).map((x, i) => (
                      <li key={i} data-print-keep className="text-[11px] text-text-secondary leading-relaxed">
                        <p className="text-[12px] text-text font-medium leading-snug" dir="auto">{x.headline}</p>
                        {x.action && <p><span className="font-semibold">Do: </span>{x.action}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </ReportSection>
            )}

            {/* ── Market & technical ── */}
            {show('market') && noteItems.length > 0 && (
              <ReportSection title="Market and technical news">
                <ul className="space-y-2">
                  {noteItems.slice(0, 10).map((x, i) => (
                    <li key={i} data-print-keep className="text-[11px] text-text-secondary leading-relaxed">
                      <p className="text-[12px] text-text font-medium leading-snug">{x.headline}
                        {x.confidence != null && <span className="ml-1.5 text-[10px] font-normal text-text-tertiary">confidence {pct(x.confidence)}</span>}
                      </p>
                      {x.action && <p><span className="font-semibold">Marketing: </span>{x.action}</p>}
                      {x.technicalNote && <p><span className="font-semibold">Technical: </span>{x.technicalNote}</p>}
                      {sourceLine(x.sources) && <p className="text-[10px] text-text-tertiary">{sourceLine(x.sources)}</p>}
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── Global industry ── */}
            {/* Printed only when it has something. A paper report carries no
                filters and no way to skip a heading, so an empty section is
                pure cost — unlike on screen, where the empty state explains
                why a reader clicked into nothing. */}
            {show('global') && world.items.length > 0 && (
              <ReportSection title="Global industry"
                note="The world upstream of this market — manufacturers, component prices and standards arriving elsewhere first.">
                <ul className="space-y-2">
                  {world.items.slice(0, 8).map((x, i) => (
                    <li key={i} data-print-keep className="text-[11px] text-text-secondary leading-relaxed">
                      <p className="text-[12px] text-text font-medium leading-snug">{x.headline}</p>
                      {x.suggested_action && <p><span className="font-semibold">For us: </span>{x.suggested_action}</p>}
                      {sourceLine(x.sources) && <p className="text-[10px] text-text-tertiary">{sourceLine(x.sources)}</p>}
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── Smart poles ── */}
            {show('poles') && poles.items.length > 0 && (
              <ReportSection title="Smart poles"
                note="The municipal line, kept out of the two specification businesses because its buyer is a city.">
                <ul className="space-y-2">
                  {poles.items.slice(0, 8).map((x, i) => (
                    <li key={i} data-print-keep className="text-[11px] text-text-secondary leading-relaxed">
                      <p className="text-[12px] text-text font-medium leading-snug">{x.headline}</p>
                      {x.suggested_action && <p><span className="font-semibold">Do: </span>{x.suggested_action}</p>}
                      {sourceLine(x.sources) && <p className="text-[10px] text-text-tertiary">{sourceLine(x.sources)}</p>}
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── Marketing recommendations ── */}
            {show('recs') && (plan.blocks.length > 0 || plan.loose.length > 0) && (
              <ReportSection title="Content ideas"
                note="Where what the market wants and what we say do not line up, with content to close the gap. Suggestions only — nothing here has been scheduled or published.">
                <div className="space-y-3">
                  {plan.blocks.map((block, i) => (
                    <div key={block.gap.id || i} data-print-keep>
                      <p className="text-[12px] text-text leading-snug">{block.n}. {block.gap.gap}</p>
                      {block.gap.suggested_response && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed"><span className="font-semibold">Response: </span>{block.gap.suggested_response}</p>}
                      {block.ideas.length > 0 && (
                        <ul className="mt-1 ml-3 border-l border-border pl-3 space-y-1">
                          {block.ideas.map((idea, j) => (
                            <li key={j} className="text-[11px]"><span className="font-semibold text-text">{idea.title || idea.angle}</span>
                              {idea.suggested_format && <span className="text-text-tertiary"> · {idea.suggested_format}</span>}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {/* Numbered on from the gap-backed ones. Unnumbered, these
                      read as an appendix — and the most time-critical item in
                      the 15 Sep report was one of them. */}
                  {plan.loose.map((idea, i) => (
                    <div key={`l${i}`} data-print-keep>
                      <p className="text-[12px] font-semibold text-text">{idea.n}. {idea.title || idea.angle}</p>
                      {idea.rationale && <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{idea.rationale}</p>}
                    </div>
                  ))}
                </div>
              </ReportSection>
            )}

            {/* ── New competitors ── */}
            {show('newcomp') && candidates.length > 0 && (
              <ReportSection title="New competitors to review" note="Found by the research; not watched until someone accepts them.">
                <ul className="space-y-1">
                  {candidates.map(c => (
                    <li key={c.name} className="text-[11px] text-text-secondary leading-relaxed">
                      <span className="font-semibold text-text">{c.name}</span>{c.why && ` — ${c.why}`}
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            {/* ── Sources ── */}
            {sources.length > 0 && (
              <ReportSection title="Sources" note={`Checked during the research of ${runDate}.`}>
                <ol className="space-y-0.5 list-decimal ml-4">
                  {sources.map(s => (
                    <li key={s.url} className="text-[10px] text-text-secondary leading-relaxed break-all">
                      {s.title ? `${s.title} — ` : ''}{s.url}
                    </li>
                  ))}
                </ol>
              </ReportSection>
            )}

            {/* ── Open items ── */}
            <ReportSection title="Still unanswered" keep
              note="Raised by earlier research and not yet resolved.">
              {open.length ? (
                <ul className="space-y-1.5">
                  {open.map((item, i) => (
                    <li key={i} className="text-[11px] text-text-secondary leading-relaxed flex gap-2">
                      <span className="text-text-tertiary shrink-0 tabular-nums">{item.firstRaised}</span>
                      <span>
                        {item.text}
                        <span className="text-text-tertiary">
                          {item.runs > 1 ? ` · raised ${item.runs} times` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[11px] text-text-tertiary">Nothing is left open from earlier research.</p>}
            </ReportSection>

            <ReportSection title="How this research went" keep>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {states.length
                  ? `${states.length} topic${states.length === 1 ? '' : 's'} checked: ${states.filter(s => s.state === 'found').length} found something` +
                    `${states.some(s => s.state === 'failed') ? `, ${states.filter(s => s.state === 'failed').length} could not be checked` : ''}. ${readingLine(states)}`
                  : 'This research did not record which topics it checked.'}
              </p>
            </ReportSection>

            {/* The run's own faults are not caveats about the market. */}
            <Caveats items={(report.unanswered || []).filter(u => !isRunFault(u))} />

            <ReportFooter>
              {brand} · weekly market report from the research of {runDate}. Every finding names the source it came from; our own
              channel numbers come from our analytics. Leads and events show their status at the time of printing.
              Nothing in this report has been published or scheduled.
            </ReportFooter>
          </ReportDoc>
        </Card>
      )}
    </div>
  )
}
