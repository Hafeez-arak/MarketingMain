import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Button, Spinner } from '../../components/ui/index'
import { fetchEmailData, emailApi } from '../../lib/email/client'
import { Overview } from './Overview'
import { Contacts } from './Contacts'
import { Groups } from './Groups'
import { Campaigns } from './Campaigns'
import { EmailSettings } from './Settings'
import { Notice } from './parts'

// ─── Email ─────────────────────────────────────────────────────────────────
// One section, six tabs. The tab lives in the URL (?tab=contacts) so a link
// to the contact list is a link to the contact list.
//
//   Overview   what is happening: sends, rates, today's limit, what is missing
//   Contacts   the address book: add, import, edit, delete, group, export
//   Groups     named lists a campaign is sent to
//   Marketing  campaigns to people who know us, sent through Resend
//   Cold       outreach to prospects: written here, sent one at a time from
//              our own outreach mailboxes (never through Resend)
//   Settings   sender, footer, limits, warm-up, outreach mailboxes
//
// All data for the section loads once, here, and is handed down. At the
// sizes this is built for (a few thousand contacts) that is simpler and
// faster than every tab fetching its own slice, and it means the counts on
// every tab agree with each other.

const TABS = [
  { key: 'overview', label: 'Overview', note: 'How sending is going' },
  { key: 'contacts', label: 'Contacts', note: 'Everyone you can email: add, import, tag, group' },
  { key: 'groups', label: 'Groups', note: 'Named lists that campaigns are sent to' },
  { key: 'marketing', label: 'Marketing', note: 'Newsletters and updates to people who know us, sent through Resend' },
  { key: 'cold', label: 'Cold outreach', note: 'Personal first emails and follow-ups to prospects, sent from your outreach mailboxes' },
  { key: 'settings', label: 'Settings', note: 'Sender, footer, sending limits and warm-up' },
]

export function EmailFlows() {
  const { activeWorkspaceId } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview'
  const setTab = useCallback((key, extra = {}) => setParams(() => {
    const n = new URLSearchParams()
    n.set('tab', key)
    for (const [k, v] of Object.entries(extra)) if (v) n.set(k, v)
    return n
  }), [setParams])

  const [data, setData] = useState(null)
  const [loadedFor, setLoadedFor] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const dispatchedFor = useRef(null)

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) return
    const ws = activeWorkspaceId
    setRefreshing(true)
    try {
      const [d, s] = await Promise.all([fetchEmailData(ws), emailApi('status', ws)])
      setData(d)
      setStatus(s.error ? { error: s.error } : s)
      setError('')
      setLoadedFor(ws)
    } catch (err) {
      setError(err.message || String(err))
      setLoadedFor(ws)
    } finally {
      setRefreshing(false)
    }
  }, [activeWorkspaceId])

  // Switching workspace needs no reset: `loading` is derived from loadedFor,
  // so every tab shows skeletons (not the previous company's contacts) until
  // this workspace's answer lands.
  useEffect(() => { queueMicrotask(reload) }, [reload])

  // Opening the section sends anything that is due — a scheduled campaign
  // whose morning has passed, or the rest of yesterday's warm-up. The daily
  // cron does the same; this is what makes it not depend on the cron alone.
  useEffect(() => {
    if (!activeWorkspaceId || loadedFor !== activeWorkspaceId || dispatchedFor.current === activeWorkspaceId) return
    if (!status?.configured?.resend) return
    const hasWork = (data?.campaigns || []).some(c => c.status === 'sending' || c.status === 'scheduled')
    dispatchedFor.current = activeWorkspaceId
    if (!hasWork) return
    emailApi('dispatch', activeWorkspaceId).then(r => { if (r?.dispatched?.sent) reload() })
  }, [activeWorkspaceId, loadedFor, status, data, reload])

  const loading = loadedFor !== activeWorkspaceId
  const ctx = useMemo(() => ({
    workspaceId: activeWorkspaceId,
    data: data || { contacts: [], groups: [], members: [], campaigns: [], stats: [], settings: null, recentSends: [], aiDrafts: null, mailboxes: [] },
    status,
    loading,
    reload,
    setTab,
    params,
  }), [activeWorkspaceId, data, status, loading, reload, setTab, params])

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Email" subtitle="Marketing email to people who know us, and personal outreach to prospects. Kept on separate lanes so one can never damage the other.">
        <Button variant="secondary" size="sm" onClick={reload} disabled={refreshing || !activeWorkspaceId}>
          {refreshing ? <Spinner size="sm" /> : null}
          Refresh
        </Button>
      </PageHeader>

      <div className="flex overflow-x-auto scrollbar-thin">
        {TABS.map(t => (
          <button
            key={t.key} onClick={() => setTab(t.key)} title={t.note}
            className={`flex-1 min-w-[96px] py-2 px-3 border -ml-px first:ml-0 text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                : 'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-text-tertiary -mt-2">{TABS.find(t => t.key === tab)?.note}</p>

      {error && (
        <Notice tone="red" title="Could not load email data">
          {error}
        </Notice>
      )}

      {tab === 'overview' && <Overview {...ctx} />}
      {tab === 'contacts' && <Contacts {...ctx} />}
      {tab === 'groups' && <Groups {...ctx} />}
      {tab === 'marketing' && <Campaigns {...ctx} audience="marketing" />}
      {tab === 'cold' && <Campaigns {...ctx} audience="cold" />}
      {tab === 'settings' && <EmailSettings {...ctx} />}
    </div>
  )
}
