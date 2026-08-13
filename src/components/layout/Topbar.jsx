import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Button } from '../ui/index'
import { timeAgo } from '../../lib/utils'

const titles = {
  '/': 'Dashboard', '/brand-brain': 'Brand Brain', '/campaigns': 'Campaigns', '/campaigns/plan': 'Plan Campaign', '/campaigns/new': 'New Campaign',
  '/schedule': 'Content Calendar', '/email': 'Email Flows', '/email/new': 'New Email Flow',
  '/analytics': 'Analytics', '/media': 'Media Library', '/social': 'Social Media',
  '/social/instagram': 'Instagram',
  '/social/linkedin': 'LinkedIn', '/social/tiktok': 'TikTok',
  '/social/instagram/new': 'New Instagram Post',
  '/social/linkedin/new': 'New LinkedIn Post', '/social/tiktok/new': 'New TikTok Post',
  '/settings': 'Settings', '/integrations': 'Integrations', '/team': 'Team & Access',
}

// Sub-pages reached via a flow (not a direct sidebar link) get a back button
// pointed at their logical parent — more reliable than browser history,
// which breaks if the page was opened directly or refreshed mid-flow.
const BACK_TARGETS = {
  '/campaigns/new':        '/campaigns',
  '/campaigns/plan':       '/campaigns',
  '/email/new':            '/email',
  '/social/instagram/new': '/social/instagram',
  '/social/linkedin/new':  '/social/linkedin',
  '/social/tiktok/new':    '/social/tiktok',
}

export function Topbar() {
  const location = useLocation()
  const navigate  = useNavigate()
  const { state, dispatch } = useApp()
  const { activeWorkspace, signOut } = useAuth()
  const [showNotifs, setShowNotifs] = useState(false)
  const [showAccount, setShowAccount] = useState(false)

  const isPostEditor = location.pathname.startsWith('/campaigns/plan/post/')
  const title      = isPostEditor ? 'Edit Post' : (titles[location.pathname] || 'Arak Content Studio')
  const backTarget = isPostEditor ? '/campaigns/plan' : BACK_TARGETS[location.pathname]
  const unread = state.notifications.filter(n => !n.read).length

  function getCta() {
    const p = location.pathname
    if (p === '/campaigns') return <Button size="sm" onClick={() => navigate('/campaigns/new')}><Plus/>New Campaign</Button>
    if (p === '/email')     return <Button size="sm" onClick={() => navigate('/email/new')}><Plus/>New Flow</Button>
    // Instagram and LinkedIn have their own "Create Post" flow built into
    // the page now (real generation, not a placeholder) — this global
    // shortcut duplicated it, and worse, always routed to /social/instagram
    // regardless of which platform page you were actually on. Other social
    // pages (no real create flow yet) still get a shortcut, fixed to route
    // to THEIR OWN /new page instead of the hardcoded Instagram one.
    const platformMatch = p.match(/^\/social\/([a-z]+)$/)
    if (platformMatch && !['instagram', 'linkedin'].includes(platformMatch[1])) {
      return <Button size="sm" onClick={() => navigate(`/social/${platformMatch[1]}/new`)}><Plus/>New Post</Button>
    }
    return null
  }

  return (
    <header className="h-14 bg-white border-b border-border flex items-center pl-5 pr-4 gap-4 flex-shrink-0">
      <div className="flex-1 min-w-0 flex items-center gap-3">
        {backTarget && (
          <button onClick={() => navigate(backTarget)}
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:text-text hover:border-stone-400 border border-border transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        {/* Was 18px serif. The page title now matches the weight of the page's
            own H1 rather than competing with it — the topbar labels where you
            are, it isn't a second headline. */}
        <h1 className="font-semibold text-text text-sm leading-none truncate tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {getCta()}

        {/* Date. No border or fill — it's ambient information, and boxing it
            gave it the same visual weight as the two real controls beside it. */}
        <div className="hidden lg:flex items-center gap-1.5 pr-1 text-xs text-text-tertiary tabular-nums">
          {new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => setShowNotifs(v => !v)}
            className="relative w-8 h-8 flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:border-stone-400 border border-border transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {/* Stays a circle: a 6px square in the corner of a square button
                reads as a rendering artifact, not a badge. */}
            {unread > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-700 border-2 border-white" />}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-border shadow-dropdown z-50 animate-fade-scale">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-subtle">
                <p className="eyebrow">Notifications</p>
                {state.notifications.length > 0 && (
                  <button onClick={() => dispatch({type:'CLEAR_NOTIFICATIONS'})} className="text-[11px] text-text-tertiary hover:text-text transition-colors">Clear all</button>
                )}
              </div>
              {state.notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-text-tertiary">All caught up</p>
                </div>
              ) : (
                <ul className="max-h-72 overflow-y-auto scrollbar-thin divide-y divide-border">
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
            className="flex items-center gap-2 h-8 pl-1 pr-2.5 border border-border hover:bg-surface-subtle hover:border-stone-400 transition-colors">
            <div className="w-6 h-6 bg-amber-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {(activeWorkspace?.name || '?').slice(0, 1).toUpperCase()}
            </div>
            <span className="text-xs font-medium text-text max-w-[120px] truncate">{activeWorkspace?.name || 'Workspace'}</span>
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
function Plus() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
}
