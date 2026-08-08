import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
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
  '/settings': 'Settings', '/integrations': 'Integrations', '/team': 'Team',
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
    if (p.startsWith('/social/') && p !== '/social') return <Button size="sm" onClick={() => navigate('/social/instagram')}><Plus/>New Post</Button>
    return null
  }

  return (
    <header className="h-14 bg-white border-b border-border flex items-center px-6 gap-4 flex-shrink-0">
      <div className="flex-1 min-w-0 flex items-center gap-3">
        {backTarget && (
          <button onClick={() => navigate(backTarget)}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:text-text border border-border transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <h1 className="font-display font-semibold text-text text-lg leading-none truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {getCta()}

        {/* Date pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-subtle border border-border text-xs text-text-secondary">
          <svg className="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          {new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => setShowNotifs(v => !v)}
            className="relative w-8 h-8 rounded-xl flex items-center justify-center text-text-secondary hover:bg-surface-subtle border border-border transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unread > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-clay-500 animate-pulse-dot" />}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl border border-border shadow-dropdown z-50 animate-fade-scale">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                <p className="font-semibold text-sm text-text">Notifications</p>
                {state.notifications.length > 0 && (
                  <button onClick={() => dispatch({type:'CLEAR_NOTIFICATIONS'})} className="text-xs text-text-tertiary hover:text-clay-600 transition-colors">Clear all</button>
                )}
              </div>
              {state.notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-text-tertiary">All caught up ✓</p>
                </div>
              ) : (
                <ul className="py-1 max-h-72 overflow-y-auto scrollbar-thin">
                  {state.notifications.map(n => (
                    <li key={n.id} className="flex items-start gap-3 px-5 py-3 hover:bg-surface-muted transition-colors">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text leading-relaxed">{n.message}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">{timeAgo(n.createdAt)}</p>
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
            className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-xl border border-border hover:bg-surface-subtle transition-colors">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#7D98A1,#5E6572)' }}>
              {(activeWorkspace?.name || '?').slice(0, 1).toUpperCase()}
            </div>
            <span className="text-xs font-semibold text-text max-w-[120px] truncate">{activeWorkspace?.name || 'Workspace'}</span>
          </button>
          {showAccount && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl border border-border shadow-dropdown z-50 animate-fade-scale py-1.5">
              <div className="px-4 py-2 border-b border-border mb-1">
                <p className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">Workspace</p>
                <p className="text-sm font-semibold text-text truncate">{activeWorkspace?.name}</p>
                <p className="text-[11px] text-text-tertiary capitalize">{activeWorkspace?.role} · {activeWorkspace?.plan} plan</p>
              </div>
              <button onClick={signOut}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
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
