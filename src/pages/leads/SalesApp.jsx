import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { supabase } from '../../lib/supabaseClient'
import { Button, Spinner } from '../../components/ui/index'
import { Notice, Stat, SubTabs } from '../email/parts'
import { fetchMonthLeads, fetchSalesTeam, leadsApi } from '../../lib/leads/client'
import { monthStats } from '../../lib/leads/view'
import LeadsBoard from './Board'
import { useInbox } from '../../lib/useInbox'
import { timeAgo } from '../../lib/utils'
import Pipeline, { AddLeadDialog } from './Pipeline'

// ─── The sales team's app: Leads and nothing else ─────────────────────────
// What a 'sales' account sees instead of the marketing app (2026-10-11): one
// bar with the company and Sign out, this month's counts, and the leads list
// the team asked for. No sidebar, no agent settings, no assistant; every
// address lands here. Hiding is the courtesy; the database is the control
// (20261013_sales_seats): a sales person is not a member of any company, so
// nothing else would load for them even by typing its address.
//
// Two tabs since 2026-10-18: Inbox (every enquiry they can see, sorted by
// the agent) and Pipeline (approved and hand-added leads, by stage). A
// salesperson opens on the Pipeline, a sales admin on the Inbox. "Add lead"
// is on both.

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

export default function SalesApp() {
  const { user, workspaces, activeWorkspaceId, switchWorkspace, signOut, canApproveLeads } = useAuth()
  const [monthLeads, setMonthLeads] = useState([])
  const [mailboxes, setMailboxes] = useState([])
  // The company's sales team by name: the Owner column and the Assign choice.
  const [team, setTeam] = useState([])
  const [loadedFor, setLoadedFor] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [view, setView] = useState(() => (new URLSearchParams(window.location.search).get('lead') || !canApproveLeads ? 'pipeline' : 'inbox'))
  const [adding, setAdding] = useState(false)
  const [openCount, setOpenCount] = useState(null)
  // A lead to open in the Pipeline: from a notification, or a ?lead= link.
  const [focus, setFocus] = useState(() => new URLSearchParams(window.location.search).get('lead') || '')
  function openLead(id, ws) {
    if (ws && ws !== activeWorkspaceId && workspaces.some((w) => w.id === ws)) switchWorkspace(ws)
    setView('pipeline')
    setFocus(id)
  }

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) return
    const ws = activeWorkspaceId
    setRefreshing(true)
    try {
      // The mailboxes only name the "Came in" filter's choices; RLS lets a
      // sales seat read them, and nothing about them but these three columns
      // is asked for.
      const [rows, mb, people] = await Promise.all([
        fetchMonthLeads(ws),
        supabase.from('lead_mailboxes').select('id,email,label').eq('workspace_id', ws).order('created_at'),
        fetchSalesTeam(ws),
      ])
      if (mb.error) throw new Error(mb.error.message)
      setMonthLeads(rows)
      setMailboxes(mb.data || [])
      setTeam(people)
      setNow(new Date())
      setError('')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoadedFor(ws)
      setRefreshing(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => { queueMicrotask(reload) }, [reload])

  const loading = loadedFor !== activeWorkspaceId
  const stats = useMemo(() => monthStats(monthLeads, now), [monthLeads, now])
  const month = now.toLocaleString('en-GB', { month: 'long' })

  async function review(lead, verdict, reason) {
    const r = await leadsApi('review', activeWorkspaceId, { lead_id: lead.id, verdict, reason })
    if (r.error) { setError(r.error); return null }
    setMonthLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...r.lead } : l)))
    return r.lead
  }

  function refresh() {
    reload()
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="h-14 bg-white border-b border-border sticky top-0 z-30">
        <div className="max-w-7xl mx-auto h-full px-4 md:px-6 flex items-center gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-logo-mark flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
              </svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-text text-sm leading-none tracking-tight">Arak</p>
              <p className="eyebrow text-text-tertiary mt-1">Leads</p>
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

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text tracking-tight">Leads</h1>
            <p className="text-xs text-text-secondary mt-0.5">
              {canApproveLeads
                ? 'Inbox: every enquiry, sorted by the agent. Approve and assign the real ones; they move to the Pipeline, where each is worked stage by stage.'
                : 'Pipeline: your leads by stage, with the battle card for each. Add the ones that come by phone, WhatsApp or a visit yourself.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" onClick={() => setAdding(true)} disabled={!activeWorkspaceId}>+ Add lead</Button>
            <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing || !activeWorkspaceId}>
              {refreshing ? <Spinner size="sm" /> : null}
              Refresh
            </Button>
          </div>
        </div>

        <SubTabs items={[{ key: 'inbox', label: 'Inbox' }, { key: 'pipeline', label: openCount ? `Pipeline (${openCount})` : 'Pipeline' }]} value={view} onChange={setView} />

        {error && <Notice tone="red" title="Something went wrong">{error}</Notice>}

        {view === 'inbox' && <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
          <Stat label={`Leads in ${month}`} value={stats.qualified} loading={loading} tone="text-sage-700" hint="Qualified, by the agent or by you" />
          <Stat label="Needs a look" value={stats.needs_review} loading={loading} tone={stats.needs_review ? 'text-amber-800' : ''} hint="The agent was not sure; decide in the row" />
          <Stat label="Not leads" value={stats.unqualified} loading={loading} hint="Spam, sales pitches, job seekers and the like" />
          <Stat label="Everything" value={stats.total} loading={loading} hint={`All enquiries in ${month}`} />
        </div>}

        {view === 'inbox'
          ? <LeadsBoard workspaceId={activeWorkspaceId} onReview={review} refreshKey={refreshKey} mailboxes={mailboxes} canApprove={canApproveLeads} team={team} me={user?.id || ''} />
          : <Pipeline workspaceId={activeWorkspaceId} onReview={review} refreshKey={refreshKey} mailboxes={mailboxes} canApprove={canApproveLeads} team={team} me={user?.id || ''} onCount={setOpenCount} focus={focus} />}
        {adding && (
          <AddLeadDialog workspaceId={activeWorkspaceId} canAssign={canApproveLeads} team={team} me={user?.id || ''}
            onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); setView('pipeline'); setRefreshKey((k) => k + 1) }} />
        )}
      </main>
    </div>
  )
}
