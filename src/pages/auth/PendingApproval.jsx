import { useAuth } from '../../store/auth'
import { AuthLayout, AuthButton, PALETTE } from './AuthLayout'
import { useT } from '../../lib/i18n'
import { AW } from './words'

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
  const { t } = useT(AW)

  return (
    <AuthLayout
      eyebrow={revoked ? t.noAccess : t.waiting}
      title={revoked ? t.removed : t.requested}
      subtitle=""
    >
      <div className="space-y-5">
        <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
          {revoked ? (
            <>
              {t.theAccount}{' '}
              <span className="font-semibold" style={{ color: PALETTE.carbon }} dir="ltr">{user?.email}</span>{' '}
              {t.revokedB}
            </>
          ) : (
            <>
              {t.yourRequest}{' '}
              <span className="font-semibold" style={{ color: PALETTE.carbon }} dir="ltr">{user?.email}</span>{' '}
              {t.pendingB}
            </>
          )}
        </p>

        {!revoked && (
          <div className="border px-4 py-3" style={{ borderColor: PALETTE.powder, background: '#fff' }}>
            <p className="text-xs leading-relaxed" style={{ color: PALETTE.slate }}>
              {t.alreadyApproved}
            </p>
          </div>
        )}

        {!revoked && (
          <AuthButton onClick={() => refreshWorkspaces()}>{t.checkAgain}</AuthButton>
        )}

        <button
          onClick={() => signOut()}
          className="w-full py-2.5 text-sm font-semibold border transition-colors hover:bg-white"
          style={{ borderColor: PALETTE.powder, color: PALETTE.slate }}
        >
          {t.signOut}
        </button>
      </div>
    </AuthLayout>
  )
}
