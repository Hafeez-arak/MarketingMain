import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useAgentChat } from '../lib/useAgentChat'
import { describePage, describeContextLabel, suggestionsFor } from '../lib/pageContext'
import { Spinner } from './ui/index'

// ─── The assistant, on every page ──────────────────────────────────────────
// AGENT.md §5a. A drawer that opens anywhere and knows what you are looking
// at: open it on a post and "why did this underperform?" already has the post.
//
// The conversation is shared with /agent through useAgentChat, so walking from
// Analytics to the Planner continues it rather than restarting.

function ToolTrace({ steps, busy }) {
  if (!steps?.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {steps.map((s, i) => (
        <span
          key={i}
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            s.ok === false
              ? 'bg-red-50 text-red-600'
              : s.ok === undefined && busy
                ? 'bg-amber-50 text-amber-700'
                : 'bg-slate-100 text-slate-500'
          }`}
        >
          {s.name}
        </span>
      ))}
    </div>
  )
}

export function AssistantDrawer() {
  const location = useLocation()
  const { activeWorkspaceId, activeWorkspace } = useAuth()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const { turns, busy, ask, reset, stop, ready } = useAgentChat()
  const bottom = useRef(null)
  const input = useRef(null)

  // Recomputed per render from the router, so the descriptor is always for the
  // page actually on screen rather than the one the drawer opened on.
  const context = useMemo(() => describePage(location), [location])
  const contextLabel = describeContextLabel(context)
  const suggestions = useMemo(() => suggestionsFor(context), [context])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, busy])
  useEffect(() => { if (open) input.current?.focus() }, [open])

  // Cmd/Ctrl-K opens it from anywhere, Escape closes. The whole point is
  // reachability, and a button you have to find with the mouse is less
  // reachable than a key.
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = useCallback((text) => {
    const q = text ?? question
    if (!q?.trim()) return
    setQuestion('')
    ask(q, context)
  }, [question, ask, context])

  if (!activeWorkspaceId) return null

  return (
    <>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          title="Ask the assistant  (⌘K)"
          className="fixed bottom-5 right-5 z-40 h-11 w-11 rounded-full bg-slate-900 text-white
                     shadow-lg hover:bg-slate-800 flex items-center justify-center"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Click-away rather than a modal: the person is meant to keep
              working with this open, so it must never trap focus. */}
          <div className="flex-1 bg-slate-900/10" onClick={() => setOpen(false)} />

          <aside className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-slate-200">
            <header className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900">Assistant</div>
                <div className="text-xs text-slate-500 truncate">
                  {activeWorkspace?.name || 'This brand'}
                  {/* Saying what it can see, rather than silently having it.
                      An assistant with invisible context is harder to trust. */}
                  {contextLabel ? <> · can see <span className="text-slate-700">{contextLabel}</span></> : null}
                </div>
              </div>
              {turns.length ? (
                <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-700 px-1">
                  New
                </button>
              ) : null}
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700 px-1">
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {turns.length === 0 ? (
                <div className="pt-2">
                  <p className="text-xs text-slate-500 mb-2.5">
                    Answers come from your own data. It will say when a sample is too small
                    to mean anything, and it can propose rules and drafts — never publish.
                  </p>
                  <div className="space-y-1.5">
                    {suggestions.map(s => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="block w-full text-left text-xs px-2.5 py-2 rounded-lg border
                                   border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                turns.map((t, i) => (
                  <div key={i}>
                    {t.role === 'user' ? (
                      <div className="text-right">
                        <span className="inline-block bg-slate-100 rounded-2xl px-3 py-1.5 text-sm
                                         text-slate-800 max-w-[90%] text-left">
                          {t.text}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                          {t.text}
                          {!t.text && !t.error && busy && i === turns.length - 1 ? <Spinner size="sm" /> : null}
                        </div>
                        {t.error ? (
                          <div className="mt-1 text-sm text-red-600">{t.error}</div>
                        ) : null}
                        <ToolTrace steps={t.steps} busy={busy && i === turns.length - 1} />
                        {t.cost ? (
                          <div className="mt-1 text-[10px] text-slate-400">
                            ${t.cost.toFixed(4)}
                            {t.stoppedBy && t.stoppedBy !== 'answered' ? ` · ${t.stoppedBy}` : ''}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={bottom} />
            </div>

            <form
              onSubmit={e => { e.preventDefault(); send() }}
              className="p-3 border-t border-slate-100 flex gap-2"
            >
              <input
                ref={input}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder={contextLabel ? `Ask about ${contextLabel}…` : 'Ask anything…'}
                disabled={!ready}
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-200
                           focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  className="text-xs px-3 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!question.trim() || !ready}
                  className="text-sm px-3 py-2 rounded-lg bg-slate-900 text-white
                             disabled:bg-slate-200 disabled:text-slate-400"
                >
                  Ask
                </button>
              )}
            </form>
          </aside>
        </div>
      ) : null}
    </>
  )
}
