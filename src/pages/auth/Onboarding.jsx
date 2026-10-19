import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { createCompany } from '../../lib/access'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'
import { PendingApproval } from './PendingApproval'
import { useT } from '../../lib/i18n'
import { AW } from './words'

// Where an approved person with no company lands. Two different people reach
// it, and they need opposite things:
//
//   - Someone just approved. Approval lets you sign in and gives you no
//     company (20261004_companies_by_assignment), so until the admin ticks
//     one this is simply where they wait. Offering them "create the first
//     company" would be wrong twice: companies do exist, and it would hand a
//     brand-new teammate a blank tenant instead of the one they were hired for.
//   - The admin, when no company exists at all. The admin is joined to every
//     company, so an empty list really does mean there are none to join.
export function Onboarding() {
  const { user, isApproved, isAccessAdmin, workspaces, refreshWorkspaces, signOut } = useAuth()
  const { t } = useT(AW)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!user) return <Navigate to="/login" replace />

  // This route sits outside RequireAuth, so it needs its own gate — otherwise
  // it's a URL a pending user could type to reach a form that only fails at
  // the database.
  if (!isApproved) return <PendingApproval />

  if (workspaces.length > 0) return <Navigate to="/" replace />

  if (!isAccessAdmin) {
    return (
      <AuthLayout eyebrow={t.almostThere} title={t.noCompanies} subtitle="">
        <div className="space-y-5">
          <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
            {t.theAccount}{' '}
            <span className="font-semibold" style={{ color: PALETTE.carbon }} dir="ltr">{user?.email}</span>{' '}
            {t.noCompanyB}
          </p>
          <div className="border px-4 py-3" style={{ borderColor: PALETTE.powder, background: '#fff' }}>
            <p className="text-xs leading-relaxed" style={{ color: PALETTE.slate }}>
              {t.alreadyGiven}
            </p>
          </div>
          <AuthButton onClick={() => refreshWorkspaces()}>{t.checkAgain}</AuthButton>
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    // create_company() checks approval and inserts the company; its roster
    // trigger joins the administrators, which is this caller.
    const { error: createError } = await createCompany(name.trim() || 'My Company')
    if (createError) { setError(createError); setLoading(false); return }
    await refreshWorkspaces()
    setLoading(false)
  }

  return (
    <AuthLayout
      eyebrow={t.oneMore}
      title={t.createFirst}
      subtitle={t.createFirstSub}
    >
      <form onSubmit={handleSubmit}>
        <AuthInput
          label={t.companyName} type="text" required autoFocus dir="auto"
          value={name} onChange={e => setName(e.target.value)}
          placeholder={t.companyPh}
        />
        {error && (
          <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>
        )}
        <AuthButton type="submit" loading={loading}>{t.continue}</AuthButton>
      </form>
    </AuthLayout>
  )
}
