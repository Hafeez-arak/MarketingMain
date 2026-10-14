import { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Button, Card, Skeleton, Spinner } from '../../components/ui/index'
import { fetchEmailCore, emailApi } from '../../lib/email/client'
import { invalidate } from '../../lib/email/cache'
import { useCached } from './data'
import { Overview } from './Overview'
import { Notice, SubTabs } from './parts'

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
// What loads when: only the small tables every tab needs (groups, the
// campaign list, their numbers, settings, mailboxes) and the server's status
// load here. Each tab reads the rest itself when it is opened — a page of
// contacts, the last 30 days of sends, the people who answered — through a
// session cache (./data.js), so going back to a tab paints at once. Every
// tab but the Overview is its own download, fetched when first opened (or
// hovered).

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

// The tabs' code, each loaded the first time it is needed.
const load = {
  contacts: () => import('./Contacts'),
  groups: () => import('./Groups'),
  campaigns: () => import('./Campaigns'),
  mailboxes: () => import('./Mailboxes'),
  subscribers: () => import('./Subscribers'),
  settings: () => import('./Settings'),
}
const Contacts = lazy(() => load.contacts().then(m => ({ default: m.Contacts })))
const Groups = lazy(() => load.groups().then(m => ({ default: m.Groups })))
const Campaigns = lazy(() => load.campaigns().then(m => ({ default: m.Campaigns })))
const OutreachMailboxes = lazy(() => load.mailboxes().then(m => ({ default: m.OutreachMailboxes })))
const Subscribers = lazy(() => load.subscribers().then(m => ({ default: m.Subscribers })))
const EmailSettings = lazy(() => load.settings().then(m => ({ default: m.EmailSettings })))
// Pointing at a tab starts its download, so the click usually finds it there.
const PREFETCH = { contacts: ['contacts', 'groups'], cold: ['campaigns', 'mailboxes', 'subscribers'], marketing: ['campaigns'], settings: ['settings'] }
const prefetch = key => { for (const k of PREFETCH[key] || []) load[k]().catch(() => {}) }

const EMPTY_CORE = { groups: [], campaigns: [], stats: [], settings: null, mailboxes: [] }

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

/** While a tab's code downloads: the shape of a tab, not a spinner. */
function TabSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Card className="p-3"><Skeleton className="h-9 w-full" /></Card>
      <Card className="p-4 space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9 w-full" />)}</Card>
    </div>
  )
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

  const ws = activeWorkspaceId
  // Keys carry the workspace: switching company shows skeletons (never the
  // previous company's rows) until this one's answer lands.
  const core = useCached(ws ? `core:${ws}` : null, () => fetchEmailCore(ws))
  const statusRead = useCached(ws ? `status:${ws}` : null, async () => {
    const s = await emailApi('status', ws)
    return s.error ? { error: s.error } : s
  })
  const status = statusRead.data || null
  // After a change: everything read is stale (what is on screen re-reads
  // now, the rest when next shown), and the shared tables are awaited, so a
  // caller that goes on to open what it just made finds it there.
  const refetchCore = core.refetch
  const reload = useCallback(async () => { invalidate(); await refetchCore() }, [refetchCore])
  const dispatchedFor = useRef(null)

  // Opening the section sends anything that is due — a scheduled campaign
  // whose morning has passed, or the rest of yesterday's warm-up. The daily
  // cron does the same; this is what makes it not depend on the cron alone.
  useEffect(() => {
    if (!ws || !core.data || dispatchedFor.current === ws) return
    if (!status?.configured?.resend) return
    const hasWork = core.data.campaigns.some(c => c.status === 'sending' || c.status === 'scheduled')
    dispatchedFor.current = ws
    if (!hasWork) return
    emailApi('dispatch', ws).then(r => { if (r?.dispatched?.sent) reload() })
  }, [ws, core.data, status, reload])

  const loading = !core.data
  const ctx = useMemo(() => ({
    workspaceId: ws,
    data: core.data || EMPTY_CORE,
    status,
    loading,
    reload,
    setTab,
    params,
  }), [ws, core.data, status, loading, reload, setTab, params])

  // Nothing could be read: say so, and show no tab (an empty one would claim
  // there are no contacts or campaigns).
  const failed = core.error && !core.data

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Email" subtitle="Personal outreach to prospects, and newsletters to people who know us. Kept apart, so a problem with one can never hurt the other.">
        <Button variant="secondary" size="sm" onClick={reload} disabled={core.refreshing || !ws}>
          {core.refreshing ? <Spinner size="sm" /> : null}
          Refresh
        </Button>
      </PageHeader>

      <div className="flex overflow-x-auto scrollbar-thin">
        {TABS.map(t => (
          <button
            key={t.key} onClick={() => setTab(t.key)} title={t.note}
            onMouseEnter={() => prefetch(t.key)} onFocus={() => prefetch(t.key)}
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

      {core.error && (
        <Notice tone="red" title={failed ? 'Could not load email data' : 'Could not refresh email data'}
          action={<Button size="sm" variant="secondary" onClick={reload}>Try again</Button>}>
          {core.error}{failed ? '' : ' What is shown is from the last time it loaded.'}
        </Notice>
      )}

      {/* A campaign open on screen is its own page: no sub-tabs above it. */}
      {SECTIONS[tab] && !params.get('campaign') && (
        <SubTabs items={SECTIONS[tab]} value={section} onChange={key => setTab(tab, { section: key })} />
      )}

      {!failed && (
        <Suspense fallback={<TabSkeleton />}>
          {tab === 'overview' && <Overview {...ctx} />}
          {tab === 'contacts' && section === '' && <Contacts {...ctx} />}
          {tab === 'contacts' && section === 'groups' && <Groups {...ctx} />}
          {tab === 'cold' && section === '' && <Campaigns {...ctx} audience="cold" />}
          {tab === 'cold' && section === 'mailboxes' && <OutreachMailboxes {...ctx} />}
          {tab === 'cold' && section === 'people' && <Subscribers {...ctx} />}
          {tab === 'marketing' && <Campaigns {...ctx} audience="marketing" />}
          {tab === 'settings' && <EmailSettings {...ctx} />}
        </Suspense>
      )}
    </div>
  )
}
