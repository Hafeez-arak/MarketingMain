import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { supabase } from '../../lib/supabaseClient'
import { Button, Spinner } from '../../components/ui/index'
import { Notice, Stat } from '../email/parts'
import { fetchMonthLeads, leadsApi } from '../../lib/leads/client'
import { monthStats } from '../../lib/leads/view'
import LeadsBoard from './Board'

// ─── The sales team's app: Leads and nothing else ─────────────────────────
// What a 'sales' account sees instead of the marketing app (2026-10-11): one
// bar with the company and Sign out, this month's counts, and the leads list
// the team asked for. No sidebar, no agent settings, no assistant; every
// address lands here. Hiding is the courtesy; the database is the control
// (20261013_sales_seats): a sales person is not a member of any company, so
// nothing else would load for them even by typing its address.

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

export default function SalesApp() {
  const { user, workspaces, activeWorkspaceId, switchWorkspace, signOut } = useAuth()
  const [monthLeads, setMonthLeads] = useState([])
  const [mailboxes, setMailboxes] = useState([])
  const [loadedFor, setLoadedFor] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [now, setNow] = useState(() => new Date())

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) return
    const ws = activeWorkspaceId
    setRefreshing(true)
    try {
      // The mailboxes only name the "Came in" filter's choices; RLS lets a
      // sales seat read them, and nothing about them but these three columns
      // is asked for.
      const [rows, mb] = await Promise.all([
        fetchMonthLeads(ws),
        supabase.from('lead_mailboxes').select('id,email,label').eq('workspace_id', ws).order('created_at'),
      ])
      if (mb.error) throw new Error(mb.error.message)
      setMonthLeads(rows)
      setMailboxes(mb.data || [])
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

  async function review(lead, verdict) {
    const r = await leadsApi('review', activeWorkspaceId, { lead_id: lead.id, verdict })
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
              Every enquiry from the website and the info@ mailboxes, sorted by the agent. Open a row to read the email, call the number, or open it in Outlook.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing || !activeWorkspaceId}>
            {refreshing ? <Spinner size="sm" /> : null}
            Refresh
          </Button>
        </div>

        {error && <Notice tone="red" title="Something went wrong">{error}</Notice>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
          <Stat label={`Leads in ${month}`} value={stats.qualified} loading={loading} tone="text-sage-700" hint="Qualified, by the agent or by you" />
          <Stat label="Needs a look" value={stats.needs_review} loading={loading} tone={stats.needs_review ? 'text-amber-800' : ''} hint="The agent was not sure; decide in the row" />
          <Stat label="Not leads" value={stats.unqualified} loading={loading} hint="Spam, sales pitches, job seekers and the like" />
          <Stat label="Everything" value={stats.total} loading={loading} hint={`All enquiries in ${month}`} />
        </div>

        <LeadsBoard workspaceId={activeWorkspaceId} onReview={review} refreshKey={refreshKey} mailboxes={mailboxes} />
      </main>
    </div>
  )
}
