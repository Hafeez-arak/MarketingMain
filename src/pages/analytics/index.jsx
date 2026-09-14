import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, PlatformPill, Spinner, IconBadge, PillSelect, PageHeader } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { syncZernio } from '../../lib/zernio'
import { profileUrlOf } from '../../lib/socialAnalytics'
import { defaultWebhookUrl } from '../../lib/n8nWebhooks'
import { LIVE_PLATFORMS, PLATFORM_META } from '../../lib/utils'
import { syncAccounts, describeSync } from '../../lib/zernioConnect'
import { useConnectedAccounts, publishConnectedAccounts } from '../../lib/useConnectedAccounts'
import { AccountAnalytics } from '../../components/social/AccountAnalytics'
import { DashboardSkeleton } from './Dashboard'
import { fmt } from './format'

// ─── Analytics ───────────────────────────────────────────────────────────
// Every connected account's numbers, one account at a time. The graphs are
// AccountAnalytics — the same component as each platform page's Analytics
// tab — so this page reads through /api/zernio/analytics, which checks the
// account belongs to this workspace. It used to read through the n8n Zernio
// Dashboard workflow, which took account_id on trust, went through the box's
// tunnel, and offered Instagram as the only platform to pick.
//
// Zernio's analytics endpoints are team-wide, so every read names one account;
// with nothing connected there is nothing to ask for, and no call is made.

export function Analytics() {
  const { state } = useApp()
  const { activeWorkspaceId } = useAuth()
  const navigate = useNavigate()
  const { allAccounts, loading } = useConnectedAccounts()

  const [platform, setPlatform] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  // Platforms with an account, in the app's usual order.
  const platforms = LIVE_PLATFORMS.filter(p => allAccounts.some(a => a.platform === p))
  const chosen = platforms.includes(platform) ? platform : (platforms[0] || '')
  const scoped = allAccounts.filter(a => a.platform === chosen)

  // Refresh does two things, and waits for only one of them.
  //
  // It asks Zernio to re-read every account from its platform now, then reloads
  // the numbers on screen — before, it only ran the n8n sync and re-read
  // Zernio's copy, which Zernio itself refreshes at most every ~90 minutes, so
  // the page came back unchanged.
  //
  // The n8n Zernio Sync still runs alongside, because it writes the stored copy
  // (post_analytics) the assistant reads. It is slower and goes through the
  // box, so the page does not wait for it; only its failure is reported.
  async function handleSync() {
    setSyncing(true)
    setNote('')
    const stored = syncZernio(state.webhooks?.zernioSync || defaultWebhookUrl('zernioSync'), activeWorkspaceId)
    const live = await syncAccounts(activeWorkspaceId)
    if (live.error) {
      setNote(live.error)
    } else {
      publishConnectedAccounts(activeWorkspaceId, live.accounts)
      setNote(`${describeSync(live.synced)} Reach and impressions can still lag the platform by up to 48 hours.`)
    }
    setReloadKey(k => k + 1)
    setSyncing(false)

    const result = await stored
    if (result?.error) {
      setNote(n => `${n} The stored copy the assistant reads did not update: ${result.error}`.trim())
    }
  }

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Analytics" subtitle="Real performance pulled live from your connected accounts.">
        {(loading || allAccounts.length > 0) && (
          <div className="text-right">
            <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing || loading}>
              {syncing ? <><Spinner size="sm" /> Refreshing…</> : 'Refresh from Zernio'}
            </Button>
          </div>
        )}
      </PageHeader>
      {note && <p className="text-xs text-text-secondary -mt-2 text-right">{note}</p>}

      {loading ? (
        <DashboardSkeleton />
      ) : allAccounts.length === 0 ? (
        <Card className="p-6 border-dashed bg-surface-muted">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 border border-amber-200 bg-amber-50 flex items-center justify-center text-amber-700 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-text mb-1">No connected accounts yet</h3>
              <p className="text-sm text-text-secondary mb-3">
                Connect an account on the Social Media page, and its reach, engagement and follower numbers will show here.
              </p>
              <Button onClick={() => navigate('/social')}>Connect an account</Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {platforms.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <PillSelect value={chosen} onChange={e => setPlatform(e.target.value)} className="w-36">
                {platforms.map(p => <option key={p} value={p}>{PLATFORM_META[p]?.label || p}</option>)}
              </PillSelect>
            </div>
          )}

          {/* Keyed on the platform so the account picked inside does not
              carry over to a platform it does not belong to. */}
          <AccountAnalytics key={chosen} platform={chosen} accounts={scoped}
            refreshable={false} reloadKey={reloadKey} />

          {/* Connected accounts — always shown regardless of dashboard state */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
              <IconBadge>{Icon.users}</IconBadge>
              <div>
                <h3 className="font-semibold text-text text-sm">Connected accounts</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Managed on each platform's page — reconnect there if access expires</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              {allAccounts.map(a => {
                // Picking a row switches the platform shown above, which only
                // means something when there is another platform to switch to.
                const choosable = platforms.length > 1
                const active = choosable && chosen === a.platform
                const url = profileUrlOf(a)
                return (
                  <div key={a.zernio_account_id}
                    onClick={choosable ? () => setPlatform(a.platform) : undefined}
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
                      {a.account_type === 'organization'
                        ? <p className="text-xs text-text-tertiary truncate">Company page</p>
                        : a.username && <p className="text-xs text-text-tertiary truncate">@{a.username}</p>}
                    </div>
                    {/* null is "not counted yet", not zero. Zernio leaves
                        followersCount null until a follower snapshot lands,
                        and printing that as "0 followers" is a number the
                        page invented. */}
                    <div className="text-sm text-text-secondary">
                      {a.followers_count === null || a.followers_count === undefined
                        ? <span title="Zernio has not recorded a follower snapshot for this account yet.">— followers</span>
                        : `${fmt(a.followers_count)} followers`}
                    </div>
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
