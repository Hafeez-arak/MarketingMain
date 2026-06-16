import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../store/appStore'
import { Button } from '../ui/index'
import { timeAgo } from '../../lib/utils'

const titles = {
  '/': 'Dashboard', '/campaigns': 'Campaigns', '/campaigns/new': 'New Campaign',
  '/schedule': 'Content Calendar', '/email': 'Email Flows', '/email/new': 'New Email Flow',
  '/analytics': 'Analytics', '/media': 'Media Library', '/social': 'Social Media',
  '/social/instagram': 'Instagram', '/social/facebook': 'Facebook',
  '/social/linkedin': 'LinkedIn', '/social/tiktok': 'TikTok', '/social/x': 'X / Twitter',
  '/approvals': 'Approvals', '/settings': 'Settings', '/integrations': 'Integrations', '/team': 'Team',
}

export function Topbar() {
  const location = useLocation()
  const navigate  = useNavigate()
  const { state, dispatch } = useApp()
  const [showNotifs, setShowNotifs] = useState(false)

  const title  = titles[location.pathname] || 'Arak Content Studio'
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
      <div className="flex-1 min-w-0">
        <h1 className="font-display font-semibold text-text text-lg leading-none">{title}</h1>
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
            <div className="absolute right-0 top-full mt-2 w-76 bg-white rounded-2xl border border-border shadow-dropdown z-50 animate-fade-scale">
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
      </div>
    </header>
  )
}
function Plus() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
}
