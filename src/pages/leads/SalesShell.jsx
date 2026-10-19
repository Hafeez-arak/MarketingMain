import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button } from '../../components/ui/index'
import { useInbox } from '../../lib/useInbox'
import { useT, ago, setLang, fmtDay } from '../../lib/i18n'
import { LW } from './words'
import { ArakMark } from '../../components/layout/ArakMark'
import { useDueTaskCount } from './useDueTaskCount'

// ─── The sales team's frame: a bar across the top, two pages down the side ──
// Since 2026-10-19 the sales app is pages, not one: Leads (the Inbox and
// Pipeline, pages/leads/SalesApp.jsx), Tasks (v2: My tasks and I assigned,
// pages/leads/SalesTasks.jsx, at /leads?view=tasks since App.jsx gives the
// sales team /leads and /research only) and Research (the weekly research in
// its Sales view, read only, pages/leads/SalesResearch.jsx). The bar is what
// it was: the company, the bell, Sign out.
//
// The page scrolls inside <main>, not the window, like the marketing app:
// the research's "On this page" rail is sticky to the top of its scroller,
// and under a sticky bar it would slide behind it.

// `on` says which item lights up: Leads and Tasks share the /leads address.
const NAV = [
  { to: '/leads', on: (l) => l.pathname === '/leads' && !isTasks(l), key: 'leads', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg> },
  { to: '/leads?view=tasks', on: isTasks, key: 'tasks', badge: 'tasks', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  { to: '/research', on: (l) => l.pathname === '/research', key: 'research', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg> },
]

function isTasks(loc) {
  return loc.pathname === '/tasks' || (loc.pathname === '/leads' && new URLSearchParams(loc.search).get('view') === 'tasks')
}

function CompanyPicker({ workspaces, activeWorkspaceId, onChange }) {
  const { t } = useT(LW)
  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  if (workspaces.length < 2) {
    return <span className="text-xs font-semibold text-text truncate">{active?.name}</span>
  }
  return (
    <select
      aria-label={t.company}
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
 * Opening one goes to that lead in the Pipeline, or (v2) to that task.
 */
function Bell({ userId, onOpenLead, onOpenTask }) {
  const { t, lang } = useT(LW)
  const inbox = useInbox(userId)
  const [open, setOpen] = useState(false)
  function go(n) {
    inbox.read([n.id])
    setOpen(false)
    const [path, query] = String(n.link || '').split('?')
    const q = new URLSearchParams(query || '')
    if (path === '/tasks') { onOpenTask(q.get('id') || '', n.workspace_id); return }
    const lead = q.get('lead')
    if (lead) onOpenLead(lead, n.workspace_id)
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={inbox.unread ? t.notificationsNew(inbox.unread) : t.notifications}
        className="relative w-8 h-8 flex items-center justify-center text-text-secondary hover:bg-surface-subtle border border-border transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {inbox.unread > 0 && <span className="absolute -top-1 -end-1 w-2.5 h-2.5 rounded-full bg-amber-700 border-2 border-white" />}
      </button>
      {open && (
        <div className="absolute end-0 top-full mt-1 w-80 max-w-[calc(100vw-2rem)] bg-white border border-border shadow-dropdown z-50 animate-fade-scale">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-subtle">
            <p className="eyebrow">{t.notifications}</p>
            {inbox.unread > 0 && <button type="button" onClick={() => inbox.read()} className="text-[11px] text-text-tertiary hover:text-text">{t.markAllRead}</button>}
          </div>
          {!inbox.items.length ? (
            <p className="py-8 text-center text-xs text-text-tertiary">{t.allCaughtUp}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-border">
              {inbox.items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => go(n)}
                    className={`w-full text-start flex items-start gap-2.5 px-4 py-3 hover:bg-surface-subtle transition-colors ${n.read_at ? '' : 'bg-amber-50/50'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-amber-700'}`} />
                    <span className="flex-1 min-w-0">
                      <span className={`block text-xs leading-relaxed ${n.read_at ? 'text-text-secondary' : 'text-text font-medium'}`} dir="auto">{n.title}</span>
                      {n.body && <span className="block text-[11px] text-text-tertiary leading-relaxed mt-0.5 line-clamp-2" dir="auto">{n.body}</span>}
                      <span className="block text-[10px] text-text-tertiary mt-1">{ago(n.created_at, lang)}</span>
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
const navClass = (isActive) => `flex items-center gap-2.5 ps-[18px] pe-4 py-1.5 text-[13px] w-full border-s-2 border-transparent transition-colors duration-150 ${
  isActive ? 'nav-active' : 'text-text-secondary hover:bg-surface-subtle hover:text-text'}`

// On a phone the side becomes a row under the bar.
const tabClass = (isActive) => `flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] border-b-2 transition-colors ${
  isActive ? 'border-amber-700 text-text font-semibold' : 'border-transparent text-text-secondary'}`

/** Open tasks due today or late: the number beside Tasks. */
function Count({ n }) {
  const { t } = useT(LW)
  return (
    <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-semibold tabular-nums text-white bg-stone-900"
      title={t.dueCount(n)} aria-label={t.dueAria(n)}>{n}</span>
  )
}

/**
 * `onOpenLead` lets the Leads page open a lead from the bell in place. On any
 * other page the bell goes to the lead's address, and the Leads page opens it
 * from there.
 */
export default function SalesShell({ children, onOpenLead }) {
  const { user, workspaces, activeWorkspaceId, switchWorkspace, signOut } = useAuth()
  const { t, lang, dir } = useT(LW)
  const navigate = useNavigate()
  const location = useLocation()
  const badges = { tasks: useDueTaskCount(activeWorkspaceId, user?.id) }
  function openLead(id, ws) {
    if (onOpenLead) { onOpenLead(id, ws); return }
    if (ws && ws !== activeWorkspaceId && workspaces.some((w) => w.id === ws)) switchWorkspace(ws)
    navigate(`/leads?lead=${encodeURIComponent(id)}`)
  }
  function openTask(id, ws) {
    if (ws && ws !== activeWorkspaceId && workspaces.some((w) => w.id === ws)) switchWorkspace(ws)
    navigate(`/leads?view=tasks${id ? `&task=${encodeURIComponent(id)}` : ''}`)
  }

  return (
    <div className="h-screen flex flex-col bg-surface-muted" dir={dir} lang={lang}>
      <header className="h-14 flex-shrink-0 bg-white border-b border-border">
        <div className="h-full px-4 md:px-5 flex items-center gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <ArakMark size="w-8 h-8" />
            <div className="min-w-0">
              <p className="font-semibold text-text text-sm leading-none tracking-tight">Arak</p>
              <p className="eyebrow text-text-tertiary mt-1">{t.sales}</p>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-3 min-w-0">
            <span className="hidden lg:inline text-xs text-text-tertiary tabular-nums">{fmtDay(new Date(), lang, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            {/* Arabic / English, as the main app's top bar has it. */}
            <button type="button" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} title={t.languageLabel} aria-label={t.languageLabel} lang={lang === 'ar' ? 'en' : 'ar'}
              className="h-8 px-2.5 border border-border text-xs font-medium text-text-secondary hover:bg-surface-subtle hover:text-text transition-colors">
              {t.language}
            </button>
            <Bell userId={user?.id} onOpenLead={openLead} onOpenTask={openTask} />
            <CompanyPicker workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onChange={switchWorkspace} />
            <span className="hidden md:inline text-[11px] text-text-tertiary truncate max-w-[14rem]" dir="ltr">{user?.email}</span>
            <Button size="xs" variant="ghost" onClick={() => signOut()}>{t.signOut}</Button>
          </div>
        </div>
      </header>

      <nav aria-label={t.sales} className="md:hidden flex-shrink-0 flex bg-white border-b border-border">
        {NAV.map((item) => (
          <Link key={item.to} to={item.to} className={tabClass(item.on(location))} aria-current={item.on(location) ? 'page' : undefined}>
            {item.icon}{t.nav[item.key]}
            {item.badge && badges[item.badge] > 0 && <Count n={badges[item.badge]} />}
          </Link>
        ))}
      </nav>

      <div className="flex-1 min-h-0 flex">
        <nav aria-label={t.sales} className="hidden md:block w-48 flex-shrink-0 bg-white border-e border-border py-3">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={navClass(item.on(location))} aria-current={item.on(location) ? 'page' : undefined}>
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="flex-1 truncate">{t.nav[item.key]}</span>
              {item.badge && badges[item.badge] > 0 && <Count n={badges[item.badge]} />}
            </Link>
          ))}
        </nav>
        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">{children}</div>
        </main>
      </div>
    </div>
  )
}
