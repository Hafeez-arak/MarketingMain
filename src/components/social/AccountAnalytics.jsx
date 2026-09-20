import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../store/auth'
import { Card, Button, Empty, Spinner, PillSelect, IconBadge, Avatar, Skeleton } from '../ui/index'
import { Icon } from '../ui/icons'
import { fetchAccountAnalytics, syncAccounts, describeSync } from '../../lib/zernioConnect'
import { publishConnectedAccounts } from '../../lib/useConnectedAccounts'
import { profileUrlOf } from '../../lib/socialAnalytics'
import { AnalyticsDashboard, DashboardSkeleton } from '../../pages/analytics/Dashboard'
import { fmt, timeAgo, windowLabel } from '../../pages/analytics/format'
import { RangePicker } from '../analytics/RangePicker'
import { ReachSplit } from './ReachSplit'
import { resolveRange } from '../../lib/dateRange'
import { MetricLabel, ScopeBanner } from '../analytics/MetricLabel'
import { LinkedInInsights } from './LinkedInInsights'

// ─── One connected account's analytics ─────────────────────────────────────
// The Analytics tab on a platform page, and the body of /analytics. Same
// graphs everywhere, scoped to a single account, plus what only makes sense
// for one account: Instagram's account-wide insights (reach and views across
// feed, stories, explore and profile — not the sum of post numbers), a
// LinkedIn company page's totals, and follower history.
//
// Data comes from /api/zernio/analytics, which checks the account belongs to
// this workspace before reading anything.

// `info` is the key into src/lib/analytics/metricInfo.js. Namespaced `ig.*`
// because the same words mean something else one strip down: "reach" here is
// unique accounts across the whole profile, and "reach" in the KPI strip below
// is every post's reach added together. Two entries, never one shared.
const INSIGHTS = [
  { key: 'reach', info: 'ig.reach', label: 'Accounts reached', icon: Icon.users },
  { key: 'views', info: 'ig.views', label: 'Views', icon: Icon.eye },
  { key: 'accounts_engaged', info: 'ig.accounts_engaged', label: 'Accounts engaged', icon: Icon.activity },
  { key: 'total_interactions', info: 'ig.total_interactions', label: 'Interactions', icon: Icon.heart },
  { key: 'profile_links_taps', info: 'ig.profile_links_taps', label: 'Profile link taps', icon: Icon.trending },
]

// `refreshable` is off where the page around this has its own Refresh for
// every account (/analytics), so there are not two buttons doing one job.
// `reloadKey` is how that page asks for the numbers again after refreshing.
export function AccountAnalytics({ platform, accounts = [], loadingAccounts = false, refreshable = true, reloadKey = 0 }) {
  const { activeWorkspaceId } = useAuth()
  const [picked, setPicked] = useState('')
  const [range, setRange] = useState({ days: 30 })
  // How long the chosen window is, for the strips that say so and for the
  // Instagram cap warning. A fixed window counts its own days.
  const days = resolveRange(range).days
  // One comparable string, so a `{ days: 30 }` literal rebuilt on every render
  // does not restart the request.
  const rangeKey = range.from && range.to ? `${range.from}..${range.to}` : `d${range.days}`
  const [dash, setDash] = useState(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')

  const account = accounts.find(a => a.zernio_account_id === picked) || accounts[0] || null
  const accountId = account?.zernio_account_id || ''
  // Strings, not the account object: the list is answered from memory first
  // and then replaced by Zernio's, and a new object for the same account must
  // not fetch everything again.
  const accountPlatform = account?.platform || platform
  const accountType = account?.account_type || null

  // A slow answer for the previously chosen account must not land on top of
  // the one now chosen.
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!activeWorkspaceId || !accountId) return
    const n = ++seq.current
    setLoading(true)
    const res = await fetchAccountAnalytics(activeWorkspaceId, accountId, range, {
      platform: accountPlatform, accountType,
    })
    if (n !== seq.current) return
    setDash(res)
    setLoading(false)
    // `range` is covered by `rangeKey` — depending on the object itself
    // would refetch on every render of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, accountId, rangeKey, accountPlatform, accountType])

  // Deferred a tick, like the page's other first fetches: load() flips
  // `loading` before its first await.
  useEffect(() => { queueMicrotask(load) }, [load, reloadKey])

  // Refresh asks the platform first, THEN reads. Re-reading alone returned
  // Zernio's copy from up to ~90 minutes ago, which is why the old button
  // appeared to do nothing.
  async function handleRefresh() {
    setSyncing(true)
    setNote('')
    const res = await syncAccounts(activeWorkspaceId, accountId)
    if (res.error) {
      setNote(res.error)
    } else {
      publishConnectedAccounts(activeWorkspaceId, res.accounts)
      setNote(`${describeSync(res.synced)} Reach and impressions can still lag the platform by up to 48 hours.`)
    }
    await load()
    setSyncing(false)
  }

  if (!account) {
    return loadingAccounts
      ? <DashboardSkeleton />
      : (
        <Card>
          <Empty icon={Icon.users} title="No account connected"
            description="Connect an account on the Posts tab, and its analytics will show here." />
        </Card>
      )
  }

  // Only a response for THIS account is shown; while another one loads the
  // previous account's numbers would be a lie with the right name on it.
  const current = dash && (dash.error || dash.account?.zernio_account_id === accountId) ? dash : null
  const insights = current?.insights
  const lastSync = current?.overview?.overview?.lastSync
  const url = profileUrlOf(account)
  const isPage = account.platform === 'linkedin' && account.account_type !== 'personal'

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {accounts.length > 1 && (
          <PillSelect value={accountId} onChange={e => setPicked(e.target.value)} className="w-44">
            {accounts.map(a => (
              <option key={a.zernio_account_id} value={a.zernio_account_id}>
                {a.username ? `@${a.username}` : (a.display_name || a.zernio_account_id)}
              </option>
            ))}
          </PillSelect>
        )}
        <RangePicker value={range} onChange={setRange} />
        {(loading || syncing) && <Spinner size="sm" />}
        <div className="ml-auto flex items-center gap-3">
          {lastSync && <span className="text-[11px] text-text-tertiary">Zernio synced {timeAgo(lastSync)}</span>}
          {refreshable && (
            <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={loading || syncing}>
              {syncing ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
        </div>
      </div>
      {note && <p className="text-xs text-text-secondary -mt-2">{note}</p>}

      {/* The account, and what its platform says about it as a whole */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-border">
          {account.profile_picture
            ? <img src={account.profile_picture} alt="" className="w-10 h-10 rounded-full object-cover border border-border" />
            : <Avatar name={account.username || account.display_name || '?'} />}
          <div className="min-w-0 flex-1">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-text truncate hover:underline">
                {account.display_name || account.username}
              </a>
            ) : (
              <p className="text-sm font-semibold text-text truncate">{account.display_name || account.username}</p>
            )}
            {isPage
              ? <p className="text-xs text-text-tertiary truncate">Company page{account.followers_count != null ? ` · ${fmt(account.followers_count)} followers` : ''}</p>
              : account.username && <p className="text-xs text-text-tertiary truncate">@{account.username}</p>}
          </div>
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-700 hover:underline">Open profile ↗</a>}
        </div>

        {platform === 'instagram' && (
          insights?._error ? (
            <p className="px-5 py-4 text-sm text-text-secondary">Account insights did not load: {insights._error}</p>
          ) : (
            <>
              {/* The span Meta actually gave us, not the one in the picker.
                  Meta refuses more than 30 days on account insights, so at
                  "Last 90 days" this strip is 29 days and the post strip
                  below is 90 — and the two are only safe to read side by side
                  if each says which it is. */}
              <ScopeBanner
                title="Straight from Instagram"
                subtitle="Your whole account — posts, reels, stories, explore and the profile itself. People are counted once each."
                right={windowLabel(current?.insightsFrom, current?.toDate, Math.min(days, 29))}
              />
              <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border">
                {INSIGHTS.map(m => (
                  <div key={m.key} className="p-5">
                    <MetricLabel metric={m.info} label={m.label} icon={m.icon} className="mb-1.5" />
                    {current
                      ? <p className="text-2xl font-bold text-text">
                          {insights ? fmt(insights.metrics?.[m.key]?.total || 0) : '—'}
                        </p>
                      : <Skeleton className="h-8 w-16" />}
                  </div>
                ))}
              </div>
              {/* Instagram's only follower/non-follower split, directly under
                  the Reach tile it divides. */}
              <ReachSplit payload={current?.reachByFollowType}
                windowText={windowLabel(current?.insightsFrom, current?.toDate, Math.min(days, 29))} />

              <div className="px-5 py-2.5 border-t border-border flex items-center gap-2 text-[11px] text-text-tertiary">
                <IconBadge>{Icon.clock}</IconBadge>
                <span>
                  {current?.insightsFrom ? `Since ${current.insightsFrom}. ` : ''}
                  {days > 30 && 'Instagram gives account insights for 30 days at most, so this window is shorter than the one you picked. '}
                  Can lag up to 48 hours.
                </span>
              </div>
            </>
          )
        )}

        {platform === 'linkedin' && (
          <LinkedInInsights dash={current} days={days} isPage={isPage} />
        )}
      </Card>

      {/* `!current`, not `!current && loading`: the first load is deferred a
          tick, so `loading` is still false on the first paint and the graphs
          were drawn over no response — all zeros — until it started. */}
      {!current
        ? <DashboardSkeleton />
        : <AnalyticsDashboard dash={current} days={days} range={range} accountId={accountId} onRetry={load} perPlatform={false} />}
    </div>
  )
}
