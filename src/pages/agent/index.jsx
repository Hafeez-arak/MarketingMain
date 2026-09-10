import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, SectionHead, Button, Spinner, Empty } from '../../components/ui/index'
import { askAgent } from '../../lib/agentChat'
import { startResearchRun, fetchRuns } from '../../lib/agentRun'

// ─── /agent — the assistant, first surface ─────────────────────────────────
// AGENT.md §5 describes a drawer that opens on every page and knows what you
// are looking at. This is not that yet. It is the same agent, the same tools
// and the same thread, on a page of its own, so the whole path can be
// exercised end to end before it is wired into every screen.
//
// Deliberately plain. The point of this page is to prove the pipe — auth,
// streaming, the tool loop, the ledger — not to be the final UI.

const SUGGESTIONS = [
  'What do you know about this brand?',
  'Who are our competitors and which ones can you actually see on Instagram?',
  'What rules have we learned so far, and has anything been rejected?',
  'How have our posts performed lately?',
  'What is scheduled to go out?',
]

function ToolTrace({ steps }) {
  if (!steps.length) return null
  return (
    <div className="mt-2 text-xs text-slate-500 space-y-0.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className={s.ok === false ? 'text-red-500' : 'text-slate-400'}>
            {s.ok === false ? '✕' : '·'}
          </span>
          <code className="font-mono">{s.name}</code>
        </div>
      ))}
    </div>
  )
}

export default function AgentPage() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState([])
  const [busy, setBusy] = useState(false)
  const [threadId, setThreadId] = useState('')
  const [runs, setRuns] = useState([])
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState('')
  const bottom = useRef(null)

  const loadRuns = useCallback(async () => {
    if (!activeWorkspaceId || !accessToken) return
    setRuns(await fetchRuns(activeWorkspaceId, accessToken))
  }, [activeWorkspaceId, accessToken])

  useEffect(() => { loadRuns() }, [loadRuns])

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
        : out.ok ? `${out.headline || 'Run complete.'} (${out.measured} measured, ${out.failed} unreadable)`
        : out.error || 'The run failed.',
    )
    setRunning(false)
    loadRuns()
  }, [running, activeWorkspaceId, accessToken, loadRuns])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  // Switching workspace starts a new conversation rather than carrying the old
  // one across. The thread belongs to one workspace and the agent sees exactly
  // one — continuing it would be showing another brand's answers under this
  // brand's name.
  useEffect(() => {
    setThreadId('')
    setTurns([])
  }, [activeWorkspaceId])

  const ask = useCallback(async (text) => {
    const q = String(text ?? question).trim()
    if (!q || busy || !activeWorkspaceId || !accessToken) return

    setQuestion('')
    setBusy(true)
    setTurns(prev => [...prev, { role: 'user', text: q }, { role: 'assistant', text: '', steps: [] }])

    const patchLast = patch => setTurns(prev => {
      const next = [...prev]
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })

    const result = await askAgent({
      workspaceId: activeWorkspaceId,
      accessToken,
      question: q,
      threadId,
      // The typed page descriptor from AGENT.md §5a — a route, never a scrape
      // of the screen. On this page there is no entity, so it is just the route.
      context: { route: '/agent' },
      onText: delta => setTurns(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        next[next.length - 1] = { ...last, text: last.text + delta }
        return next
      }),
      onStep: step => {
        if (step.type === 'tool') {
          setTurns(prev => {
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, steps: [...(last.steps || []), { name: step.name }] }
            return next
          })
        }
        if (step.type === 'tool_done') {
          setTurns(prev => {
            const next = [...prev]
            const last = next[next.length - 1]
            const steps = [...(last.steps || [])]
            for (let i = steps.length - 1; i >= 0; i--) {
              if (steps[i].name === step.name && steps[i].ok === undefined) {
                steps[i] = { ...steps[i], ok: step.ok }
                break
              }
            }
            next[next.length - 1] = { ...last, steps }
            return next
          })
        }
      },
    })

    if (result.threadId) setThreadId(result.threadId)
    patchLast({
      error: result.error,
      cost: result.cost,
      stoppedBy: result.stoppedBy,
      // A refusal or a crash can arrive with no text at all. Saying so beats
      // an empty bubble, which reads as the agent having nothing to say.
      text: result.text,
    })
    setBusy(false)
  }, [question, busy, activeWorkspaceId, accessToken, threadId])

  if (!activeWorkspaceId) {
    return <Empty title="No workspace selected" description="Pick a workspace to talk to its assistant." />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assistant"
        subtitle={`Ask about ${activeWorkspace?.name || 'this brand'} — its posts, its numbers, its market.`}
      >
        {threadId ? (
          <Button variant="ghost" onClick={() => { setThreadId(''); setTurns([]) }}>
            New conversation
          </Button>
        ) : null}
        <Button variant="secondary" onClick={runResearch} disabled={running}>
          {running ? 'Measuring…' : 'Run research'}
        </Button>
      </PageHeader>

      <Card className="p-4">
        <SectionHead
          title="Weekly research"
          subtitle="Measures every competitor with a verified Instagram handle. No model is involved — these numbers are computed in code."
        />
        {runNote ? (
          <p className="mt-2 text-sm text-slate-700">{runNote}</p>
        ) : null}
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No run has been started for this brand yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {runs.map(r => (
              <li key={r.id} className="text-sm flex items-baseline gap-2">
                <span
                  className={
                    r.status === 'complete' ? 'text-emerald-600'
                      : r.status === 'failed' ? 'text-red-600' : 'text-amber-600'
                  }
                >
                  ●
                </span>
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
              and will say when a sample is too small to mean anything.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => ask(s)}
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
                <div
                  className={
                    t.role === 'user'
                      ? 'inline-block bg-slate-100 rounded-2xl px-3.5 py-2 text-sm text-slate-800 max-w-[85%] text-left'
                      : 'text-sm text-slate-800 whitespace-pre-wrap leading-relaxed'
                  }
                >
                  {t.text || (t.role === 'assistant' && !t.error && busy ? <Spinner size="sm" /> : null)}
                  {t.error ? (
                    <span className="text-red-600">{t.error}</span>
                  ) : null}
                </div>
                {t.role === 'assistant' ? <ToolTrace steps={t.steps || []} /> : null}
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
          onSubmit={e => { e.preventDefault(); ask() }}
          className="mt-4 flex gap-2 border-t border-slate-100 pt-3"
        >
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask anything about this brand…"
            disabled={busy}
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
