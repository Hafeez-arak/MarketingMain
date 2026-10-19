import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button } from '../../components/ui/index'
import { useInbox } from '../../lib/useInbox'
import { timeAgo } from '../../lib/utils'
import { ArakMark } from '../../components/layout/ArakMark'

// ─── The sales team's frame: a bar across the top, two pages down the side ──
// Since 2026-10-19 the sales app is two pages, not one: Leads (the Inbox and
// Pipeline, pages/leads/SalesApp.jsx) and Research (the weekly research in
// its Sales view, read only, pages/leads/SalesResearch.jsx). The bar is what
// it was: the company, the bell, Sign out.
//
// The page scrolls inside <main>, not the window, like the marketing app:
// the research's "On this page" rail is sticky to the top of its scroller,
// and under a sticky bar it would slide behind it.

const NAV = [
  { to: '/leads', label: 'Leads', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg> },
  { to: '/research', label: 'Research', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg> },
]

function CompanyPicker({ workspaces, activeWorkspaceId, onChange }) {
  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  if (workspaces.length < 2) {
    return <span className="text-xs font-semibold text-text truncate">{active?.name}</span>
  }
  return (
    <select
      aria-label="Company"
      value={activeWorkspaceId || ''}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs font-semibold text-text bg-white border border-border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400 max-w-[12rem]"
    >
      {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  )
}

/**
 * The bell (2026-10-19): the same saved notifications as the marketing
 * app's, here so a salesperson hears that a lead was given to them.
 * Opening one goes to that lead in the Pipeline.
 */
function Bell({ userId, onOpenLead }) {
  const inbox = useInbox(userId)
  const [open, setOpen] = useState(false)
  function go(n) {
    inbox.read([n.id])
    setOpen(false)
    const lead = new URLSearchParams(String(n.link || '').split('?')[1] || '').get('lead')
    if (lead) onOpenLead(lead, n.workspace_id)
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={inbox.unread ? `Notifications, ${inbox.unread} new` : 'Notifications'}
        className="relative w-8 h-8 flex items-center justify-center text-text-secondary hover:bg-surface-subtle border border-border transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {inbox.unread > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-700 border-2 border-white" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-2rem)] bg-white border border-border shadow-dropdown z-50 animate-fade-scale">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-subtle">
            <p className="eyebrow">Notifications</p>
            {inbox.unread > 0 && <button type="button" onClick={() => inbox.read()} className="text-[11px] text-text-tertiary hover:text-text">Mark all read</button>}
          </div>
          {!inbox.items.length ? (
            <p className="py-8 text-center text-xs text-text-tertiary">All caught up</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-border">
              {inbox.items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => go(n)}
                    className={`w-full text-left flex items-start gap-2.5 px-4 py-3 hover:bg-surface-subtle transition-colors ${n.read_at ? '' : 'bg-amber-50/50'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-amber-700'}`} />
                    <span className="flex-1 min-w-0">
                      <span className={`block text-xs leading-relaxed ${n.read_at ? 'text-text-secondary' : 'text-text font-medium'}`} dir="auto">{n.title}</span>
                      {n.body && <span className="block text-[11px] text-text-tertiary leading-relaxed mt-0.5 line-clamp-2" dir="auto">{n.body}</span>}
                      <span className="block text-[10px] text-text-tertiary mt-1">{timeAgo(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// Same marker as the marketing sidebar: the transparent left border on every
// item keeps the labels from shifting when one lights up.
const navClass = ({ isActive }) => `flex items-center gap-2.5 pl-[18px] pr-4 py-1.5 text-[13px] w-full border-l-2 border-transparent transition-colors duration-150 ${
  isActive ? 'nav-active' : 'text-text-secondary hover:bg-surface-subtle hover:text-text'}`

// On a phone the side becomes a row under the bar.
const tabClass = ({ isActive }) => `flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] border-b-2 transition-colors ${
  isActive ? 'border-amber-700 text-text font-semibold' : 'border-transparent text-text-secondary'}`

/**
 * `onOpenLead` lets the Leads page open a lead from the bell in place. On any
 * other page the bell goes to the lead's address, and the Leads page opens it
 * from there.
 */
export default function SalesShell({ children, onOpenLead }) {
  const { user, workspaces, activeWorkspaceId, switchWorkspace, signOut } = useAuth()
  const navigate = useNavigate()
  function openLead(id, ws) {
    if (onOpenLead) { onOpenLead(id, ws); return }
    if (ws && ws !== activeWorkspaceId && workspaces.some((w) => w.id === ws)) switchWorkspace(ws)
    navigate(`/leads?lead=${encodeURIComponent(id)}`)
  }

  return (
    <div className="h-screen flex flex-col bg-surface-muted">
      <header className="h-14 flex-shrink-0 bg-white border-b border-border">
        <div className="h-full px-4 md:px-5 flex items-center gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <ArakMark size="w-8 h-8" />
            <div className="min-w-0">
              <p className="font-semibold text-text text-sm leading-none tracking-tight">Arak</p>
              <p className="eyebrow text-text-tertiary mt-1">Sales</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <Bell userId={user?.id} onOpenLead={openLead} />
            <CompanyPicker workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onChange={switchWorkspace} />
            <span className="hidden md:inline text-[11px] text-text-tertiary truncate max-w-[14rem]">{user?.email}</span>
            <Button size="xs" variant="ghost" onClick={() => signOut()}>Sign out</Button>
          </div>
        </div>
      </header>

      <nav aria-label="Sales" className="md:hidden flex-shrink-0 flex bg-white border-b border-border">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className={tabClass}>{item.icon}{item.label}</NavLink>
        ))}
      </nav>

      <div className="flex-1 min-h-0 flex">
        <nav aria-label="Sales" className="hidden md:block w-48 flex-shrink-0 bg-white border-r border-border py-3">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">{children}</div>
        </main>
      </div>
    </div>
  )
}
