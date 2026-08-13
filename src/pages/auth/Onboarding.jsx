import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { supabase } from '../../lib/supabaseClient'
import { AuthLayout, AuthInput, AuthButton } from './AuthLayout'
import { PendingApproval } from './PendingApproval'

// Reachable in one situation only: an approved person signs in and there are
// no companies at all, because every one of them was deleted. Approval joins
// you to all existing companies, so "approved with an empty list" can't
// happen any other way.
export function Onboarding() {
  const { user, isApproved, workspaces, refreshWorkspaces } = useAuth()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!user) return <Navigate to="/login" replace />

  // This route sits outside RequireAuth, so it needs its own gate — otherwise
  // it's a URL a pending user could type to reach a form that only fails at
  // the database.
  if (!isApproved) return <PendingApproval />

  if (workspaces.length > 0) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    // create_company() checks approval, inserts the company, and lets the
    // roster trigger add every approved member — including this caller.
    // The old code inserted the workspace and its own membership row by
    // hand, which now collides with the trigger on the primary key.
    const { error: rpcError } = await supabase
      .rpc('create_company', { company_name: name.trim() || 'My Company' })
    if (rpcError) { setError(rpcError.message); setLoading(false); return }
    await refreshWorkspaces()
    setLoading(false)
  }

  return (
    <AuthLayout
      eyebrow="One more step"
      title="Create the first company"
      subtitle="There are no companies yet. Everyone on the team will get access to this one automatically."
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
