import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { timeAgo } from '../../lib/utils'
import { useInbox } from '../../lib/useInbox'
import { pageTitle } from '../../lib/modules'

// Sub-pages reached via a flow (not a direct link in the sidebar) get a back
// button pointed at their logical parent: more reliable than browser history,
// which breaks if the page was opened directly or refreshed mid-flow. The
// title itself comes from the section registry (lib/modules.js).
const BACK_TARGETS = {
  '/marketing/campaigns/plan': '/marketing/campaigns',
}

export function Topbar({ navOpen = false, onMenu, menuHidden = null, onToggleMenu }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const { state, dispatch } = useApp()
  const { activeWorkspace, signOut, user, workspaces, activeWorkspaceId, switchWorkspace } = useAuth()
  // Saved notifications (requests, tags, comments) from the database, on top
  // of the in-memory ones the publish watcher still raises.
  const inbox = useInbox(user?.id)
  const [showNotifs, setShowNotifs] = useState(false)
  const [showAccount, setShowAccount] = useState(false)

  const title      = pageTitle(location.pathname) || 'Arak'
  const backTarget = BACK_TARGETS[location.pathname]
  const unread = state.notifications.filter(n => !n.read).length + inbox.unread
  const total = state.notifications.length + inbox.items.length

  function openSaved(n) {
    inbox.read([n.id])
    setShowNotifs(false)
    // A notification from another company switches to it first, or the
    // request would open on a board that cannot see it.
    if (n.workspace_id && n.workspace_id !== activeWorkspaceId && workspaces.some(w => w.id === n.workspace_id)) {
      switchWorkspace(n.workspace_id)
    }
    if (n.link) navigate(n.link)
  }

  return (
    <header
      data-print-hide
      className="h-14 bg-white border-b border-border flex items-center pl-3 pr-3 gap-2 md:pl-5 md:pr-4 md:gap-4 flex-shrink-0"
    >
      <div className="flex-1 min-w-0 flex items-center gap-3">
        {/* The sidebar is a drawer below md; this opens it. */}
        {onMenu && (
          <button id="nav-toggle" type="button" onClick={onMenu} aria-label="Menu" aria-controls="app-sidebar" aria-expanded={navOpen}
            className="md:hidden w-8 h-8 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:border-stone-400 border border-border transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        )}
        {/* Show / hide the section menu (desktop). Only where there is one. */}
        {menuHidden !== null && onToggleMenu && (
          <button type="button" onClick={onToggleMenu} title={`${menuHidden ? 'Show' : 'Hide'} menu (Ctrl+B)`}
            aria-label={menuHidden ? 'Show menu' : 'Hide menu'} aria-pressed={!menuHidden}
            className="hidden md:flex w-7 h-7 rounded-md items-center justify-center text-text-tertiary hover:bg-stone-100 hover:text-text flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>
          </button>
        )}
        {backTarget && (
          <button onClick={() => navigate(backTarget)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:text-text hover:border-stone-400 border border-border transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        {/* Was 18px serif. The page title now matches the weight of the page's
            own H1 rather than competing with it — the topbar labels where you
            are, it isn't a second headline. */}
        <h1 className="font-semibold text-text text-sm leading-none truncate tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Date. No border or fill — it's ambient information, and boxing it
            gave it the same visual weight as the two real controls beside it. */}
        <div className="hidden lg:flex items-center gap-1.5 pr-1 text-xs text-text-tertiary tabular-nums">
          {new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => setShowNotifs(v => !v)}
            className="relative w-8 h-8 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:border-stone-400 border border-border transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {/* Stays a circle: a 6px square in the corner of a square button
                reads as a rendering artifact, not a badge. */}
            {unread > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-700 border-2 border-white" />}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-1.5rem)] bg-white border border-border shadow-dropdown z-50 animate-fade-scale">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-subtle">
                <p className="eyebrow">Notifications</p>
                {total > 0 && (
                  <button onClick={() => { inbox.read(); dispatch({type:'CLEAR_NOTIFICATIONS'}) }} className="text-[11px] text-text-tertiary hover:text-text transition-colors">Mark all read</button>
                )}
              </div>
              {total === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-text-tertiary">All caught up</p>
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto scrollbar-thin divide-y divide-border">
                  {inbox.items.map(n => (
                    <li key={n.id}>
                      <button onClick={() => openSaved(n)}
                        className={`w-full text-left flex items-start gap-2.5 px-4 py-3 hover:bg-surface-subtle transition-colors ${n.read_at ? '' : 'bg-amber-50/50'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-amber-700'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-relaxed ${n.read_at ? 'text-text-secondary' : 'text-text font-medium'}`}>{n.title}</p>
                          {n.body && <p className="text-[11px] text-text-tertiary leading-relaxed mt-0.5 line-clamp-2">{n.body}</p>}
                          <p className="text-[10px] text-text-tertiary mt-1">{timeAgo(n.created_at)}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                  {state.notifications.map(n => (
                    <li key={n.id} className="flex items-start gap-2.5 px-4 py-3 hover:bg-surface-subtle transition-colors">
                      <div className="w-1 h-1 rounded-full bg-amber-700 mt-2 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text leading-relaxed">{n.message}</p>
                        <p className="text-[10px] text-text-tertiary mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Workspace + sign out */}
        <div className="relative">
          <button onClick={() => setShowAccount(v => !v)}
            className="flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-md border border-border hover:bg-surface-subtle hover:border-stone-400 transition-colors">
            <div className="w-6 h-6 rounded bg-amber-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {(activeWorkspace?.name || '?').slice(0, 1).toUpperCase()}
            </div>
            <span className="hidden sm:inline text-xs font-medium text-text max-w-[120px] truncate">{activeWorkspace?.name || 'Workspace'}</span>
          </button>
          {showAccount && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-border shadow-dropdown z-50 animate-fade-scale">
              <div className="px-4 py-3 border-b border-border bg-surface-subtle">
                <p className="eyebrow text-text-tertiary">Workspace</p>
                <p className="text-sm font-semibold text-text truncate mt-1">{activeWorkspace?.name}</p>
                <p className="text-[11px] text-text-tertiary capitalize mt-0.5">{activeWorkspace?.role}</p>
              </div>
              <button onClick={signOut}
                className="w-full text-left px-4 py-2.5 text-xs text-red-600 hover:bg-red-50 transition-colors">
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
