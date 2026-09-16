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
import { lensStates, lensHeadline, runEffort, pct } from '../../lib/researchBrief'
import {
  TEAMS, sectionVisible, forTeam, topThree, salesRows, competitorMoves, socialActivity, eventsView,
  marketNotes, marketingRecommendations, newCompetitors, sourceList, openItems, freshnessLabel,
} from '../../lib/marketReport'
import { fetchIntel } from '../../lib/marketIntel'
import { fetchAgenda } from '../../lib/agentAgenda'

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
      fetchRuns(activeWorkspaceId, accessToken, 12),
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

  const report = useMemo(() => run?.report || {}, [run])
  const top = useMemo(() => topThree(report, now), [report, now])
  const sales = useMemo(() => salesRows({ report, opportunities: intel.opportunities, runId: run?.id, now }), [report, intel, run, now])
  const moves = useMemo(() => competitorMoves(report), [report])
  const social = useMemo(() => socialActivity({ report, signals: intel.signals, now }), [report, intel, now])
  const events = useMemo(() => eventsView({ report, events: intel.events, runId: run?.id, now }), [report, intel, run, now])
  const notes = useMemo(() => marketNotes(report, now), [report, now])
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
    return <Empty title="No workspace selected" description="Pick a workspace to read its research." />
  }

  const setParam = (key, value) => setParams(prev => {
    const n = new URLSearchParams(prev)
    if (value && value !== 'all') n.set(key, value); else n.delete(key)
    return n
  }, { replace: true })

  const topItems = top.items.filter(t => team === 'all' || t.team === team)
  const moveItems = moves.items.filter(m => forTeam(team, m.teams))
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
          <Empty title="Could not load the research" description={`${error}. This is a connection problem rather than missing data — nothing has been lost.`} />
        </Card>
      ) : !run ? (
        <Card className="p-6">
          <Empty
            title="No research has been run for this brand yet"
            description="Start a run from the Research page and this report will have something to print."
            action={<Button onClick={() => { window.location.href = '/insights' }}>Go to Research</Button>}
          />
        </Card>
      ) : (
        <Card className="p-7 print:border-0 print:shadow-none print:p-0">
          <ReportDoc>
            <ReportMasthead
              kind={`Weekly market report${team !== 'all' ? ` · for ${teamLabel}` : ''}`}
              brand={brand}
              line={run.error ? `This run did not finish: ${run.error}` : report.headline || 'This run produced no headline.'}
              meta={[runDate, report.period?.days ? `${report.period.days}-day window` : '']}
            />

            {/* ── Top 3 ── */}
            <ReportSection title="Top 3 this week" keep
              note={top.derived ? 'Chosen in code from this run\'s findings; this report predates the agent writing its own.' : ''}>
              {topItems.length ? (
                <ol className="space-y-2">
                  {topItems.map((t, i) => (
                    <li key={i} data-print-keep className="flex gap-2.5">
                      <span className="text-[13px] font-semibold tabular-nums shrink-0">{i + 1}.</span>
                      <div>
                        <p className="text-[13px] font-semibold text-text leading-snug">{t.finding}
                          <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-text-tertiary">{t.team}</span></p>
                        {t.action && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed"><span className="font-semibold">Action: </span>{t.action}</p>}
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
              <ReportSection title="Sales: act now"
                note={sales.trackerAvailable ? 'Every open lead in the tracker, across all runs, with its current status.' : 'Leads from this report.'}>
                {sales.open.length ? (
                  <ReportTable head={[{ label: 'Lead / tender / project' }, { label: 'Details' }, { label: 'Window closes' }, { label: 'Suggested action' }]}>
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
              note={moves.derived ? 'Assembled from this report\'s competitor readings.' : 'Combined from small signals across websites, LinkedIn, job ads, social posts and the press, this week and earlier.'}>
              {moveItems.length ? (
                <div className="space-y-3">
                  {moveItems.map((m, i) => (
                    <div key={i} data-print-keep className="border-l-2 border-text pl-3">
                      <p className="text-[13px] font-semibold text-text">{m.competitor}
                        <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-text-tertiary">
                          {[m.relevance && `relevance ${m.relevance}`, freshnessLabel(m.freshness), ...m.channels]
                            .filter(Boolean).join(' · ')}
                        </span>
                      </p>
                      {m.whatChanged && <p className="text-[12px] text-text mt-0.5 leading-snug">{m.whatChanged}</p>}
                      {m.picture && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed"><span className="font-semibold">The picture: </span>{m.picture}</p>}
                      {m.effect && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed"><span className="font-semibold">For us: </span>{m.effect}</p>}
                      {sourceLine(m.pieces.map(p => p.url).filter(Boolean)) && (
                        <p className="text-[10px] text-text-tertiary mt-0.5">{m.pieces.length} piece{m.pieces.length === 1 ? '' : 's'} · {sourceLine(m.pieces.map(p => p.url).filter(Boolean))}</p>
                      )}
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
                      Dates in the calendar — not events to attend
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

            {/* ── Market & technical ── */}
            {show('market') && noteItems.length > 0 && (
              <ReportSection title="Market and technical notes">
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

            {/* ── Marketing recommendations ── */}
            {show('recs') && (plan.blocks.length > 0 || plan.loose.length > 0) && (
              <ReportSection title="Marketing recommendations"
                note={`Each is a gap between the market and our position, with the content proposed to close it. Proposals only — nothing here has been scheduled or published.${
                  plan.overCap ? ` This run proposed ${plan.total}; the brief asks for two to four.` : ''}`}>
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
              <ReportSection title="New competitors to review" note="Found by the agent; not on the watchlist until a person accepts them.">
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
              <ReportSection title="Sources" note={`Checked during the run of ${runDate}.`}>
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
            <ReportSection title="Open items" keep
              note="Raised by an earlier run and not closed. Nothing here is marked resolved automatically — only a person can say that.">
              {open.length ? (
                <ul className="space-y-1.5">
                  {open.map((item, i) => (
                    <li key={i} className="text-[11px] text-text-secondary leading-relaxed flex gap-2">
                      <span className="text-text-tertiary shrink-0 tabular-nums">{item.firstRaised}</span>
                      <span>
                        {item.text}
                        <span className="text-text-tertiary">
                          {' '}· raised in {item.runs} run{item.runs === 1 ? '' : 's'}
                          {item.thisRun ? '' : ' · not repeated this run'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[11px] text-text-tertiary">Nothing is carried over from earlier runs.</p>}
            </ReportSection>

            <ReportSection title="How this run went" keep>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {states.length ? `${states.length} question${states.length === 1 ? '' : 's'} checked · ${lensHeadline(states)}.` : 'This run recorded no per-question results.'}
              </p>
              {runEffort(states) && (
                <p className="text-[11px] text-text-tertiary leading-relaxed mt-1">{runEffort(states)}.</p>
              )}
            </ReportSection>

            <Caveats items={report.unanswered || []} />

            <ReportFooter>
              {brand} · weekly market report from the run of {runDate}. Every finding cites the source it was read from; own-channel
              numbers are computed in code from our analytics. The lead tracker and events reflect the store when this was printed.
              Nothing in this report has been published or scheduled.
            </ReportFooter>
          </ReportDoc>
        </Card>
      )}
    </div>
  )
}
