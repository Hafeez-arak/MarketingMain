import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { createCompany } from '../../lib/access'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'
import { PendingApproval } from './PendingApproval'

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
      <AuthLayout eyebrow="Almost there" title="No companies yet" subtitle="">
        <div className="space-y-5">
          <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
            The account{' '}
            <span className="font-semibold" style={{ color: PALETTE.carbon }}>{user?.email}</span>{' '}
            is approved, but no company has been given to it yet. Ask your
            administrator which ones you should see.
          </p>
          <div className="border px-4 py-3" style={{ borderColor: PALETTE.powder, background: '#fff' }}>
            <p className="text-xs leading-relaxed" style={{ color: PALETTE.slate }}>
              Already been given one? Check again — this page doesn't poll, so a
              change made a minute ago won't appear on its own.
            </p>
          </div>
          <AuthButton onClick={() => refreshWorkspaces()}>Check again</AuthButton>
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
      eyebrow="One more step"
      title="Create the first company"
      subtitle="There are no companies yet. Only administrators will see this one until you give it to someone under Team & Access."
    >
      <form onSubmit={handleSubmit}>
        <AuthInput
          label="Company name" type="text" required autoFocus
          value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Arak Lighting"
        />
        {error && (
          <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>
        )}
        <AuthButton type="submit" loading={loading}>Continue</AuthButton>
      </form>
    </AuthLayout>
  )
}
