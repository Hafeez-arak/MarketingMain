import { useAuth } from '../../store/auth'
import { AuthLayout, AuthButton, PALETTE } from './AuthLayout'
import { ACCESS_ADMIN_EMAIL } from '../../lib/access'

// Where a signed-in but not-yet-approved person lands. Two states share this
// screen because they need the same thing from the reader — wait, or ask a
// human — and differ only in tone. The account exists and the password
// works; what's missing is a decision by the admin.
//
// Nothing here fetches workspace data, and there's no "try anyway" link,
// because there is nothing to try: without workspace_members rows, RLS
// returns this user zero rows from every table in the database.
export function PendingApproval() {
  const { user, accessStatus, signOut, refreshWorkspaces } = useAuth()
  const revoked = accessStatus === 'revoked'

  return (
    <AuthLayout
      eyebrow={revoked ? 'No access' : 'Waiting on approval'}
      title={revoked ? 'Your access was removed' : 'Access requested'}
      subtitle=""
    >
      <div className="space-y-5">
        <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
          {revoked ? (
            <>
              The account{' '}
              <span className="font-semibold" style={{ color: PALETTE.carbon }}>{user?.email}</span>{' '}
              no longer has access to the workspaces. If this is a mistake, ask{' '}
              <span className="font-semibold" style={{ color: PALETTE.carbon }}>{ACCESS_ADMIN_EMAIL}</span>{' '}
              to restore it.
            </>
          ) : (
            <>
              We've sent a request for{' '}
              <span className="font-semibold" style={{ color: PALETTE.carbon }}>{user?.email}</span>{' '}
              to{' '}
              <span className="font-semibold" style={{ color: PALETTE.carbon }}>{ACCESS_ADMIN_EMAIL}</span>.
              Once it's approved you'll have access to every company in the
              workspace — nothing else to set up.
            </>
          )}
        </p>

        {!revoked && (
          <div className="border px-4 py-3" style={{ borderColor: PALETTE.powder, background: '#fff' }}>
            <p className="text-xs leading-relaxed" style={{ color: PALETTE.slate }}>
              Already been approved? Check again — this page doesn't poll, so a
              decision made a minute ago won't appear on its own.
            </p>
          </div>
        )}

        {!revoked && (
          <AuthButton onClick={() => refreshWorkspaces()}>Check again</AuthButton>
        )}

        <button
          onClick={() => signOut()}
          className="w-full py-2.5 text-sm font-semibold border transition-colors hover:bg-white"
          style={{ borderColor: PALETTE.powder, color: PALETTE.slate }}
        >
          Sign out
        </button>
      </div>
    </AuthLayout>
  )
}
