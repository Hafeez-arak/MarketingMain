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
import { Subscribers } from './Subscribers'
import { Notice, SubTabs } from './parts'
import { OutreachMailboxes } from './Mailboxes'

// ─── Email ─────────────────────────────────────────────────────────────────
// One section, five tabs, in the order the work is done. The tab lives in the
// URL (?tab=contacts) so a link to the contact list is a link to it.
//
//   Overview     what is happening today, in both lanes, and what needs you
//   Contacts     People (add, import, edit, group) and Groups
//   Outreach     everything for prospects in one place: Campaigns, the
//                Mailboxes they are sent from (and the on/off switch), and
//                the People who replied or signed up
//   Newsletters  campaigns to people who know us (the marketing lane)
//   Settings     the newsletter sender, footer and limits
//
// Internally the two lanes keep their old names, 'marketing' and 'cold' (the
// database, the server and the URL keys use them), but a person never sees
// "cold": outreach is outreach, and marketing email is a newsletter.
//
// All data for the section loads once, here, and is handed down. At the
// sizes this is built for (a few thousand contacts) that is simpler and
// faster than every tab fetching its own slice, and it means the counts on
// every tab agree with each other.

const TABS = [
  { key: 'overview', label: 'Overview', note: 'What is going out today, what came back, and anything that needs you' },
  { key: 'contacts', label: 'Contacts', note: 'Everyone you can email, and the groups campaigns are sent to' },
  { key: 'cold', label: 'Outreach', note: 'Personal emails to prospects from your outreach mailboxes, a few at a time' },
  { key: 'marketing', label: 'Newsletters', note: 'Newsletters and updates to people who know us or signed up' },
  { key: 'settings', label: 'Settings', note: 'Who newsletters come from, the footer, and sending limits' },
]

const SECTIONS = {
  contacts: [
    { key: '', label: 'People' },
    { key: 'groups', label: 'Groups' },
  ],
  cold: [
    { key: '', label: 'Campaigns' },
    { key: 'mailboxes', label: 'Mailboxes' },
    { key: 'people', label: 'Replied & signed up' },
  ],
}

// Old tab names, from bookmarks and links sent before the regroup. The
// Microsoft sign-in callback also used to come back to ?tab=settings.
const MOVED = {
  groups: ['contacts', 'groups'],
  subscribers: ['cold', 'people'],
}
function whereIs(params) {
  const raw = params.get('tab') || ''
  if (MOVED[raw]) return MOVED[raw]
  if (raw === 'settings' && (params.has('ms') || params.has('ms_error'))) return ['cold', 'mailboxes']
  const tab = TABS.some(t => t.key === raw) ? raw : 'overview'
  const section = (SECTIONS[tab] || []).some(x => x.key === params.get('section')) ? params.get('section') : ''
  return [tab, section]
}

export function EmailFlows() {
  const { activeWorkspaceId } = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, section] = whereIs(params)
  const setTab = useCallback((key, extra = {}) => setParams(() => {
    const [to, movedSection] = MOVED[key] || [key, '']
    const n = new URLSearchParams()
    n.set('tab', to)
    if (movedSection) n.set('section', movedSection)
    for (const [k, v] of Object.entries(extra)) if (v) n.set(k, v)
    return n
  }), [setParams])

  // An old address is rewritten to the new one, keeping the rest of it (a
  // Microsoft sign-in's verdict, which the mailbox list reads and then clears).
  useEffect(() => {
    const raw = params.get('tab') || ''
    if (raw === tab && (params.get('section') || '') === section) return
    if (!MOVED[raw] && raw !== 'settings') return
    setParams(p => {
      const n = new URLSearchParams(p)
      n.set('tab', tab)
      if (section) n.set('section', section); else n.delete('section')
      return n
    }, { replace: true })
  }, [params, tab, section, setParams])

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
      <PageHeader title="Email" subtitle="Personal outreach to prospects, and newsletters to people who know us. Kept apart, so a problem with one can never hurt the other.">
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

      {/* A campaign open on screen is its own page: no sub-tabs above it. */}
      {SECTIONS[tab] && !params.get('campaign') && (
        <SubTabs items={SECTIONS[tab]} value={section} onChange={key => setTab(tab, { section: key })} />
      )}

      {tab === 'overview' && <Overview {...ctx} />}
      {tab === 'contacts' && section === '' && <Contacts {...ctx} />}
      {tab === 'contacts' && section === 'groups' && <Groups {...ctx} />}
      {tab === 'cold' && section === '' && <Campaigns {...ctx} audience="cold" />}
      {tab === 'cold' && section === 'mailboxes' && <OutreachMailboxes {...ctx} />}
      {tab === 'cold' && section === 'people' && <Subscribers {...ctx} />}
      {tab === 'marketing' && <Campaigns {...ctx} audience="marketing" />}
      {tab === 'settings' && <EmailSettings {...ctx} />}
    </div>
  )
}
