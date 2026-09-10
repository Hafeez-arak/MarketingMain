import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../store/auth'
import { askAgent } from './agentChat'

// ─── One conversation, two surfaces ────────────────────────────────────────
// The drawer and the /agent page are the same conversation, so the state
// machine lives here rather than in either of them. AGENT.md §5a: "walking
// from Analytics to the Planner does not restart the conversation — this is
// the difference between an assistant and a search box."
//
// The thread id is held in module scope, not in component state, precisely
// because both surfaces mount and unmount independently. A drawer closed on
// /analytics and reopened on /schedule is the same conversation; a useState in
// the drawer would silently start a new one every time it unmounted.

let sharedThread = { workspaceId: '', threadId: '' }

/** Called when the workspace changes — the thread belongs to exactly one brand. */
function threadFor(workspaceId) {
  if (sharedThread.workspaceId !== workspaceId) {
    sharedThread = { workspaceId, threadId: '' }
  }
  return sharedThread.threadId
}

export function useAgentChat() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [turns, setTurns] = useState([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(null)

  // Switching brand starts a new conversation rather than carrying the old one
  // across. The agent sees exactly one workspace; continuing would show
  // another brand's answers under this brand's name.
  //
  // Done during render rather than in an effect. This is "adjusting state when
  // a prop changes", and React's documented answer is exactly this shape — an
  // effect would render once with the previous brand's turns still on screen
  // before clearing them, which is a visible flash of the wrong brand's
  // conversation.
  const [lastWorkspace, setLastWorkspace] = useState(activeWorkspaceId)
  if (activeWorkspaceId !== lastWorkspace) {
    setLastWorkspace(activeWorkspaceId)
    threadFor(activeWorkspaceId)
    setTurns([])
  }

  const reset = useCallback(() => {
    sharedThread = { workspaceId: activeWorkspaceId, threadId: '' }
    setTurns([])
  }, [activeWorkspaceId])

  const stop = useCallback(() => {
    // Aborts the browser's read. The server keeps going and still persists the
    // answer — it has already been paid for, so throwing it away would mean
    // billing for something nobody can ever read. Reopening the thread shows
    // it.
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
  }, [])

  const ask = useCallback(async (text, context = null) => {
    const q = String(text || '').trim()
    if (!q || busy || !activeWorkspaceId || !accessToken) return

    setBusy(true)
    setTurns(prev => [...prev, { role: 'user', text: q }, { role: 'assistant', text: '', steps: [] }])

    const patchLast = patch => setTurns(prev => {
      const next = [...prev]
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })
    const appendLast = delta => setTurns(prev => {
      const next = [...prev]
      const last = next[next.length - 1]
      next[next.length - 1] = { ...last, text: last.text + delta }
      return next
    })

    const controller = new AbortController()
    abortRef.current = controller

    let result
    try {
      result = await askAgent({
        workspaceId: activeWorkspaceId,
        accessToken,
        question: q,
        threadId: threadFor(activeWorkspaceId),
        context,
        signal: controller.signal,
        onText: appendLast,
        onStep: step => {
          if (step.type === 'tool') {
            setTurns(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = { ...last, steps: [...(last.steps || []), { name: step.name }] }
              return next
            })
          } else if (step.type === 'tool_done') {
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
    } catch (err) {
      // An abort is a person pressing stop, not a failure. Anything else is.
      if (err?.name === 'AbortError') {
        patchLast({ stoppedBy: 'you' })
        setBusy(false)
        abortRef.current = null
        return
      }
      result = { ok: false, error: String(err?.message || err), threadId: threadFor(activeWorkspaceId) }
    }

    if (result.threadId) sharedThread = { workspaceId: activeWorkspaceId, threadId: result.threadId }
    patchLast({
      text: result.text ?? '',
      error: result.error,
      cost: result.cost,
      stoppedBy: result.stoppedBy,
      tools: result.tools,
    })
    setBusy(false)
    abortRef.current = null
  }, [busy, activeWorkspaceId, accessToken])

  return {
    turns, busy, ask, reset, stop,
    threadId: threadFor(activeWorkspaceId),
    ready: Boolean(activeWorkspaceId && accessToken),
  }
}
