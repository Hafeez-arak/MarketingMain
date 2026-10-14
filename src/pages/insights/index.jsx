import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, Button, Empty, Skeleton, ConfirmDialog } from '../../components/ui/index'
import { fetchBrandMemory, updateBrandMemory, deleteBrandMemory } from '../../lib/brandContext'
import { runHealth, scheduleNeverRan } from '../../lib/agent/runHealth'
import {
  fetchIdeaEvents, fetchIdeasForInsights, fetchPerformance, requestInsightsReview,
  summariseDecisions, summarisePerformance,
} from '../../lib/insights'
import { startResearchRun, fetchRuns, fetchLensResults, fetchAgentSpend } from '../../lib/agentRun'
import { isLive } from '../../lib/agent/progress'
import { summarise, ageLabel } from '../../lib/learnedSummary'
import { ResearchTab } from './ResearchTab'
import { LearnedTab } from './LearnedTab'
import { plainHealth, plainGap, plainRunProblem } from './plainWords'

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
// Above both sits at most ONE line — the single thing that needs someone now —
// because "what should I do?" can be answered from either half. The rest of
// the old summary grid lives at the top of What We Learned, where its numbers
// (rules in use, posts measured) are about.
//
// The tab is in the URL (?tab=learned) so a link to the rule book is a link to
// the rule book, not to whichever half happened to be open.

// The hint is never allowed to be absent — a number with nothing qualifying it
// is exactly the kind of confident, unreadable figure this app avoids.
function SummaryStat({ label, value, hint }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-text mt-0.5 tabular-nums">{value}</p>
      <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{hint}</p>
    </div>
  )
}

/** Where we stand — the numbers behind What We Learned, and what holds them back. */
function LearnedSummary({ summary }) {
  const { learned, market, ourWork } = summary
  const gaps = summary.blocking.map(plainGap)
  return (
    <Card className="p-0">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        <SummaryStat
          label="Rules in use" value={learned.active}
          hint={learned.active ? 'Shaping every new piece of content.' : 'None yet — content follows the Brand Brain alone.'}
        />
        <SummaryStat
          label="Waiting for review" value={learned.proposed}
          hint={learned.proposed ? 'Approve one and it starts shaping content.' : 'Nothing waiting.'}
        />
        <SummaryStat
          label="Dated actions"
          value={market.hasRun ? market.actNow : '—'}
          hint={!market.hasRun ? 'No research has run yet.'
            : `From research ${ageLabel(market.ageDays)}.`}
        />
        <SummaryStat
          label="Our posts measured" value={ourWork.postsMeasured}
          hint={ourWork.usable ? 'Enough to learn from.' : 'Too few to draw conclusions yet.'}
        />
      </div>
      {/* Setup gaps hold BOTH halves back — a missing market skews the
          research, a missing account makes every comparison one-sided. */}
      {gaps.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Holding it back</p>
          <ul className="mt-2 space-y-1.5">
            {gaps.map(g => (
              <li key={g.key} className="text-xs text-text-secondary leading-relaxed">
                {g.what} <Link to={g.to} className="text-sage-700 underline underline-offset-2">{g.fix}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

const TABS = [
  { key: 'research', label: 'Market research', note: 'What is happening in the market, and what to do about it.' },
  { key: 'learned', label: 'What we learned', note: 'What our own posts and decisions taught us, and the rules that now shape new content.' },
]

export function Insights() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const { state } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
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
      fetchRuns(activeWorkspaceId, accessToken, 12, { throwOnError: true }),
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

  // Computed from the run list the page already loads, so this costs no
  // query — the reason it can sit on every visit rather than behind a check.
  const health = useMemo(() => runHealth(runs, now), [runs, now])
  const neverScheduled = useMemo(() => scheduleNeverRan(runs), [runs])

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

  // ── Asked first ──
  // A run spends real money and takes minutes, and the button sits beside two
  // that only open pages. One click should not be enough to start it.
  const [confirmRun, setConfirmRun] = useState(false)
  const [spend, setSpend] = useState(null)
  const askRun = useCallback(() => {
    if (running) return
    setSpend(null)
    setConfirmRun(true)
    fetchAgentSpend(activeWorkspaceId, accessToken).then(setSpend)
  }, [running, activeWorkspaceId, accessToken])
  const lastCost = Number(runs.find(r => r.status === 'complete' && Number(r.cost_estimate) > 0)?.cost_estimate) || null
  const runMessage = [
    'This searches the web on every research topic and takes about 5–10 minutes.',
    lastCost ? `The last full run cost $${lastCost.toFixed(2)}.` : '',
    spend ? `This month so far: $${spend.spent.toFixed(2)}${spend.cap != null ? ` of the $${spend.cap.toFixed(0)} monthly limit` : ''}.` : '',
  ].filter(Boolean).join(' ')

  const runResearch = useCallback(async () => {
    if (running) return
    setRunning(true); setRunNote('')
    const out = await startResearchRun({ workspaceId: activeWorkspaceId, accessToken })
    setRunNote(
      out.already_running ? 'Research is already running. This page updates as it goes.'
        : out.ok ? 'Research has started. It takes about 5–10 minutes, and this page updates as it goes.'
          : `The research could not be started. ${plainRunProblem(out.error, 'Please try again in a few minutes.')}`,
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
    return <Empty title="No brand selected" description="Pick a brand to see its research." />
  }
  const subtitle = `What is happening in ${activeWorkspace?.name || 'this brand'}’s market, and what to do about it.`
  if (loading) {
    // The page's own frame, with its cards as skeletons: a lone spinner on a
    // blank page reads as broken, and a card drawn over no data reads as a
    // claim ("no research has run").
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading research">
        <PageHeader title="Research" subtitle={subtitle} />
        <Skeleton className="h-9 w-full" />
        <Card className="p-5 sm:p-6 space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-3/4 max-w-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        </Card>
        {[0, 1].map(i => (
          <Card key={i} className="p-5 space-y-2">
            <Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" />
          </Card>
        ))}
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Research" subtitle={subtitle} />
        <Card className="p-6">
          <Empty
            title="The research could not be loaded"
            description="This is a connection problem, not missing research — nothing has been lost. Please try again."
            action={<Button onClick={() => { setLoadError(''); setLoading(true); reload() }}>Try again</Button>}
          />
        </Card>
      </div>
    )
  }

  const warning = plainHealth(health, runs)
  // The one thing worth doing next. A "deadline" next step is the research
  // tab's own top item, and "no research" is that tab's empty state — both
  // are only worth repeating up here when the reader is on the other tab.
  const next = summary.next
  const showNext = next && next.kind !== 'no_research' && !(next.kind === 'stale' && warning) &&
    !(next.kind === 'deadline' && tab === 'research')
  const nextGap = next?.kind === 'setup' && summary.blocking[0] ? plainGap(summary.blocking[0]) : null

  return (
    <div className="space-y-4">
      <PageHeader title="Research" subtitle={subtitle}>
        {/* Only once a run exists: a PDF of "nothing has been run yet" is a
            worse way to learn that than the empty state on this page. */}
        {runs.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => navigate(`/insights/report${selected?.id ? `?run=${selected.id}` : ''}`)}>
            Download PDF
          </Button>
        )}
        {/* Not gated on a run: built from the watchlist and the bid log, both
            worth reading before any research has been done. */}
        <Button variant="secondary" size="sm" onClick={() => navigate('/insights/business')}>
          Business view
        </Button>
        <Button size="sm" onClick={askRun} disabled={running || watching}>
          {running ? 'Starting…' : watching ? 'Research running…' : 'Run research'}
        </Button>
      </PageHeader>

      <ConfirmDialog
        open={confirmRun} onClose={() => setConfirmRun(false)}
        title="Run research now?"
        message={runMessage}
        onConfirm={runResearch}
      />

      {runNote && <Card className="p-3"><p className="text-sm text-text-secondary">{runNote}</p></Card>}

      {/* ── Is the research actually running? ──
          Above everything, because it changes how to read everything below.
          Last month's research with no warning looks exactly like this week's. */}
      {warning && (
        <div role="status" className={`border px-4 py-3 ${warning.tone === 'red' ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
          <p className="text-sm font-semibold text-text">{warning.headline}</p>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed max-w-3xl">{warning.detail}</p>
        </div>
      )}
      {neverScheduled && !warning && (
        <p className="text-xs text-text-tertiary leading-relaxed">
          Every research run so far was started by hand — the weekly automatic run has not happened yet.
        </p>
      )}

      {showNext && (
        <Card className="px-4 py-3 border-l-2 border-l-amber-700">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 max-w-3xl">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Needs your attention</p>
              <p className="text-sm font-semibold text-text mt-1 leading-snug">{nextGap ? nextGap.what : next.text}</p>
              {!nextGap && next.detail && <p className="text-xs text-text-secondary mt-1 leading-relaxed">{next.detail}</p>}
            </div>
            {next.kind === 'review' && <Button size="sm" className="shrink-0" onClick={() => setTab('learned')}>Review them</Button>}
            {next.kind === 'deadline' && <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setTab('research')}>See the research</Button>}
            {next.kind === 'stale' && <Button size="sm" variant="secondary" className="shrink-0" onClick={askRun} disabled={running || watching}>Run research</Button>}
            {nextGap && <Link to={nextGap.to}><Button size="sm" variant="secondary" className="shrink-0">{nextGap.fix}</Button></Link>}
          </div>
        </Card>
      )}

      {/* ── The two halves ── */}
      <div>
        <div className="flex" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
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
        <p className="text-[11px] text-text-tertiary mt-1.5">{TABS.find(t => t.key === tab)?.note}</p>
      </div>

      {tab === 'research' ? (
        <ResearchTab
          run={selected} runs={runs} lensRows={lensRows}
          selectedId={selected?.id} onSelectRun={setSelectedId}
          onRun={askRun} running={running} now={now}
        />
      ) : (
        <>
          <LearnedSummary summary={summary} />
          <LearnedTab
            events={events} decisions={decisions} performance={performance}
            proposed={proposed} active={active}
            noHistory={!events.length && !performance.postsWithMetrics}
            busy={busy} reviewing={reviewing} reviewNote={reviewNote}
            onRunReview={onRunReview} onActivate={onActivate} onRetire={onRetire} onRemove={onRemove}
          />
        </>
      )}
    </div>
  )
}