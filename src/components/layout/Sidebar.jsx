import { NavLink } from 'react-router-dom'
import { useApp } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { useState } from 'react'

const nav = [
  { section: 'Overview', items: [
    { to: '/', label: 'Dashboard', exact: true, icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg> },
  ]},
  { section: 'Brand', items: [
    { to: '/brand-brain', label: 'Brand Brain', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9.5 2A3.5 3.5 0 0 0 6 5.5v.5a3 3 0 0 0-2 2.83V10a3 3 0 0 0 1 2.24V14a3 3 0 0 0 2.5 2.96V18a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3v-1.04A3 3 0 0 0 19 14v-1.76A3 3 0 0 0 20 10V8.83a3 3 0 0 0-2-2.83v-.5A3.5 3.5 0 0 0 14.5 2 3.5 3.5 0 0 0 12 3.17 3.5 3.5 0 0 0 9.5 2z"/></svg> },
  ]},
  { section: 'Marketing', items: [
    { to: '/campaigns',  label: 'Campaigns',   icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
    { to: '/schedule',   label: 'Schedule',    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
    { to: '/email',      label: 'Email Flows', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
  ]},
  { section: 'Social', items: [
    { to: '/social',           label: 'Social Media',   icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> },
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
  const { state } = useApp()
  const { user, workspaces, activeWorkspace, activeWorkspaceId, switchWorkspace, signOut } = useAuth()
  const [showWsPicker, setShowWsPicker] = useState(false)
  const pendingApprovals = state.approvals.filter(a => a.status === 'pending').length

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col h-full overflow-hidden bg-white border-r border-border">

      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #ffbc38 0%, #d4850a 100%)' }}>
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
            {(activeWorkspace?.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-xs font-semibold text-text truncate">{activeWorkspace?.name || 'Workspace'}</p>
            <p className="text-[10px] text-text-tertiary capitalize">{activeWorkspace?.plan || ''} plan</p>
          </div>
          <svg className={`w-3 h-3 text-text-tertiary transition-transform flex-shrink-0 ${showWsPicker ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        {/* Workspace picker dropdown — only shows a "switch" list when the
            signed-in user actually belongs to more than one workspace. */}
        {showWsPicker && (
          <div className="absolute left-4 right-4 top-full mt-1 bg-white rounded-xl border border-border shadow-dropdown z-50 animate-fade-scale overflow-hidden">
            {workspaces.length > 1 && (
              <>
                <div className="px-3 py-2 border-b border-border/50">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-disabled">Switch Workspace</p>
                </div>
                <ul className="py-1 max-h-48 overflow-y-auto scrollbar-thin">
                  {workspaces.map(ws => (
                    <li key={ws.id}>
                      <button
                        onClick={() => {
                          if (ws.id !== activeWorkspaceId) switchWorkspace(ws.id)
                          setShowWsPicker(false)
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-subtle
                          ${ws.id === activeWorkspaceId ? 'bg-amber-50/60' : ''}`}>
                        <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                          style={{ background: ws.id === activeWorkspaceId ? 'linear-gradient(135deg,#ffbc38,#d4850a)' : 'linear-gradient(135deg,#c4b090,#8a7050)' }}>
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="flex-1 text-xs text-text truncate">{ws.name}</span>
                        {ws.id === activeWorkspaceId && (
                          <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className={workspaces.length > 1 ? 'border-t border-border/50 p-2' : 'p-2'}>
              <button
                onClick={() => { setShowWsPicker(false); signOut() }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign out
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
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f5a200, #d4850a)' }}>
            {(user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text truncate">{user?.email || 'Signed out'}</p>
            <p className="text-[10px] text-text-tertiary capitalize">{activeWorkspace?.role || ''}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
