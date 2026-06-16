import { NavLink, useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { useState } from 'react'

const nav = [
  { section: 'Overview', items: [
    { to: '/', label: 'Dashboard', exact: true, icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg> },
  ]},
  { section: 'Marketing', items: [
    { to: '/campaigns',  label: 'Campaigns',   icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
    { to: '/schedule',   label: 'Schedule',    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
    { to: '/email',      label: 'Email Flows', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
  ]},
  { section: 'Social', items: [
    { to: '/social',           label: 'Overview',   icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> },
    { to: '/social/instagram', label: 'Instagram', sub: true, dot: '#E1306C', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> },
    { to: '/social/facebook',  label: 'Facebook',  sub: true, dot: '#1877F2', icon: <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> },
    { to: '/social/linkedin',  label: 'LinkedIn',  sub: true, dot: '#0A66C2', icon: <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg> },
    { to: '/social/tiktok',    label: 'TikTok',    sub: true, dot: '#555', icon: <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.79 1.52V6.76a4.85 4.85 0 0 1-1.02-.07z"/></svg> },
    { to: '/social/x',         label: 'X / Twitter', sub: true, dot: '#333', icon: <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> },
  ]},
  { section: 'Insights', items: [
    { to: '/analytics', label: 'Analytics', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  ]},
  { section: 'Assets', items: [
    { to: '/media',     label: 'Media Library', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
    { to: '/approvals', label: 'Approvals', badge: 'approvals', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  ]},
  { section: 'Settings', items: [
    { to: '/settings',     label: 'Settings',     icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
    { to: '/integrations', label: 'Integrations', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg> },
    { to: '/team',         label: 'Team',         icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  ]},
]

export function Sidebar() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [showWsPicker, setShowWsPicker] = useState(false)
  const pendingApprovals = state.approvals.filter(a => a.status === 'pending').length
  const workspaces = state.workspaces || []
  const activeId   = state.activeWorkspaceId

  return (
    <aside className="w-58 flex-shrink-0 flex flex-col h-full overflow-hidden bg-white border-r border-border">

      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #ffbc38 0%, #d4850a 100%)' }}>
            <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
            </svg>
          </div>
          <div>
            <p className="font-display font-semibold text-text text-base leading-none">Arak</p>
            <p className="text-[10px] font-medium text-text-tertiary tracking-wider uppercase mt-0.5">Content Studio</p>
          </div>
        </div>
      </div>

      {/* Workspace chip */}
      <div className="px-4 py-3 border-b border-border/50 relative">
        <button
          onClick={() => setShowWsPicker(v => !v)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface-subtle hover:bg-stone-100 transition-colors group">
          <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f5a200, #d4850a)' }}>
            {state.workspace.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-xs font-semibold text-text truncate">{state.workspace.name}</p>
            <p className="text-[10px] text-text-tertiary">Content Studio</p>
          </div>
          <svg className={`w-3 h-3 text-text-tertiary transition-transform flex-shrink-0 ${showWsPicker ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        {/* Workspace picker dropdown */}
        {showWsPicker && (
          <div className="absolute left-4 right-4 top-full mt-1 bg-white rounded-xl border border-border shadow-dropdown z-50 animate-fade-scale overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-disabled">Switch Workspace</p>
            </div>
            <ul className="py-1 max-h-48 overflow-y-auto scrollbar-thin">
              {workspaces.map(ws => (
                <li key={ws.id}>
                  <button
                    onClick={() => {
                      if (ws.id !== activeId) dispatch(actions.switchWorkspace(ws.id))
                      setShowWsPicker(false)
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-subtle
                      ${ws.id === activeId ? 'bg-amber-50/60' : ''}`}>
                    <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                      style={{ background: ws.id === activeId ? 'linear-gradient(135deg,#ffbc38,#d4850a)' : 'linear-gradient(135deg,#c4b090,#8a7050)' }}>
                      {ws.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="flex-1 text-xs text-text truncate">{ws.name}</span>
                    {ws.id === activeId && (
                      <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-border/50 p-2">
              <button
                onClick={() => { setShowWsPicker(false); navigate('/settings') }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-surface-subtle hover:text-text transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                New workspace
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-3">
        {nav.map((group, gi) => (
          <div key={group.section} className={gi > 0 ? 'mt-4' : ''}>
            <p className="px-3 mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-text-disabled">{group.section}</p>
            {group.items.map(item => (
              <NavLink key={item.to} to={item.to} end={item.exact}
                className={({ isActive }) => `
                  flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-150 w-full mb-0.5
                  ${item.sub ? 'ml-2.5 py-1.5 text-xs' : ''}
                  ${isActive ? 'nav-active' : 'text-text-secondary hover:bg-surface-subtle hover:text-text'}`}>
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge === 'approvals' && pendingApprovals > 0 && (
                  <span className="ml-auto bg-clay-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0">
                    {pendingApprovals}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-surface-subtle cursor-pointer transition-colors">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f5a200, #d4850a)' }}>A</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text truncate">Admin</p>
            <p className="text-[10px] text-text-tertiary">Free plan</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
