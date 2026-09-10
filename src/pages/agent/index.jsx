import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, SectionHead, Button, Spinner, Empty } from '../../components/ui/index'
import { useAgentChat } from '../../lib/useAgentChat'
import { describePage, suggestionsFor } from '../../lib/pageContext'
import { startResearchRun, fetchRuns } from '../../lib/agentRun'

// ─── /agent — the assistant, full page ─────────────────────────────────────
// The same agent, the same tools and the SAME conversation as the drawer —
// useAgentChat holds the thread outside component state precisely so these two
// surfaces cannot drift into separate threads.
//
// This page exists for the two things a 400px drawer is bad at: reading a long
// answer, and starting and reviewing a research run.

function ToolTrace({ steps }) {
  if (!steps?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {steps.map((s, i) => (
        <span
          key={i}
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            s.ok === false ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {s.name}
        </span>
      ))}
    </div>
  )
}

export default function AgentPage() {
  const location = useLocation()
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const { turns, busy, ask, reset, stop, ready } = useAgentChat()
  const [question, setQuestion] = useState('')
  const [runs, setRuns] = useState([])
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState('')
  const bottom = useRef(null)

  const context = useMemo(() => describePage(location), [location])
  const suggestions = useMemo(() => suggestionsFor(context), [context])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, busy])

  // `reload` is a counter rather than a callback dependency so that starting a
  // run can ask for a refresh without the effect re-subscribing on every
  // render.
  const [reload, setReload] = useState(0)
  const loadRuns = useCallback(() => setReload(n => n + 1), [])

  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return undefined
    let cancelled = false
    fetchRuns(activeWorkspaceId, accessToken).then(rows => {
      // Guarded so a slow response cannot land after the page has gone, or
      // after the person has switched to another brand.
      if (!cancelled) setRuns(rows)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken, reload])

  const runResearch = useCallback(async () => {
    if (running) return
    setRunning(true)
    setRunNote('')
    const out = await startResearchRun({ workspaceId: activeWorkspaceId, accessToken })
    // "Already running" is a success, not a failure — a second press attaches
    // to the run already going rather than starting a second agent on the same
    // period and doubling the bill.
    setRunNote(
      out.already_running ? out.reason
        : out.ok
          ? `${out.headline || 'Run complete.'} — ${out.measured} measured, ${out.failed} unreadable` +
            (out.investigated ? '' : ` (${out.note || 'measured numbers only'})`)
          : out.error || 'The run failed.',
    )
    setRunning(false)
    loadRuns()
  }, [running, activeWorkspaceId, accessToken, loadRuns])

  const send = useCallback((text) => {
    const q = text ?? question
    if (!q?.trim()) return
    setQuestion('')
    ask(q, context)
  }, [question, ask, context])

  if (!activeWorkspaceId) {
    return <Empty title="No workspace selected" description="Pick a workspace to talk to its assistant." />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assistant"
        subtitle={`Ask about ${activeWorkspace?.name || 'this brand'} — its posts, its numbers, its market.`}
      >
        {turns.length ? <Button variant="ghost" onClick={reset}>New conversation</Button> : null}
        <Button variant="secondary" onClick={runResearch} disabled={running}>
          {running ? 'Measuring…' : 'Run research'}
        </Button>
      </PageHeader>

      <Card className="p-4">
        <SectionHead
          title="Weekly research"
          subtitle="Measures every competitor with a verified Instagram handle, then investigates what moved. The numbers are computed in code, never by a model."
        />
        {runNote ? <p className="mt-2 text-sm text-slate-700">{runNote}</p> : null}
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No run has been started for this brand yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {runs.map(r => (
              <li key={r.id} className="text-sm flex items-baseline gap-2">
                <span className={
                  r.status === 'complete' ? 'text-emerald-600'
                    : r.status === 'failed' ? 'text-red-600' : 'text-amber-600'
                }>●</span>
                <span className="text-slate-500 text-xs w-36 shrink-0">
                  {new Date(r.started_at).toLocaleString()}
                </span>
                <span className="text-slate-700">
                  {r.error || r.report?.headline || `${r.status} · ${r.stage || ''}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        {turns.length === 0 ? (
          <div className="py-6">
            <p className="text-sm text-slate-500 mb-3">
              It reads this workspace only, answers from tools rather than memory,
              and will say when a sample is too small to mean anything. It can propose
              rules, ideas and drafts — it cannot publish or schedule anything.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
                <div className={
                  t.role === 'user'
                    ? 'inline-block bg-slate-100 rounded-2xl px-3.5 py-2 text-sm text-slate-800 max-w-[85%] text-left'
                    : 'text-sm text-slate-800 whitespace-pre-wrap leading-relaxed'
                }>
                  {t.text}
                  {t.role === 'assistant' && !t.text && !t.error && busy && i === turns.length - 1
                    ? <Spinner size="sm" /> : null}
                </div>
                {t.error ? <div className="mt-1 text-sm text-red-600">{t.error}</div> : null}
                {t.role === 'assistant' ? <ToolTrace steps={t.steps} /> : null}
                {t.role === 'assistant' && t.cost ? (
                  <div className="mt-1 text-[11px] text-slate-400">
                    ${t.cost.toFixed(4)}
                    {t.stoppedBy && t.stoppedBy !== 'answered' ? ` · stopped: ${t.stoppedBy}` : ''}
                  </div>
                ) : null}
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}

        <form
          onSubmit={e => { e.preventDefault(); send() }}
          className="mt-4 flex gap-2 border-t border-slate-100 pt-3"
        >
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask anything about this brand…"
            disabled={!ready}
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
          />
          {busy ? (
            <Button variant="ghost" onClick={stop}>Stop</Button>
          ) : (
            <Button type="submit" disabled={!question.trim() || !ready}>Ask</Button>
          )}
        </form>
      </Card>
    </div>
  )
}
