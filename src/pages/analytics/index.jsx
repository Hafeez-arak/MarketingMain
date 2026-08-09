import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Card, Button, PlatformPill, Empty, Spinner } from '../../components/ui/index'
import { fetchSocialAccounts, fetchLatestAnalytics, syncZernio } from '../../lib/zernio'

// ─── Analytics ───────────────────────────────────────────────────────────
// Real numbers pulled back from the platforms via Zernio, not the old
// localStorage post counts this page used to show (those measured how much
// we CREATED, which is activity, not performance).
//
// Everything here reads Supabase (post_analytics / social_accounts), which
// the Zernio Sync workflow fills. The browser never talks to Zernio and
// never sees its API key — the "Refresh" button just triggers that same
// workflow through n8n.

const METRIC_CARDS = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'reach',       label: 'Reach' },
  { key: 'likes',       label: 'Likes' },
  { key: 'comments',    label: 'Comments' },
]

const fmt = n => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n ?? 0)

// Engagement = the interactions a human actually took, over how many people
// saw it. Uses reach (unique people) when the platform reports it and falls
// back to impressions, since not every platform reports both.
function engagementRate(row) {
  const denom = row.reach || row.impressions || 0
  if (!denom) return null
  const interactions = (row.likes || 0) + (row.comments || 0) + (row.shares || 0) + (row.saves || 0)
  return (interactions / denom) * 100
}

export function Analytics() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const navigate = useNavigate()

  const [accounts, setAccounts] = useState([])
  const [metrics,  setMetrics]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [syncing,  setSyncing]  = useState(false)
  const [note,     setNote]     = useState('')
  // '' = every account. One organisation can have several accounts on the
  // SAME platform, so this filters by account id, not by platform name —
  // filtering by platform would merge two Instagram brands into one number.
  const [selectedAccount, setSelectedAccount] = useState('')

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return null
    const [accts, rows] = await Promise.all([
      fetchSocialAccounts(activeWorkspaceId, accessToken),
      fetchLatestAnalytics(activeWorkspaceId, accessToken),
    ])
    return { accts, rows }
  }, [activeWorkspaceId, accessToken])

  // State updates live inside the async IIFE rather than the effect body
  // (React's set-state-in-effect rule), and `cancelled` drops a response
  // that lands after the workspace changed — otherwise switching workspaces
  // mid-fetch can paint the previous one's numbers.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await load()
      if (cancelled) return
      if (result) { setAccounts(result.accts); setMetrics(result.rows) }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [load])

  async function refresh() {
    const result = await load()
    if (result) { setAccounts(result.accts); setMetrics(result.rows) }
  }

  async function handleSync() {
    setSyncing(true); setNote('')
    const result = await syncZernio(state.webhooks?.zernioSync, activeWorkspaceId)
    setSyncing(false)
    setNote(result.error || result.analytics_skipped
      || `Synced ${result.accounts_synced ?? 0} account(s), ${result.rows_written ?? 0} metric row(s).`)
    refresh()
  }

  // Everything below reads `scoped`, not `metrics`, so picking an account
  // filters the whole page (totals, breakdown and top posts) coherently
  // rather than only one section.
  const scoped = useMemo(() =>
    selectedAccount ? metrics.filter(r => r.zernio_account_id === selectedAccount) : metrics
  , [metrics, selectedAccount])

  // Totals across every post's latest row. Summed per metric only over rows
  // that actually reported it (metrics_present) — otherwise a platform that
  // doesn't measure saves would drag the total down as if it measured zero.
  const totals = useMemo(() => {
    const acc = {}
    for (const { key } of METRIC_CARDS) {
      const reporting = scoped.filter(r => (r.metrics_present || []).includes(key))
      acc[key] = { value: reporting.reduce((s, r) => s + (r[key] || 0), 0), posts: reporting.length }
    }
    return acc
  }, [scoped])

  // Per ACCOUNT, not per platform — two Instagram accounts must stay two
  // rows. Keyed by account id with the platform carried along for the pill.
  const byAccount = useMemo(() => {
    const map = new Map()
    for (const r of scoped) {
      const key = r.zernio_account_id || `__${r.platform || 'unknown'}`
      if (!map.has(key)) map.set(key, { accountId: r.zernio_account_id || '', platform: r.platform || 'unknown', posts: 0, impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0 })
      const e = map.get(key)
      e.posts++
      for (const k of ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves']) e[k] += r[k] || 0
    }
    return [...map.values()].sort((a, b) => b.impressions - a.impressions)
  }, [scoped])

  const accountById = useMemo(
    () => new Map(accounts.map(a => [a.zernio_account_id, a])),
    [accounts],
  )
  const labelFor = id => {
    const a = accountById.get(id)
    return a ? (a.username ? `@${a.username}` : a.display_name || a.platform) : 'Unattributed'
  }

  const topPosts = useMemo(() =>
    [...scoped]
      .map(r => ({ ...r, _er: engagementRate(r) }))
      .sort((a, b) => (b._er ?? -1) - (a._er ?? -1))
      .slice(0, 8)
  , [scoped])

  const visibleAccounts = selectedAccount
    ? accounts.filter(a => a.zernio_account_id === selectedAccount)
    : accounts
  const totalFollowers = visibleAccounts.reduce((s, a) => s + (a.followers_count || 0), 0)

  if (loading) {
    return <div className="max-w-7xl"><Card className="p-12 flex items-center justify-center"><Spinner /></Card></div>
  }

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">Analytics</h1>
          <p className="text-sm text-text-secondary mt-1">
            Real performance pulled from your connected accounts. Updated daily, or refresh on demand.
          </p>
        </div>
        <div className="text-right">
          <Button size="xs" variant="ghost" onClick={handleSync} disabled={syncing}>
            {syncing ? <><Spinner size="sm" /> Syncing…</> : '↻ Refresh from Zernio'}
          </Button>
          {note && <p className="text-[10px] text-text-tertiary mt-1 max-w-[260px]">{note}</p>}
        </div>
      </div>

      {/* No connected accounts at all — nothing downstream can exist yet. */}
      {accounts.length === 0 ? (
        <Card className="p-6 border-dashed bg-surface-muted">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-text mb-1">No connected accounts yet</h3>
              <p className="text-sm text-text-secondary mb-3">
                Connect your accounts in the Zernio dashboard, then hit Refresh — they'll appear here with real reach, engagement and follower data.
              </p>
              <Button onClick={() => navigate('/integrations')}>Set up integrations</Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Account selector — the whole page scopes to this. Only shown
              when there's more than one account; with a single account it
              would be a control with nothing to choose. */}
          {accounts.length > 1 && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-text-secondary mr-1">Showing:</span>
              <button onClick={() => setSelectedAccount('')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${!selectedAccount ? 'bg-amber-600 text-white shadow-sm' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                All accounts
              </button>
              {accounts.map(a => (
                <button key={a.id} onClick={() => setSelectedAccount(a.zernio_account_id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${selectedAccount === a.zernio_account_id ? 'bg-amber-600 text-white shadow-sm' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                  <span className="capitalize opacity-70">{a.platform}</span>
                  <span>{a.username ? `@${a.username}` : a.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {METRIC_CARDS.map(m => (
              <Card key={m.key} className="p-5 text-center">
                <p className="text-3xl font-bold text-text mb-1">{fmt(totals[m.key].value)}</p>
                <p className="text-xs text-text-secondary">{m.label}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  {totals[m.key].posts > 0 ? `across ${totals[m.key].posts} post${totals[m.key].posts !== 1 ? 's' : ''}` : 'not reported'}
                </p>
              </Card>
            ))}
            <Card className="p-5 text-center">
              <p className="text-3xl font-bold text-text mb-1">{fmt(totalFollowers)}</p>
              <p className="text-xs text-text-secondary">Followers</p>
              <p className="text-[10px] text-text-tertiary mt-0.5">{visibleAccounts.length} account{visibleAccounts.length !== 1 ? 's' : ''}</p>
            </Card>
          </div>

          {/* Connected accounts */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-text">Connected accounts</h3>
              <p className="text-xs text-text-secondary mt-0.5">Managed in Zernio — reconnect there if a token expires</p>
            </div>
            <div className="divide-y divide-border">
              {accounts.map(a => {
                const active = selectedAccount === a.zernio_account_id
                return (
                  // Clicking an account drills the page into it — the same
                  // thing the chips above do, since this list is where the
                  // eye naturally lands first.
                  <div key={a.id}
                    onClick={() => setSelectedAccount(active ? '' : a.zernio_account_id)}
                    className={`flex items-center gap-4 px-5 py-3 cursor-pointer transition-colors ${active ? 'bg-amber-50/60' : 'hover:bg-surface-subtle'}`}>
                    <PlatformPill platform={a.platform} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text truncate">{a.display_name || a.username || a.platform}</p>
                      {a.username && <p className="text-xs text-text-tertiary truncate">@{a.username}</p>}
                    </div>
                    <div className="text-sm text-text-secondary">{fmt(a.followers_count || 0)} followers</div>
                    {a.needs_reconnection
                      ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">Reconnect needed</span>
                      : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sage-50 text-sage-700">Connected</span>}
                    {active && <span className="text-[10px] font-semibold text-amber-700">Viewing</span>}
                    {a.profile_url && (
                      <a href={a.profile_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="text-[11px] font-semibold text-amber-700 hover:underline">Open ↗</a>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          {/* No metrics yet — accounts exist but nothing published/synced. */}
          {metrics.length === 0 ? (
            <Card>
              <Empty
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
                title="No performance data yet"
                description="Publish a post from Post Approvals, then refresh — metrics appear once the platform has reported them (usually within a day)."
                action={<Button onClick={() => navigate('/social/approvals')}>Go to Post Approvals</Button>}
              />
            </Card>
          ) : (
            <>
              {/* Per account — not per platform, so two accounts on the
                  same platform stay two rows instead of being averaged
                  together into a number that describes neither. */}
              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-semibold text-text">By account</h3>
                  <p className="text-xs text-text-secondary mt-0.5">Each connected account measured on its own</p>
                </div>
                <div className="divide-y divide-border">
                  {byAccount.map(p => (
                    <div key={p.accountId || p.platform}
                      onClick={() => p.accountId && setSelectedAccount(selectedAccount === p.accountId ? '' : p.accountId)}
                      className={`flex items-center gap-4 px-5 py-4 ${p.accountId ? 'cursor-pointer hover:bg-surface-subtle' : ''} transition-colors`}>
                      <PlatformPill platform={p.platform} />
                      <span className="text-xs text-text-secondary min-w-[110px] truncate">{labelFor(p.accountId)}</span>
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                        <div><span className="text-text font-medium">{p.posts}</span><span className="text-text-tertiary text-xs ml-1">posts</span></div>
                        <div><span className="text-text font-medium">{fmt(p.impressions)}</span><span className="text-text-tertiary text-xs ml-1">impr.</span></div>
                        <div><span className="text-text font-medium">{fmt(p.reach)}</span><span className="text-text-tertiary text-xs ml-1">reach</span></div>
                        <div><span className="text-text font-medium">{fmt(p.likes)}</span><span className="text-text-tertiary text-xs ml-1">likes</span></div>
                        <div><span className="text-text font-medium">{fmt(p.comments)}</span><span className="text-text-tertiary text-xs ml-1">comments</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Top performers */}
              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-semibold text-text">Top posts by engagement</h3>
                  <p className="text-xs text-text-secondary mt-0.5">Interactions ÷ people reached</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted">
                        <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary">Platform</th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary">Account</th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary">Date</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary">Impressions</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary">Reach</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary">Likes</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary">Comments</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary">Engagement</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {topPosts.map(r => (
                        <tr key={r.id} className="hover:bg-surface-muted transition-colors">
                          <td className="px-5 py-3"><PlatformPill platform={r.platform} /></td>
                          <td className="px-5 py-3 text-text-secondary text-xs">{labelFor(r.zernio_account_id)}</td>
                          <td className="px-5 py-3 text-text-secondary">{r.metric_date}</td>
                          <td className="px-5 py-3 text-right text-text">{fmt(r.impressions)}</td>
                          <td className="px-5 py-3 text-right text-text">{fmt(r.reach)}</td>
                          <td className="px-5 py-3 text-right text-text">{fmt(r.likes)}</td>
                          <td className="px-5 py-3 text-right text-text">{fmt(r.comments)}</td>
                          <td className="px-5 py-3 text-right font-medium text-text">
                            {r._er === null ? <span className="text-text-tertiary">—</span> : `${r._er.toFixed(2)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
