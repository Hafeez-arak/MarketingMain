import { useCallback, useState } from 'react'
import { useAuth } from '../store/auth'
import { Modal, Spinner } from './ui/index'
import { Icon } from './ui/icons'
import {
  fetchThreads, fetchThreadTurns, renameThread, deleteThread, relativeAge,
} from '../lib/agentThreads'

// ─── Going back to an earlier conversation ─────────────────────────────────
// Every thread is already persisted — the server loads its own history rather
// than trusting the browser's — so the only thing missing was a way back in.
// Without it, "New conversation" was a one-way door: the old thread still
// existed, was still paid for, and could not be reached.
//
// Deliberately unlabelled. The icon sits beside the composer, and a word for
// it would be the loudest thing in a card whose subject is the answer being
// read.

const ROW = 'w-full text-left px-5 py-3 border-b border-slate-100 last:border-0'
const ICON_BTN = 'w-6 h-6 flex items-center justify-center rounded ' +
  'text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors'

/**
 * One thread.
 *
 * Three states in one row — reading, renaming, confirming a delete — rather
 * than a second overlay for either. A ConfirmDialog here would be a modal on
 * top of a modal, and both listen for Escape: one press would dismiss the
 * confirmation AND the list behind it.
 */
function ThreadRow({ chat, active, opening, busy, onPick, onRename, onDelete }) {
  const [mode, setMode] = useState('read')   // read | rename | confirm
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const title = chat.title?.trim() || 'Untitled conversation'

  const startRename = () => { setDraft(title); setMode('rename') }

  const commit = async () => {
    const next = draft.trim()
    // An empty name is a no-op rather than an error: a person clearing the
    // field and pressing Enter means "leave it", not "call it nothing".
    if (!next || next === title) { setMode('read'); return }
    setSaving(true)
    await onRename(chat, next)
    setSaving(false)
    setMode('read')
  }

  const confirmDelete = async () => {
    setSaving(true)
    await onDelete(chat)
    // No setState afterwards — the row is gone by the time this resolves.
  }

  if (mode === 'rename') {
    return (
      <div className={`${ROW} flex items-center gap-2`}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            // Stopped here so Escape means "stop renaming" and not "close the
            // whole list" — the modal is listening for it too.
            if (e.key === 'Escape') { e.stopPropagation(); setMode('read') }
          }}
          disabled={saving}
          className="flex-1 min-w-0 text-sm px-2 py-1 rounded border border-slate-300
                     focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
        />
        {saving
          ? <Spinner size="sm" />
          : (
            <>
              <button onClick={commit} className="text-xs text-slate-700 hover:underline px-1">Save</button>
              <button onClick={() => setMode('read')} className="text-xs text-slate-400 hover:underline px-1">Cancel</button>
            </>
          )}
      </div>
    )
  }

  if (mode === 'confirm') {
    return (
      <div className={`${ROW} flex items-center gap-3 bg-red-50/60`}>
        <span className="flex-1 min-w-0 text-sm text-slate-700">
          Delete “{title}”? Its messages go with it.
        </span>
        {saving
          ? <Spinner size="sm" />
          : (
            <>
              <button onClick={confirmDelete} className="text-xs font-medium text-red-600 hover:underline px-1">Delete</button>
              <button onClick={() => setMode('read')} className="text-xs text-slate-500 hover:underline px-1">Keep</button>
            </>
          )}
      </div>
    )
  }

  // The open target is a button and the two actions are its siblings, never
  // its children: a button inside a button is invalid, and the browser's
  // recovery from it is to drop one of them.
  return (
    <div className={`${ROW} flex items-center gap-2 group ${active ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
      <button
        onClick={() => onPick(chat)}
        disabled={busy}
        className="flex-1 min-w-0 text-left flex items-baseline gap-3 disabled:opacity-50"
      >
        <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{title}</span>
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

      {/* Held at low opacity rather than hidden: an action that appears only
          on hover cannot be found by anyone who never hovers, and is invisible
          to a keyboard entirely. focus-within brings them up for Tab too. */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button onClick={startRename} title="Rename" aria-label={`Rename ${title}`} className={ICON_BTN}>
          {Icon.pencil}
        </button>
        <button
          onClick={() => setMode('confirm')}
          title="Delete"
          aria-label={`Delete ${title}`}
          className={`${ICON_BTN} hover:bg-red-100 hover:text-red-600`}
        >
          {Icon.trash}
        </button>
      </div>
    </div>
  )
}

/**
 * The icon button plus its popup.
 *
 * @param {object}   props
 * @param {string}   props.activeThreadId  the conversation on screen right now
 * @param {Function} props.onOpen          (threadId, turns) => void
 * @param {Function} props.onDeleteActive  called when the thread on screen is the one deleted
 * @param {Function} [props.onOpenChange]  told when the popup opens and closes
 *
 * `onOpenChange` exists for the drawer. The drawer closes itself on Escape
 * from a window listener and the Modal closes itself from a document one, so
 * with both mounted a single press would dismiss this popup AND the drawer
 * behind it. The drawer uses this to hold its own Escape while the popup has
 * it.
 */
export default function PastConversations({ activeThreadId, onOpen, onDeleteActive, onOpenChange }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [chats, setChats] = useState([])
  const [opening, setOpening] = useState('')

  // Fetched on open rather than on mount: this is a list nobody looks at most
  // sessions, and a query per page load to render nothing is a query wasted.
  const setOpenBoth = useCallback((next) => {
    setOpen(next)
    onOpenChange?.(next)
  }, [onOpenChange])

  const show = useCallback(async () => {
    setOpenBoth(true)
    setLoading(true)
    const rows = await fetchThreads(activeWorkspaceId, accessToken)
    setChats(rows)
    setLoading(false)
  }, [activeWorkspaceId, accessToken, setOpenBoth])

  const pick = useCallback(async (chat) => {
    if (chat.id === activeThreadId) { setOpenBoth(false); return }
    setOpening(chat.id)
    const turns = await fetchThreadTurns(chat.id, activeWorkspaceId, accessToken)
    setOpening('')
    setOpenBoth(false)
    onOpen(chat.id, turns)
  }, [activeThreadId, activeWorkspaceId, accessToken, onOpen, setOpenBoth])

  const rename = useCallback(async (chat, title) => {
    const ok = await renameThread(chat.id, activeWorkspaceId, accessToken, title)
    // Only shown once the store has taken it. An optimistic title that the
    // server rejected is a lie the list keeps telling until the next reload.
    if (ok) setChats(prev => prev.map(c => (c.id === chat.id ? { ...c, title } : c)))
  }, [activeWorkspaceId, accessToken])

  const remove = useCallback(async (chat) => {
    const ok = await deleteThread(chat.id, activeWorkspaceId, accessToken)
    if (!ok) return
    setChats(prev => prev.filter(c => c.id !== chat.id))
    // The conversation on screen cannot be left pointing at a thread that no
    // longer exists — the next question would be posted to a dead id and the
    // server would silently open a new thread under it.
    if (chat.id === activeThreadId) onDeleteActive?.()
  }, [activeWorkspaceId, accessToken, activeThreadId, onDeleteActive])

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

      <Modal open={open} onClose={() => setOpenBoth(false)} title="Earlier conversations">
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
                active={c.id === activeThreadId}
                opening={opening === c.id}
                busy={Boolean(opening)}
                onPick={pick}
                onRename={rename}
                onDelete={remove}
              />
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}
