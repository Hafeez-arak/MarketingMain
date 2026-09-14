import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../store/auth'
import { Card, Button, Empty, Spinner, PillSelect, IconBadge, Avatar, Skeleton } from '../ui/index'
import { Icon } from '../ui/icons'
import { fetchAccountAnalytics } from '../../lib/zernioConnect'
import { profileUrlOf } from '../../lib/socialAnalytics'
import { AnalyticsDashboard, DashboardSkeleton } from '../../pages/analytics/Dashboard'
import { fmt, timeAgo } from '../../pages/analytics/format'

// ─── One connected account's analytics ─────────────────────────────────────
// The Analytics tab on a platform page. Same graphs as /analytics, scoped to a
// single account, plus what only makes sense for one account: Instagram's
// account-wide insights (reach and views across feed, stories, explore and
// profile — not the sum of post numbers) and its follower history.
//
// Data comes from /api/zernio/analytics, which checks the account belongs to
// this workspace before reading anything.

const INSIGHTS = [
  { key: 'reach', label: 'Accounts reached', icon: Icon.users },
  { key: 'views', label: 'Views', icon: Icon.eye },
  { key: 'accounts_engaged', label: 'Accounts engaged', icon: Icon.activity },
  { key: 'total_interactions', label: 'Interactions', icon: Icon.heart },
  { key: 'profile_links_taps', label: 'Profile link taps', icon: Icon.trending },
]

export function AccountAnalytics({ platform, accounts = [], loadingAccounts = false }) {
  const { activeWorkspaceId } = useAuth()
  const [picked, setPicked] = useState('')
  const [days, setDays] = useState(30)
  const [dash, setDash] = useState(null)
  const [loading, setLoading] = useState(false)

  const account = accounts.find(a => a.zernio_account_id === picked) || accounts[0] || null
  const accountId = account?.zernio_account_id || ''

  // A slow answer for the previously chosen account must not land on top of
  // the one now chosen.
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!activeWorkspaceId || !accountId) return
    const n = ++seq.current
    setLoading(true)
    const res = await fetchAccountAnalytics(activeWorkspaceId, accountId, days)
    if (n !== seq.current) return
    setDash(res)
    setLoading(false)
  }, [activeWorkspaceId, accountId, days])

  // Deferred a tick, like the page's other first fetches: load() flips
  // `loading` before its first await.
  useEffect(() => { queueMicrotask(load) }, [load])

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
        <PillSelect value={String(days)} onChange={e => setDays(Number(e.target.value))} className="w-32">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </PillSelect>
        {loading && <Spinner size="sm" />}
        <div className="ml-auto flex items-center gap-3">
          {lastSync && <span className="text-[11px] text-text-tertiary">Zernio synced {timeAgo(lastSync)}</span>}
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>Refresh</Button>
        </div>
      </div>

      {/* The account, and what Instagram says about it as a whole */}
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
            {account.username && <p className="text-xs text-text-tertiary truncate">@{account.username}</p>}
          </div>
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-700 hover:underline">Open profile ↗</a>}
        </div>

        {platform === 'instagram' && (
          insights?._error ? (
            <p className="px-5 py-4 text-sm text-text-secondary">Account insights did not load: {insights._error}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border">
                {INSIGHTS.map(m => (
                  <div key={m.key} className="p-5">
                    <p className="text-xs text-text-tertiary mb-1.5 flex items-center gap-1.5">
                      <span className="text-text-tertiary">{m.icon}</span>{m.label}
                    </p>
                    {current
                      ? <p className="text-2xl font-bold text-text">
                          {insights ? fmt(insights.metrics?.[m.key]?.total || 0) : '—'}
                        </p>
                      : <Skeleton className="h-8 w-16" />}
                  </div>
                ))}
              </div>
              <div className="px-5 py-2.5 border-t border-border flex items-center gap-2 text-[11px] text-text-tertiary">
                <IconBadge>{Icon.clock}</IconBadge>
                <span>
                  Account-wide{current?.insightsFrom ? ` since ${current.insightsFrom}` : ''} — every surface, not just posts.
                  {days > 30 && ' Instagram gives account insights for 30 days at most.'}
                  {' '}Can lag up to 48 hours.
                </span>
              </div>
            </>
          )
        )}
      </Card>

      {/* `!current`, not `!current && loading`: the first load is deferred a
          tick, so `loading` is still false on the first paint and the graphs
          were drawn over no response — all zeros — until it started. */}
      {!current
        ? <DashboardSkeleton />
        : <AnalyticsDashboard dash={current} days={days} accountId={accountId} onRetry={load} perPlatform={false} />}
    </div>
  )
}
