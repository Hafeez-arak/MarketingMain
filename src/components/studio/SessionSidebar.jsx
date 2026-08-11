import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Spinner, ConfirmDialog } from '../ui/index'
import { aspectLabel } from '../../lib/postFormats'

// ─── The session rail ───────────────────────────────────────────────────────
// A plain vertical list of buttons read as a form, not a chat history — no
// grouping, no way to tell a five-minute-old thread from a three-week-old
// one, and no way to fix a bad title or clear out junk without leaving the
// page. This reworks it into the pattern every chat product actually uses:
// grouped by recency, a title you can fix in place, a way to remove one, and
// a collapse to a thin rail when the canvas needs the width more than the list does.

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']

function groupFor(dateStr) {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return 'Older'
  const startOfDay = dt => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days <= 7) return 'Previous 7 days'
  if (days <= 30) return 'Previous 30 days'
  return 'Older'
}

const COLLAPSE_KEY = 'studio.sidebarCollapsed'

export function SessionSidebar({ sessions, session, loading, onOpen, onNew, onRename, onDelete }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })
  const [menuFor, setMenuFor] = useState(null)      // session id whose ⋯ menu is open
  const [menuPos, setMenuPos] = useState(null)      // {top, left} in viewport coords, for the portal below
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const renameRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch { /* best effort */ }
  }, [collapsed])

  useEffect(() => {
    if (renamingId && renameRef.current) { renameRef.current.focus(); renameRef.current.select() }
  }, [renamingId])

  const groups = useMemo(() => {
    const m = new Map()
    for (const s of sessions) {
      const label = groupFor(s.updated_at || s.created_at)
      if (!m.has(label)) m.set(label, [])
      m.get(label).push(s)
    }
    return GROUP_ORDER.filter(g => m.has(g)).map(g => [g, m.get(g)])
  }, [sessions])

  function closeMenu() { setMenuFor(null); setMenuPos(null) }

  function toggleMenu(e, s) {
    e.stopPropagation()
    if (menuFor === s.id) { closeMenu(); return }
    // Positioned from the button's own screen coordinates and rendered
    // through a portal (below) rather than absolutely inside the row — the
    // row sits inside an overflow-y-auto list, which clips anything absolute
    // that would open outside its bounds. The last few rows in the list had
    // no room below them, so Rename/Delete were rendering off-screen/clipped.
    const r = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 4, left: r.right - 128 })
    setMenuFor(s.id)
  }

  function startRename(s) {
    closeMenu(); setRenamingId(s.id); setRenameValue(s.title || '')
  }
  function commitRename(s) {
    const next = renameValue.trim()
    setRenamingId(null)
    if (next && next !== s.title) onRename(s, next)
  }

  const menuSession = menuFor ? sessions.find(s => s.id === menuFor) : null

  // ── Collapsed: a thin icon rail, not a squeezed copy of the full list ──
  if (collapsed) {
    return (
      <aside className="flex flex-col items-center gap-2 w-12 flex-shrink-0 border-r border-border pt-1">
        <button type="button" onClick={() => setCollapsed(false)} title="Expand chat list"
          className="w-8 h-8 flex items-center justify-center border border-border text-text-tertiary hover:text-text hover:border-stone-300 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
        </button>
        <button type="button" onClick={onNew} title="New chat"
          className="w-8 h-8 flex items-center justify-center border border-border text-text-secondary hover:text-amber-700 hover:border-amber-400 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col">
      <div className="flex items-center gap-1.5 px-1 pb-2 mb-2 border-b border-border">
        <button type="button" onClick={onNew}
          className="flex-1 inline-flex items-center gap-1.5 text-left px-2.5 py-1.5 border border-border text-xs font-semibold text-text hover:border-amber-400 hover:bg-amber-50 transition-colors">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          New chat
        </button>
        <button type="button" onClick={() => setCollapsed(true)} title="Collapse"
          className="w-7 h-7 flex-shrink-0 flex items-center justify-center border border-border text-text-tertiary hover:text-text hover:border-stone-300 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>
        </button>
      </div>

      {loading ? (
        <div className="py-6 flex justify-center"><Spinner /></div>
      ) : sessions.length === 0 ? (
        <p className="text-[11px] text-text-tertiary px-1">Nothing yet.</p>
      ) : (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1" onScroll={closeMenu}>
          {groups.map(([label, rows]) => (
            <div key={label}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary px-2 mb-1">{label}</p>
              <div>
                {rows.map(s => (
                  <div key={s.id}
                    className={`group relative border-l-2 pl-2.5 pr-1.5 py-1.5 transition-colors ${
                      session?.id === s.id ? 'border-l-amber-500 bg-amber-50/70' : 'border-l-transparent hover:bg-surface-subtle'
                    }`}>
                    {renamingId === s.id ? (
                      <input
                        ref={renameRef}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(s)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitRename(s) }
                          if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null) }
                        }}
                        className="w-full text-xs font-medium bg-white border-b border-amber-400 px-0.5 py-0.5 focus:outline-none"
                      />
                    ) : (
                      <button onClick={() => onOpen(s)} className="w-full text-left pr-6">
                        <p className="text-xs font-medium text-text line-clamp-1 leading-snug">{s.title || 'Untitled'}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">
                          {s.intent === 'video' ? 'Video' : s.intent === 'image_video' ? 'Image + video' : 'Image'} · {aspectLabel(s.aspect_ratio)}
                        </p>
                      </button>
                    )}

                    {renamingId !== s.id && (
                      <button type="button" onClick={e => toggleMenu(e, s)}
                        title="More"
                        className="absolute top-1.5 right-1 w-5 h-5 flex items-center justify-center text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text transition-opacity">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="6" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Portalled to <body> so a row near the bottom of the scrollable list
          can still open its menu fully visible, instead of being clipped by
          the list's overflow-y-auto. */}
      {menuSession && menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} />
          <div className="fixed z-50 w-32 border border-border bg-white shadow-dropdown"
            style={{ top: menuPos.top, left: Math.max(4, menuPos.left) }}>
            <button type="button" onClick={() => startRename(menuSession)}
              className="w-full text-left px-2.5 py-1.5 text-[11px] font-medium text-text hover:bg-surface-subtle">
              Rename
            </button>
            <button type="button" onClick={() => { closeMenu(); setDeleteTarget(menuSession) }}
              className="w-full text-left px-2.5 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50">
              Delete
            </button>
          </div>
        </>,
        document.body,
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => onDelete(deleteTarget)}
        title="Delete this chat?"
        message={`"${deleteTarget?.title || 'Untitled'}" and every image or video in it will be permanently deleted. This can't be undone.`}
        danger
      />
    </aside>
  )
}
