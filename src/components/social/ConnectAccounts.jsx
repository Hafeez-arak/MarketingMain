import { useState } from 'react'
import { Button, Modal, Spinner, ConfirmDialog, Avatar } from '../ui/index'
import { PLATFORM_META, isLivePlatform } from '../../lib/utils'
import { tokenAge, TOKEN_LIFETIME_DAYS } from '../../lib/zernioConnect'
import { useConnectFlow, useDisconnect } from '../../lib/useConnectedAccounts'

// ─── Connected accounts, for one platform ──────────────────────────────────
// Used by the social hub and by each platform page, so "connected" looks and
// behaves the same everywhere. Every state here is a real state of the OAuth
// flow rather than a spinner standing in for all of them.

function TokenNotice({ account }) {
  const age = tokenAge(account)
  if (!age.known || (!age.expiringSoon && !age.expired)) return null
  return (
    <p className={`text-xs mt-0.5 ${age.expired ? 'text-red-600' : 'text-amber-700'}`}>
      {age.expired
        ? `Access expired after ${TOKEN_LIFETIME_DAYS} days — reconnect to keep publishing.`
        : `Access expires in ${TOKEN_LIFETIME_DAYS - age.days} day${TOKEN_LIFETIME_DAYS - age.days === 1 ? '' : 's'}.`}
    </p>
  )
}

function AccountRow({ account, onDisconnect, disconnecting }) {
  const needsReconnect = account.needs_reconnection === true || account.is_active === false
  return (
    <div className="flex items-center gap-3 py-3">
      {account.profile_picture
        ? <img src={account.profile_picture} alt="" className="w-9 h-9 rounded-full object-cover border border-border" />
        : <Avatar name={account.username || account.display_name || '?'} size="sm" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text truncate">
          {account.username ? `@${account.username}` : (account.display_name || 'Connected account')}
        </p>
        {needsReconnect
          ? <p className="text-xs text-red-600 mt-0.5">Needs reconnecting — publishing will fail until it is.</p>
          : <TokenNotice account={account} />}
      </div>
      <Button variant="ghost" size="xs" disabled={disconnecting}
        onClick={() => onDisconnect(account)}>
        {disconnecting ? 'Removing…' : 'Disconnect'}
      </Button>
    </div>
  )
}

// The Instagram second step. Zernio hands back a tempToken and the list of
// Facebook pages the account can publish as; until one is chosen the
// connection does not exist. Rendering it here rather than sending the user to
// Zernio's own hosted picker is the whole reason the flow asks for headless.
function SelectionModal({ open, platform, options, busy, onPick, onCancel }) {
  const label = PLATFORM_META[platform]?.label || platform
  return (
    <Modal open={open} onClose={onCancel} title={`Finish connecting ${label}`}>
      <p className="text-sm text-text-secondary mb-4">
        {platform === 'instagram'
          ? 'Choose which Instagram account to publish as. It has to be a professional (Business or Creator) account linked to a Facebook Page.'
          : 'Choose which profile to publish as.'}
      </p>
      {busy && <div className="py-6 flex justify-center"><Spinner /></div>}
      {!busy && options.length === 0 && (
        <p className="text-sm text-text-secondary">
          No eligible accounts came back. Instagram only exposes professional accounts
          linked to a Facebook Page — a personal account will not appear here.
        </p>
      )}
      {!busy && options.map(opt => {
        const id   = opt.id || opt._id || opt.pageId || opt.value
        const name = opt.name || opt.username || opt.label || id
        return (
          <button key={id} onClick={() => onPick(opt)}
            className="w-full text-left flex items-center gap-3 p-3 border border-border hover:bg-surface-subtle transition-colors mb-2">
            {opt.picture
              ? <img src={opt.picture} alt="" className="w-8 h-8 rounded-full object-cover" />
              : <Avatar name={name} size="sm" />}
            <span className="text-sm font-medium text-text">{name}</span>
          </button>
        )
      })}
    </Modal>
  )
}

export function ConnectAccounts({ platform, accounts, loading, error, refresh, compact = false }) {
  const meta = PLATFORM_META[platform] || {}
  const live = isLivePlatform(platform)
  const flow = useConnectFlow(platform, { onConnected: refresh })
  const { disconnect, busyId, error: disconnectError } = useDisconnect(refresh)
  const [confirming, setConfirming] = useState(null)

  if (!live) {
    return (
      <p className="text-sm text-text-secondary">
        {meta.label} is not available for connecting yet.
      </p>
    )
  }

  const problem = error || flow.error || disconnectError

  return (
    <>
      {problem && (
        <p className="text-sm text-red-600 mb-3">{problem}</p>
      )}

      {loading && accounts.length === 0 && (
        <div className="py-4 flex justify-center"><Spinner size="sm" /></div>
      )}

      {accounts.length > 0 && (
        <div className="divide-y divide-border">
          {accounts.map(a => (
            <AccountRow key={a.zernio_account_id || a.id} account={a}
              disconnecting={busyId === a.zernio_account_id}
              onDisconnect={setConfirming} />
          ))}
        </div>
      )}

      {!loading && accounts.length === 0 && !compact && (
        <p className="text-sm text-text-secondary mb-3">
          No {meta.label} account connected to this workspace yet.
        </p>
      )}

      <div className="mt-3">
        <Button variant={accounts.length ? 'outline' : 'primary'} size="sm"
          disabled={flow.phase === 'starting'}
          onClick={flow.start}>
          {flow.phase === 'starting'
            ? 'Opening…'
            : accounts.length ? `Connect another ${meta.label} account` : `Connect ${meta.label}`}
        </Button>
      </div>

      <SelectionModal
        open={flow.phase === 'selecting' || flow.phase === 'finishing'}
        platform={platform}
        options={flow.options}
        busy={flow.phase === 'finishing' || (flow.phase === 'selecting' && flow.options.length === 0 && !flow.error)}
        onPick={flow.finish}
        onCancel={flow.cancel}
      />

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={async () => { const a = confirming; setConfirming(null); await disconnect(a.zernio_account_id) }}
        danger
        title={`Disconnect ${confirming?.username ? '@' + confirming.username : 'this account'}?`}
        message={
          'Scheduled posts targeting this account will stop publishing. ' +
          'Reconnecting means authorising again on the platform — it is not just a toggle.'
        }
      />
    </>
  )
}

export { AccountRow }
