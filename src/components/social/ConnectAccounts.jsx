import { useState } from 'react'
import { Button, Modal, Spinner, ConfirmDialog, Avatar } from '../ui/index'
import { PLATFORM_META, isLivePlatform } from '../../lib/utils'
import { tokenAge, TOKEN_LIFETIME_DAYS, supportsCatalogAudio } from '../../lib/zernioConnect'
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

// Instagram accounts connected before we started asking for Facebook access
// cannot attach catalog audio to Reels — Instagram refuses with
// `instagram_audio_requires_facebook_login`. Everything else about them works
// identically, so this is an invitation rather than a warning: publishing,
// analytics and comments are unaffected, and reconnecting is opt-in per
// account rather than forced.
function AudioUpgradeNotice({ account }) {
  if (account.platform !== 'instagram') return null
  if (supportsCatalogAudio(account)) return null
  if (account.needs_reconnection === true || account.is_active === false) return null
  return (
    <p className="text-xs text-text-tertiary mt-0.5">
      Reconnect to enable catalog audio on Reels. Everything else keeps working as it is.
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
          {/* LinkedIn is the one platform where an account's identity is not
              implied by its handle: the same person's personal profile and the
              company page they administer both connect here, and posting as
              the wrong one is not recoverable after the fact. */}
          {account.account_type === 'organization' && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.08em] bg-sky-50 text-sky-700 px-1.5 py-0.5">
              Company page
            </span>
          )}
        </p>
        {needsReconnect
          ? <p className="text-xs text-red-600 mt-0.5">Needs reconnecting — publishing will fail until it is.</p>
          : <><TokenNotice account={account} /><AudioUpgradeNotice account={account} /></>}
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
// The Instagram second step: choose which Facebook Page (and the Instagram
// account behind it) to publish as.
//
// `loading` and `loaded` are separate on purpose. "Fetching" and "fetched but
// nothing eligible" are different states, and collapsing them into one
// spinner is what left the first live connect spinning with no way out. While
// fetching → spinner; loaded and empty → an explanation; loaded with options →
// the list; finishing → a spinner on the chosen row.
const SELECTION_INTRO = {
  instagram: 'Choose which account to publish as. It must be a professional (Business or Creator) Instagram account linked to a Facebook Page.',
  linkedin:  'Choose what to publish as: your own profile, or a company page you administer.',
}

const NOTHING_ELIGIBLE = {
  instagram: 'Instagram only exposes professional (Business or Creator) accounts that are linked to a Facebook Page. A personal account will not appear here — convert it in the Instagram app, then reconnect.',
  linkedin:  'LinkedIn returned neither your profile nor any company page. That usually means the authorisation was granted without the posting permissions — start again and accept all of them.',
}

function SelectionModal({ open, platform, options, loading, finishing, onPick, onCancel }) {
  const label = PLATFORM_META[platform]?.label || platform
  // LinkedIn always offers the personal profile, so a list of exactly that
  // means no company page came back. Saying so is the difference between "pick
  // one" and "the page you were expecting is missing, and here is why".
  const onlyPersonal = platform === 'linkedin'
    && options.length === 1 && options[0]?.kind === 'personal'

  return (
    <Modal open={open} onClose={onCancel} title={`Finish connecting ${label}`} width="max-w-md">
      <p className="text-sm text-text-secondary mb-4">
        {SELECTION_INTRO[platform] || 'Choose which profile to publish as.'}
      </p>

      {onlyPersonal && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-3 mb-3">
          No company page came back — only your personal profile. LinkedIn lists a
          page here only if you are one of its admins. Connect your profile if that
          is what you meant, or get admin access to the page and start again.
        </p>
      )}

      {loading && (
        <div className="py-10 flex flex-col items-center gap-2 text-text-secondary">
          <Spinner />
          <span className="text-xs">Loading your accounts…</span>
        </div>
      )}

      {!loading && options.length === 0 && (
        <div className="py-6 px-4 border border-border bg-surface-subtle/50 text-center">
          <p className="text-sm text-text mb-1">No eligible accounts came back.</p>
          <p className="text-xs text-text-secondary">
            {NOTHING_ELIGIBLE[platform] || `${label} returned nothing this workspace can publish as.`}
          </p>
        </div>
      )}

      {!loading && options.length > 0 && (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {options.map(opt => {
            // One shape, guaranteed by the server: every platform's list is
            // normalised in api/zernio/_zernio.js before it reaches here, so
            // this does not have to know that Instagram calls them pages and
            // LinkedIn calls them organizations.
            const id   = opt.id
            const name = opt.name || opt.username || id
            const sub  = opt.subtitle || (opt.username && opt.username !== name ? `@${opt.username}` : '')
            return (
              <button key={id} onClick={() => onPick(opt)} disabled={finishing}
                className="w-full text-left flex items-center gap-3 p-3 border border-border hover:border-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50">
                {opt.picture
                  ? <img src={opt.picture} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                  : <Avatar name={name} size="sm" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text truncate">{name}</p>
                  {sub && <p className="text-xs text-text-tertiary truncate">{sub}</p>}
                </div>
                {finishing
                  ? <Spinner size="sm" />
                  : <span className="text-text-tertiary text-lg leading-none">›</span>}
              </button>
            )
          })}
        </div>
      )}
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

  // Zernio replaces rather than adds for Instagram: one Instagram account per
  // profile, and picking a different identity purges the previous account's
  // conversations, external posts and stats. A button that says "Connect
  // another Instagram account" is therefore promising something that cannot
  // happen — what it actually does is swap.
  const oneOnly = platform === 'instagram'

  return (
    <>
      {problem && (
        <p className="text-sm text-red-600 mb-3">{problem}</p>
      )}

      {/* The other half of the round trip. Success used to be silent: the URL
          carried `connected=tiktok&username=…` and nothing read it, so a
          finished connection looked the same as a button that did nothing. */}
      {!problem && flow.notice && (
        <div className="flex items-start gap-2 mb-3 text-sm text-sage-700 bg-sage-100 border border-sage-200 px-3 py-2">
          <span className="flex-1">{flow.notice}</span>
          <button onClick={flow.dismissNotice}
            className="text-xs text-sage-700/70 hover:text-sage-700 shrink-0">Dismiss</button>
        </div>
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
            : !accounts.length ? `Connect ${meta.label}`
            : oneOnly ? `Replace the connected ${meta.label} account`
            : `Connect another ${meta.label} account`}
        </Button>
        {oneOnly && accounts.length > 0 && (
          <p className="text-xs text-text-tertiary mt-1.5">
            Instagram allows one account per workspace. Connecting a different one
            replaces this account and discards its conversations and stats here.
          </p>
        )}
      </div>

      <SelectionModal
        open={flow.phase === 'selecting' || flow.phase === 'finishing'}
        platform={platform}
        options={flow.options}
        loading={!flow.loaded && flow.phase === 'selecting'}
        finishing={flow.phase === 'finishing'}
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
