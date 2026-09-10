import { useCallback, useState } from 'react'
import { useAuth } from '../store/auth'
import { Modal, Spinner } from './ui/index'
import { Icon } from './ui/icons'
import { fetchThreads, fetchThreadTurns, relativeAge } from '../lib/agentThreads'

// ─── Going back to an earlier conversation ─────────────────────────────────
// Every thread is already persisted — the server loads its own history rather
// than trusting the browser's — so the only thing missing was a way back in.
// Without it, "New conversation" was a one-way door: the old thread still
// existed, was still paid for, and could not be reached.
//
// Deliberately unlabelled. The icon sits beside the composer, and a word for
// it would be the loudest thing in a card whose subject is the answer being
// read.

function ThreadRow({ chat, onPick, active, opening, busy }) {
  return (
    <button
      onClick={() => onPick(chat)}
      disabled={busy}
      className={`w-full text-left px-5 py-3 border-b border-slate-100 last:border-0
                 hover:bg-slate-50 disabled:opacity-50 flex items-baseline gap-3
                 ${active ? 'bg-slate-50' : ''}`}
    >
      <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">
        {chat.title?.trim() || 'Untitled conversation'}
      </span>
      {active ? <span className="text-[10px] text-slate-400 shrink-0">on screen</span> : null}
      {opening
        ? <Spinner size="sm" />
        : (
          // The age, not the date. Nobody scanning old threads is looking for
          // a timestamp; they are looking for "the one from Tuesday".
          <span
            className="text-xs text-slate-400 tabular-nums shrink-0"
            title={new Date(chat.updated_at || chat.created_at).toLocaleString()}
          >
            {relativeAge(chat.updated_at || chat.created_at)}
          </span>
        )}
    </button>
  )
}

/**
 * The icon button plus its popup.
 *
 * @param {object}   props
 * @param {string}   props.activeThreadId  the conversation on screen right now
 * @param {Function} props.onOpen          (threadId, turns) => void
 */
export default function PastConversations({ activeThreadId, onOpen }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [chats, setChats] = useState([])
  const [opening, setOpening] = useState('')

  // Fetched on open rather than on mount: this is a list nobody looks at most
  // sessions, and a query per page load to render nothing is a query wasted.
  const show = useCallback(async () => {
    setOpen(true)
    setLoading(true)
    const rows = await fetchThreads(activeWorkspaceId, accessToken)
    setChats(rows)
    setLoading(false)
  }, [activeWorkspaceId, accessToken])

  const pick = useCallback(async (chat) => {
    if (chat.id === activeThreadId) { setOpen(false); return }
    setOpening(chat.id)
    const turns = await fetchThreadTurns(chat.id, activeWorkspaceId, accessToken)
    setOpening('')
    setOpen(false)
    onOpen(chat.id, turns)
  }, [activeThreadId, activeWorkspaceId, accessToken, onOpen])

  return (
    <>
      <button
        type="button"
        onClick={show}
        title="Earlier conversations"
        aria-label="Earlier conversations"
        className="w-9 shrink-0 flex items-center justify-center rounded-lg border border-slate-200
                   text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors
                   focus:outline-none focus:ring-1 focus:ring-slate-400"
      >
        {Icon.clockRewind}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Earlier conversations">
        {loading ? (
          <div className="py-10 flex justify-center"><Spinner /></div>
        ) : chats.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500 text-center">
            Nothing yet — this is the first conversation with this brand's assistant.
          </p>
        ) : (
          <div>
            {chats.map(c => (
              <ThreadRow
                key={c.id}
                chat={c}
                onPick={pick}
                active={c.id === activeThreadId}
                opening={opening === c.id}
                busy={Boolean(opening)}
              />
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}
