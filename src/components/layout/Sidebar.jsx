import { NavLink } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { useState, useEffect } from 'react'
import { fetchPendingCount } from '../../lib/access'

const nav = [
  { section: 'Overview', items: [
    { to: '/', label: 'Dashboard', exact: true, icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg> },
  ]},
  { section: 'Brand', items: [
    { to: '/brand-brain', label: 'Brand Brain', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9.5 2A3.5 3.5 0 0 0 6 5.5v.5a3 3 0 0 0-2 2.83V10a3 3 0 0 0 1 2.24V14a3 3 0 0 0 2.5 2.96V18a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3v-1.04A3 3 0 0 0 19 14v-1.76A3 3 0 0 0 20 10V8.83a3 3 0 0 0-2-2.83v-.5A3.5 3.5 0 0 0 14.5 2 3.5 3.5 0 0 0 12 3.17 3.5 3.5 0 0 0 9.5 2z"/></svg> },
  ]},
  { section: 'Marketing', items: [
    { to: '/studio',     label: 'Creative Studio', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg> },
    { to: '/campaigns',  label: 'Content Generation',   icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
    { to: '/schedule',   label: 'Schedule',    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
    { to: '/email',      label: 'Email Flows', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
  ]},
  { section: 'Social', items: [
    { to: '/social',           label: 'Social Media',   icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> },
    { to: '/social/approvals', label: 'Post Approvals', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  ]},
  { section: 'Insights', items: [
    { to: '/analytics', label: 'Analytics', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  ]},
  { section: 'Assets', items: [
    { to: '/media',     label: 'Media Library', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
  ]},
  { section: 'Settings', items: [
    { to: '/settings',     label: 'Settings',     icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
    { to: '/integrations', label: 'Integrations', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg> },
    { to: '/team',         label: 'Team & Access', badge: 'pendingAccess', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  ]},
]

export function Sidebar() {
  const { user, workspaces, activeWorkspace, activeWorkspaceId, switchWorkspace, signOut, isAccessAdmin } = useAuth()
  const [showWsPicker, setShowWsPicker] = useState(false)
  // The only notification the access gate has: a count on the nav item.
  // Requests otherwise sit unseen until someone thinks to look, and a
  // teammate blocked on approval has no way to nudge from inside the app.
  // Admin-only — for everyone else there is nothing to act on.
  const [pendingAccess, setPendingAccess] = useState(0)
  useEffect(() => {
    if (!isAccessAdmin) return
    let cancelled = false
    fetchPendingCount().then(n => { if (!cancelled) setPendingAccess(n) })
    return () => { cancelled = true }
  }, [isAccessAdmin])
  // Gated at render rather than by resetting the count when isAccessAdmin
  // flips: a stale number from a previous session can then never leak into
  // a non-admin's sidebar, and the effect stays free of a synchronous
  // setState (which React's lint rule rightly flags as a cascading render).
  const badges = { pendingAccess: isAccessAdmin ? pendingAccess : 0 }

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col h-full overflow-hidden bg-white border-r border-border">

      {/* Logo. Fixed to h-14 — the same height as the Topbar — so the sidebar's
          header rule and the topbar's rule form one unbroken horizontal line
          across the whole window. In a layout this dependent on rules, a 16px
          step between two adjacent ones is the first thing you notice. */}
      <div className="h-14 flex-shrink-0 px-4 flex items-center border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* The one surviving gradient in the app. It's the brand mark, so it
              gets to be the single place with any depth to it. */}
          <div className="w-8 h-8 bg-logo-mark flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text text-sm leading-none tracking-tight">Arak</p>
            <p className="eyebrow text-text-tertiary mt-1">Content Studio</p>
          </div>
        </div>
      </div>

      {/* Workspace chip */}
      <div className="px-4 py-3 border-b border-border relative">
        <button
          onClick={() => setShowWsPicker(v => !v)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 border border-border bg-white hover:border-stone-400 hover:bg-surface-subtle transition-colors group">
          <div className="w-5 h-5 bg-amber-700 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
            {(activeWorkspace?.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-xs font-semibold text-text truncate">{activeWorkspace?.name || 'Workspace'}</p>
            <p className="text-[10px] text-text-tertiary">Workspace</p>
          </div>
          <svg className={`w-3 h-3 text-text-tertiary transition-transform flex-shrink-0 ${showWsPicker ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        {/* Workspace picker dropdown — only shows a "switch" list when the
            signed-in user actually belongs to more than one workspace. */}
        {showWsPicker && (
          <div className="absolute left-4 right-4 top-full -mt-px bg-white border border-border shadow-dropdown z-50 animate-fade-scale">
            {workspaces.length > 1 && (
              <>
                <div className="px-3 py-2 border-b border-border bg-surface-subtle">
                  <p className="eyebrow text-text-tertiary">Switch workspace</p>
                </div>
                <ul className="max-h-48 overflow-y-auto scrollbar-thin divide-y divide-border">
                  {workspaces.map(ws => (
                    <li key={ws.id}>
                      <button
                        onClick={() => {
                          if (ws.id !== activeWorkspaceId) switchWorkspace(ws.id)
                          setShowWsPicker(false)
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-subtle
                          ${ws.id === activeWorkspaceId ? 'bg-amber-50' : ''}`}>
                        <div className={`w-5 h-5 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0
                          ${ws.id === activeWorkspaceId ? 'bg-amber-700' : 'bg-stone-500'}`}>
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="flex-1 text-xs text-text truncate">{ws.name}</span>
                        {ws.id === activeWorkspaceId && (
                          <svg className="w-3 h-3 text-amber-700 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className={workspaces.length > 1 ? 'border-t border-border' : ''}>
              <button
                onClick={() => { setShowWsPicker(false); signOut() }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nav — items run full-bleed to both edges so the active marker bar sits
          flush against the sidebar's own border. Inset nav pills would put the
          marker in the middle of a gutter, floating. */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3">
        {nav.map((group, gi) => (
          <div key={group.section} className={gi > 0 ? 'mt-5' : ''}>
            <p className="px-5 mb-1.5 eyebrow text-text-disabled">{group.section}</p>
            {group.items.map(item => (
              <NavLink key={item.to} to={item.to} end={item.exact}
                /* border-l-2 border-transparent on the base state reserves the
                   marker's column on EVERY item, so activating one doesn't
                   nudge its label 2px right of its neighbours. */
                className={({ isActive }) => `
                  flex items-center gap-2.5 pl-[18px] pr-4 py-1.5 text-[13px] w-full
                  border-l-2 border-transparent transition-colors duration-150
                  ${item.sub ? 'pl-7 text-xs' : ''}
                  ${isActive ? 'nav-active' : 'text-text-secondary hover:bg-surface-subtle hover:text-text'}`}>
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && badges[item.badge] > 0 && (
                  <span className="flex-shrink-0 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-amber-700">
                    {badges[item.badge]}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-stone-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
            {(user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text truncate">{user?.email || 'Signed out'}</p>
            {/* Was the workspace_members role, which is now the same string
                for everyone and told you nothing. The only distinction that
                exists is who can change the access list. */}
            <p className="text-[10px] text-text-tertiary">{isAccessAdmin ? 'Access admin' : 'Team member'}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
