import { useNavigate } from 'react-router-dom'
import { Modal } from '../../components/ui/index'
import { LIVE_PLATFORMS, PLATFORM_META } from '../../lib/utils'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'

// ─── "Create post" asks which platform first ───────────────────────────────
//
// The header button used to navigate straight to /social/instagram. That was
// true when Instagram was the only place this app could publish; it has not
// been true since LinkedIn came back and TikTok was added, and a button
// labelled "Create post" that silently picks one platform is worse than a
// button labelled "Create Instagram post" would have been.
//
// The list is LIVE_PLATFORMS, so a platform still in beta cannot be picked
// from here and walked into a publish path that will reject it. Whether an
// account is connected is shown but does not gate the choice: each platform's
// page is where connecting happens, so sending someone there with nothing
// connected is the correct next step rather than a dead end.

export function CreatePostDialog({ open, onClose }) {
  const navigate = useNavigate()
  const { allAccounts, loading } = useConnectedAccounts()

  return (
    <Modal open={open} onClose={onClose} title="Create a post" width="max-w-md">
      <div className="p-4 space-y-2">
        {LIVE_PLATFORMS.map(key => {
          const meta = PLATFORM_META[key]
          const accounts = allAccounts.filter(a => a.platform === key && a.is_active !== false)
          const connected = accounts.length > 0
          return (
            <button key={key}
              onClick={() => { onClose?.(); navigate(`/social/${key}`) }}
              className="w-full text-left flex items-center gap-3 px-3 py-3 border border-border
                hover:border-stone-400 hover:bg-surface-subtle transition-colors">
              <span className={`w-9 h-9 flex items-center justify-center text-xs font-bold flex-shrink-0
                ${meta.bg} ${meta.text}`}>{meta.abbr}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text">{meta.label}</span>
                <span className="block text-xs text-text-tertiary truncate">
                  {loading ? 'Checking…'
                    : connected
                      ? accounts.map(a => (a.username ? `@${a.username}` : a.display_name)).filter(Boolean).join(', ')
                      : 'Not connected — connect on the next screen'}
                </span>
              </span>
              <svg className="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" stroke="currentColor"
                strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
