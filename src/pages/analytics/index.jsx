import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, PlatformPill, Spinner, IconBadge, PillSelect, PageHeader } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { syncZernio, fetchZernioDashboard } from '../../lib/zernio'
import { fetchSocialAccounts, profileUrlOf } from '../../lib/socialAnalytics'
import { defaultWebhookUrl } from '../../lib/n8nWebhooks'
import { AnalyticsDashboard, DashboardSkeleton } from './Dashboard'
import { fmt, timeAgo } from './format'

// ─── Analytics ───────────────────────────────────────────────────────────
// Zernio's numbers, proxied through n8n — the browser never holds the Zernio
// API key (see src/lib/zernio.js). Zernio pre-aggregates the time-shaped
// widgets (best time to post, posting frequency, content decay, follower
// history), so the page asks for them rather than deriving them.
//
// Always scoped to ONE account. The Zernio Dashboard workflow filters by
// account_id and nothing else, and Zernio's analytics endpoints are team-wide,
// so an unscoped call would return every workspace's numbers. With no account
// connected there is nothing to ask for, and no call is made.
//
// The graphs themselves live in ./Dashboard, shared with each platform page's
// Analytics tab (which reads one account through /api/zernio/analytics).

export function Analytics() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const navigate = useNavigate()

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dash, setDash] = useState(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')

  const [platform, setPlatform] = useState('instagram')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [days, setDays] = useState(30)

  // Connected accounts — straight Supabase read, independent of the Zernio
  // proxy, so the account picker still works even if that webhook is down.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!activeWorkspaceId) { setLoading(false); return }
      const accts = await fetchSocialAccounts(activeWorkspaceId, accessToken)
      if (cancelled) return
      setAccounts(accts)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  // The account the dashboard is scoped to: the one picked, else the first
  // connected account on the chosen platform. Never '' while one exists.
  const scopedAccount = selectedAccount
    || accounts.find(a => !platform || a.platform === platform)?.zernio_account_id
    || ''

  const loadDashboard = useCallback(async () => {
    if (!scopedAccount) { setDashLoading(false); return null }
    setDashLoading(true)
    const result = await fetchZernioDashboard(
      state.webhooks?.zernioDashboard || defaultWebhookUrl('zernioDashboard'),
      { platform, accountId: scopedAccount, days },
    )
    setDashLoading(false)
    return result
  }, [state.webhooks?.zernioDashboard, platform, scopedAccount, days])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await loadDashboard()
      if (!cancelled) setDash(result)
    })()
    return () => { cancelled = true }
  }, [loadDashboard])

  async function handleSync() {
    setSyncing(true); setNote('')
    const result = await syncZernio(state.webhooks?.zernioSync || defaultWebhookUrl('zernioSync'), activeWorkspaceId)
    setSyncing(false)
    setNote(result.error || result.analytics_skipped
      || `Synced ${result.accounts_synced ?? 0} account(s), ${result.rows_written ?? 0} metric row(s).`)
    setDash(await loadDashboard())
  }

  if (loading) {
    return (
      <div className="max-w-7xl space-y-4">
        <PageHeader title="Analytics" subtitle="Real performance pulled live from your connected accounts." />
        <DashboardSkeleton />
      </div>
    )
  }

  const lastSync = dash?.overview?.overview?.lastSync

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Analytics" subtitle="Real performance pulled live from your connected accounts.">
        <div className="text-right">
          <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? <><Spinner size="sm" /> Syncing…</> : 'Refresh from Zernio'}
          </Button>
          {note && <p className="text-[10px] text-text-tertiary mt-1.5 max-w-[260px]">{note}</p>}
        </div>
      </PageHeader>

      {accounts.length === 0 ? (
        <Card className="p-6 border-dashed bg-surface-muted">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 border border-amber-200 bg-amber-50 flex items-center justify-center text-amber-700 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-text mb-1">No connected accounts yet</h3>
              <p className="text-sm text-text-secondary mb-3">
                Connect an account through Zernio in Integrations, then hit Refresh — it'll appear here with real reach, engagement and follower data.
              </p>
              <Button onClick={() => navigate('/integrations')}>Set up integrations</Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <PillSelect value={platform} onChange={e => setPlatform(e.target.value)} className="w-32">
              <option value="">All platforms</option>
              <option value="instagram">Instagram</option>
            </PillSelect>
            {accounts.length > 1 && (
              <PillSelect value={scopedAccount} onChange={e => setSelectedAccount(e.target.value)} className="w-40">
                {accounts.map(a => (
                  <option key={a.id} value={a.zernio_account_id}>{a.username ? `@${a.username}` : a.display_name}</option>
                ))}
              </PillSelect>
            )}
            <PillSelect value={String(days)} onChange={e => setDays(Number(e.target.value))} className="w-32">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </PillSelect>
            {dashLoading && <Spinner size="sm" />}
            <div className="ml-auto text-[11px] text-text-tertiary text-right leading-tight">
              {lastSync && <p>Last sync: {timeAgo(lastSync)}</p>}
            </div>
          </div>

          {/* Keyed on having no response yet rather than on dashLoading. When
              the accounts arrive there is one render where the account is
              known but the dashboard fetch has not started, and dashLoading is
              still false from the empty run before it — that frame painted all
              zeros. A refetch (new date range) keeps the old numbers up. */}
          {!dash && scopedAccount
            ? <DashboardSkeleton />
            : <AnalyticsDashboard dash={dash} days={days} accountId={scopedAccount} onRetry={handleSync} />}

          {/* Connected accounts — always shown regardless of dashboard state */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
              <IconBadge>{Icon.users}</IconBadge>
              <div>
                <h3 className="font-semibold text-text text-sm">Connected accounts</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Managed in Zernio — reconnect there if a token expires</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              {accounts.map(a => {
                // Picking a row re-scopes the dashboard, which only means
                // something when there is another account to pick. With one,
                // the click changed nothing but a small "Viewing" label, and
                // read as a link that did not open.
                const choosable = accounts.length > 1
                const active = choosable && scopedAccount === a.zernio_account_id
                const url = profileUrlOf(a)
                return (
                  <div key={a.id}
                    onClick={choosable ? () => setSelectedAccount(a.zernio_account_id) : undefined}
                    className={`flex items-center gap-4 px-5 py-3 transition-colors ${choosable ? 'cursor-pointer' : ''} ${active ? 'bg-amber-50/60' : 'hover:bg-surface-subtle'}`}>
                    <PlatformPill platform={a.platform} />
                    <div className="flex-1 min-w-0">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          className="block text-sm font-medium text-text truncate hover:underline">
                          {a.display_name || a.username || a.platform}
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-text truncate">{a.display_name || a.username || a.platform}</p>
                      )}
                      {a.username && <p className="text-xs text-text-tertiary truncate">@{a.username}</p>}
                    </div>
                    <div className="text-sm text-text-secondary">{fmt(a.followers_count || 0)} followers</div>
                    {a.needs_reconnection
                      ? <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-red-50 text-red-600 uppercase tracking-[0.08em]">Reconnect needed</span>
                      : <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-sage-100 text-sage-800 uppercase tracking-[0.08em]">Connected</span>}
                    {active && <span className="text-[10px] font-semibold text-amber-700">Viewing</span>}
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="text-[11px] font-semibold text-amber-700 hover:underline">Open ↗</a>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
