import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useAgentChat } from '../lib/useAgentChat'
import { describePage, describeContextLabel, suggestionsFor } from '../lib/pageContext'
import { Button, Spinner } from './ui/index'
import PastConversations from './PastConversations'
import { AgentMarkdown } from './AgentMarkdown'
import AskInput from './AskInput'

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
          className={`text-[10px] px-1.5 py-0.5 font-mono ${
            s.ok === false
              ? 'bg-red-50 text-red-600'
              : s.ok === undefined && busy
                ? 'bg-amber-50 text-amber-700'
                : 'bg-surface-muted text-text-secondary'
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
  // Whether the earlier-conversations popup is up. Tracked only so this
  // drawer can stand down from Escape while it is — see below.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const { turns, busy, ask, reset, stop, ready, threadId, openThread } = useAgentChat()
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
      } else if (e.key === 'Escape' && open && !historyOpen) {
        // Yielded while the popup is up. That listens for Escape on document
        // and this one listens on window, so both would fire and a single
        // press would close the popup AND the drawer behind it. The popup is
        // the thing in front; it gets the key.
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, historyOpen])

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
          className="fixed bottom-5 right-5 z-40 h-11 w-11 bg-amber-700 text-white
                     shadow-dropdown hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 flex items-center justify-center"
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
          <div className="flex-1 bg-stone-900/10" onClick={() => setOpen(false)} />

          <aside className="w-full max-w-md bg-white h-full shadow-dropdown flex flex-col border-l border-border">
            <header className="px-4 py-3 border-b border-border-light flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text">Assistant</div>
                <div className="text-xs text-text-secondary truncate">
                  {activeWorkspace?.name || 'This brand'}
                  {/* Saying what it can see, rather than silently having it.
                      An assistant with invisible context is harder to trust. */}
                  {contextLabel ? <> · can see <span className="text-text">{contextLabel}</span></> : null}
                </div>
              </div>
              {turns.length ? (
                <button onClick={reset} className="text-xs font-semibold text-text-secondary hover:text-text px-2 py-1 border border-transparent hover:border-border transition-colors">
                  New
                </button>
              ) : null}
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="w-7 h-7 flex items-center justify-center text-text-tertiary border border-transparent hover:border-border hover:text-text transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {turns.length === 0 ? (
                <div className="pt-2">
                  <p className="text-xs text-text-secondary mb-2.5">
                    Answers come from your own data. It will say when a sample is too small
                    to mean anything, and it can propose rules and drafts — never publish.
                  </p>
                  <div className="space-y-1.5">
                    {suggestions.map(s => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="block w-full text-left text-xs px-2.5 py-2 border transition-colors
                                   border-border text-text-secondary hover:bg-surface-subtle"
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
                        <span className="inline-block bg-surface-muted px-3 py-1.5 text-sm
                                         text-text max-w-[90%] text-left">
                          {t.text}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <AgentMarkdown>{t.text}</AgentMarkdown>
                        {!t.text && !t.error && busy && i === turns.length - 1 ? <Spinner size="sm" /> : null}
                        {t.error ? (
                          <div className="mt-1 text-sm text-red-600">{t.error}</div>
                        ) : null}
                        <ToolTrace steps={t.steps} busy={busy && i === turns.length - 1} />
                        {t.cost ? (
                          <div className="mt-1 text-[10px] text-text-tertiary">
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

            {/* items-end keeps the history and Ask buttons pinned to the bottom
                of a composer that has grown to several lines, rather than
                floating up the middle of it. */}
            <form
              onSubmit={e => { e.preventDefault(); send() }}
              className="p-3 border-t border-border-light flex gap-2 items-end"
            >
              {/* The same way back the /agent page has. The popup portals to
                  the body rather than into this panel, so it is the same size
                  here as it is there — the 448px is no constraint on it. */}
              <PastConversations
                activeThreadId={threadId}
                onOpen={openThread}
                onDeleteActive={reset}
                onOpenChange={setHistoryOpen}
              />
              <AskInput
                inputRef={input}
                value={question}
                onChange={setQuestion}
                onSubmit={send}
                placeholder={contextLabel ? `Ask about ${contextLabel}…` : 'Ask anything…'}
                disabled={!ready}
              />
              {busy ? (
                <Button variant="secondary" onClick={stop}>Stop</Button>
              ) : (
                <Button type="submit" disabled={!question.trim() || !ready}>Ask</Button>
              )}
            </form>
          </aside>
        </div>
      ) : null}
    </>
  )
}
