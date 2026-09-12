import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, Button, Empty, Spinner } from '../../components/ui/index'
import { fetchBrandMemory, updateBrandMemory, deleteBrandMemory } from '../../lib/brandContext'
import {
  fetchIdeaEvents, fetchIdeasForInsights, fetchPerformance, requestInsightsReview,
  summariseDecisions, summarisePerformance,
} from '../../lib/insights'
import { startResearchRun, fetchRuns, fetchLensResults } from '../../lib/agentRun'
import { isLive } from '../../lib/agent/progress'
import { summarise, learningLine, ageLabel } from '../../lib/learnedSummary'
import { ResearchTab } from './ResearchTab'
import { LearnedTab } from './LearnedTab'

// ─── Research — one page, two halves ───────────────────────────────────────
// This was two pages, and the split was the wrong one. "Research" and "What We
// Learned" each carried a copy of the competitor watchlist, the run history,
// the run button and the proposed rules — four things duplicated across two
// screens, so neither page could be read as the whole picture and every one of
// those four had two places it might be edited.
//
// It is one page now. The split that remains is the one that was always real:
//
//   RESEARCH        outward, PERISHABLE. The market. A brief expires — a date
//                   passes, a tender closes, a standard comes into force.
//   WHAT WE LEARNED inward, DURABLE. Our decisions, our numbers, and the rule
//                   book that steers every future generation. It accumulates.
//
// Above both sits the summary, because the one question a person actually
// arrives with — "what should I do now?" — is answered from both halves at
// once, and making them click a tab to find out would be the same mistake in
// a smaller form.
//
// The tab is in the URL (?tab=learned) so a link to the rule book is a link to
// the rule book, not to whichever half happened to be open.

// Like Stat, but for the summary grid: the hint is a sentence rather than a
// sample size, and it is never allowed to be absent — a number with nothing
// qualifying it is exactly the kind of confident, unreadable figure this app
// is organised against.
function SummaryStat({ label, value, hint }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-text mt-0.5 tabular-nums">{value}</p>
      <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{hint}</p>
    </div>
  )
}

const TABS = [
  { key: 'research', label: 'Research', note: 'What the market is doing, and what to do about it' },
  { key: 'learned', label: 'What We Learned', note: 'What we know about ourselves, and the rules it produced' },
]

export function Insights() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const { state } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'research'
  const setTab = key => setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', key); return n }, { replace: true })

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewNote, setReviewNote] = useState('')

  const [events, setEvents] = useState([])
  const [ideas, setIdeas] = useState([])
  const [perf, setPerf] = useState({ metrics: [], posts: [] })
  const [memory, setMemory] = useState([])
  const [runs, setRuns] = useState([])
  const [lensRows, setLensRows] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  // One clock for the whole render. Recomputing new Date() per card lets two
  // findings a millisecond apart disagree about what "today" means, which only
  // ever shows up at midnight.
  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let alive = true
    Promise.all([
      fetchIdeaEvents(activeWorkspaceId, accessToken),
      fetchIdeasForInsights(activeWorkspaceId, accessToken),
      fetchPerformance(activeWorkspaceId, accessToken),
      fetchBrandMemory(activeWorkspaceId, accessToken, { status: 'all' }),
      fetchRuns(activeWorkspaceId, accessToken, 12),
    ]).then(async ([e, i, p, m, r]) => {
      if (!alive) return
      setEvents(e); setIdeas(i); setPerf(p); setMemory(m); setRuns(r || [])
      const target = (r || []).find(x => x.id === selectedId) || (r || [])[0]
      setLensRows(target ? await fetchLensResults(activeWorkspaceId, target.id, accessToken) : [])
      if (alive) setLoading(false)
    }).catch(err => {
      // Without this the page is blank forever on any network failure: the
      // spinner clears only inside .then, and a rejected Promise.all never
      // reaches it. Seen for real.
      if (!alive) return
      console.error('[insights] load:', err)
      setLoadError(String(err?.message || err))
      setLoading(false)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, tick, selectedId])

  const selected = useMemo(
    () => runs.find(r => r.id === selectedId) || runs[0] || null, [runs, selectedId],
  )
  const watching = isLive(selected)
  useEffect(() => {
    if (!watching) return undefined
    const t = setInterval(() => setTick(n => n + 1), 8_000)
    return () => clearInterval(t)
  }, [watching])

  const decisions = useMemo(() => summariseDecisions(events, ideas), [events, ideas])
  const performance = useMemo(() => summarisePerformance(perf, ideas), [perf, ideas])
  const proposed = useMemo(() => memory.filter(r => r.status === 'proposed'), [memory])
  const active = useMemo(() => memory.filter(r => r.status === 'active'), [memory])
  const summary = useMemo(
    () => summarise({ run: runs[0] || null, memory, performance, decisions, now }),
    [runs, memory, performance, decisions, now],
  )

  const runResearch = useCallback(async () => {
    if (running) return
    setRunning(true); setRunNote('')
    const out = await startResearchRun({ workspaceId: activeWorkspaceId, accessToken })
    setRunNote(
      out.already_running ? out.reason
        : out.ok ? 'Measuring — the numbers are committed. The investigation continues in the background.'
          : out.error || 'The run failed to start.',
    )
    setRunning(false)
    setSelectedId(null)
    reload()
  }, [running, activeWorkspaceId, accessToken, reload])

  const onActivate = useCallback(async (rule, text) => {
    setBusy(true)
    await updateBrandMemory(accessToken, rule.id, {
      rule: text || rule.rule, status: 'active', reviewed_at: new Date().toISOString(),
    })
    setBusy(false); reload()
  }, [accessToken, reload])

  // Dismissing a proposal and retiring an active rule are the same write: the
  // row stops being injected but is kept, so the same suggestion is not simply
  // re-proposed next time.
  const onRetire = useCallback(async rule => {
    setBusy(true)
    await updateBrandMemory(accessToken, rule.id, { status: 'retired', reviewed_at: new Date().toISOString() })
    setBusy(false); reload()
  }, [accessToken, reload])

  const onRemove = useCallback(async rule => {
    setBusy(true)
    await deleteBrandMemory(accessToken, rule.id)
    setBusy(false); reload()
  }, [accessToken, reload])

  const onRunReview = useCallback(async () => {
    setReviewing(true); setReviewNote('')
    const res = await requestInsightsReview(state.webhooks?.insightsReview, activeWorkspaceId)
    setReviewing(false)
    if (res.error) { setReviewNote(res.error); return }
    if (res.skipped) { setReviewNote(res.reason || 'Not enough history to review yet.'); return }
    setReviewNote(res.proposed
      ? `Proposed ${res.proposed} rule${res.proposed === 1 ? '' : 's'} — review them below.`
      : (res.note || 'The review found nothing worth proposing.'))
    reload()
  }, [state.webhooks, activeWorkspaceId, reload])

  if (!activeWorkspaceId) {
    return <Empty title="No workspace selected" description="Pick a brand to see its research." />
  }
  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>
  if (loadError) {
    return (
      <Card className="p-6">
        <Empty
          title="Could not load this page"
          description={`${loadError}. This is a connection problem rather than missing data — nothing has been lost.`}
          action={<Button onClick={() => { setLoadError(''); setLoading(true); reload() }}>Try again</Button>}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Research"
        subtitle={`What is happening around ${activeWorkspace?.name || 'this brand'}, and what we have learned from it.`}
      >
        <Button variant="secondary" size="sm" onClick={runResearch} disabled={running || watching}>
          {running ? 'Starting…' : watching ? 'Running…' : 'Run research'}
        </Button>
      </PageHeader>

      {runNote && <Card className="p-3"><p className="text-sm text-text-secondary">{runNote}</p></Card>}

      {/* ── Where we stand ──
          Above the tabs on purpose. The question a person arrives with is
          "what should I do now?", and it is answered from BOTH halves — making
          them pick a tab before finding out would be the same mistake that
          split this into two pages. */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Where we stand</p>
            {summary.next ? (
              <>
                <p className="text-base font-semibold text-text mt-1.5 leading-snug">{summary.next.text}</p>
                {summary.next.detail && (
                  <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{summary.next.detail}</p>
                )}
              </>
            ) : (
              <p className="text-base font-semibold text-text mt-1.5 leading-snug">
                Nothing needs you right now. Research is current, nothing is waiting for review,
                and no deadline is close.
              </p>
            )}
          </div>
          {summary.next?.kind === 'review' && (
            <Button size="sm" className="shrink-0" onClick={() => setTab('learned')}>Review them</Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border mt-4 border-t border-border">
          <SummaryStat label="Steering generation" value={summary.learned.active} hint={learningLine(summary)} />
          <SummaryStat
            label="Waiting on review" value={summary.learned.proposed}
            hint={summary.learned.proposed ? 'Approve one and it starts steering captions.' : 'Nothing pending.'}
          />
          <SummaryStat
            label="Market"
            value={summary.market.hasRun ? (summary.market.actNow || '—') : '—'}
            hint={!summary.market.hasRun ? 'No research has run yet.'
              : summary.market.actNow
                ? `dated action${summary.market.actNow === 1 ? '' : 's'} · researched ${ageLabel(summary.market.ageDays)}`
                : `nothing dated · researched ${ageLabel(summary.market.ageDays)}`}
          />
          <SummaryStat
            label="Our own posts" value={summary.ourWork.postsMeasured}
            hint={summary.ourWork.usable ? 'enough history to draw on'
              : 'too few to conclude anything from'}
          />
        </div>

        {/* The setup gaps sit here rather than on the research half, because
            they hold BOTH halves back — a missing geography skews the brief,
            and a missing account makes every comparison one-sided. */}
        {summary.blocking.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Holding it back</p>
            <ul className="mt-2 space-y-1.5">
              {summary.blocking.map(g => (
                <li key={g.key} className="text-xs text-text-secondary leading-relaxed">
                  {g.what} <a href={g.to} className="text-sage-700 underline underline-offset-2">{g.fix}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── The two halves ── */}
      <div className="flex">
        {TABS.map(t => (
          <button
            key={t.key} onClick={() => setTab(t.key)} title={t.note}
            className={`flex-1 py-2 px-3 border -ml-px first:ml-0 text-xs font-semibold transition-colors ${
              tab === t.key
                ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                : 'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-text-tertiary -mt-2">{TABS.find(t => t.key === tab)?.note}</p>

      {tab === 'research' ? (
        <ResearchTab
          run={selected} runs={runs} lensRows={lensRows}
          selectedId={selected?.id} onSelectRun={setSelectedId}
          onRun={runResearch} running={running} now={now}
        />
      ) : (
        <LearnedTab
          events={events} decisions={decisions} performance={performance}
          proposed={proposed} active={active}
          noHistory={!events.length && !performance.postsWithMetrics}
          busy={busy} reviewing={reviewing} reviewNote={reviewNote}
          onRunReview={onRunReview} onActivate={onActivate} onRetire={onRetire} onRemove={onRemove}
        />
      )}
    </div>
  )
}
