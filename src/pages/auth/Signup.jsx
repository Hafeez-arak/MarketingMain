import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'
import { ACCESS_ADMIN_EMAIL } from '../../lib/access'

// Signing up no longer creates anything. It files an access request that
// {ACCESS_ADMIN_EMAIL} approves — so the copy here promises a request, not a
// workspace. The old version asked for a workspace name and told people
// their workspace was ready; both were true then and would be lies now.
export function Signup() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error } = await signUp({ email: email.trim(), password, fullName: fullName.trim() })
    setLoading(false)
    if (error) { setError(error.message); return }
    // Email confirmation on: no session yet, so tell them to check their
    // inbox. Off: they get a session and land on the pending screen, which
    // RequireAuth renders for them at "/".
    if (!data?.session) { setConfirmSent(true); return }
    navigate('/', { replace: true })
  }

  if (confirmSent) {
    return (
      <AuthLayout eyebrow="Almost there" title="Check your email" subtitle="">
        <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
          We sent a confirmation link to <span className="font-semibold" style={{ color: PALETTE.carbon }}>{email}</span>.
          Confirm it, then sign in — your access request goes to{' '}
          <span className="font-semibold" style={{ color: PALETTE.carbon }}>{ACCESS_ADMIN_EMAIL}</span> for approval.
        </p>
        <Link to="/login" className="inline-block mt-6 text-sm font-semibold" style={{ color: PALETTE.carbon }}>
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      eyebrow="Get started"
      title="Request access"
      subtitle={`Creating an account sends a request to ${ACCESS_ADMIN_EMAIL}. Once approved, you get every company with the same full access as the rest of the team.`}
    >
      <form onSubmit={handleSubmit}>
        <AuthInput
          label="Full name" type="text"
          value={fullName} onChange={e => setFullName(e.target.value)}
          placeholder="e.g. Sara Ahmed"
        />
        <AuthInput
          label="Email" type="email" autoComplete="email" required
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <AuthInput
          label="Password" type="password" autoComplete="new-password" required minLength={8}
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
        {error && (
          <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>
        )}
        <AuthButton type="submit" loading={loading}>Request access</AuthButton>
      </form>
      <p className="text-sm mt-6 text-center" style={{ color: PALETTE.slate }}>
        Already have an account?{' '}
        <Link to="/login" className="font-semibold" style={{ color: PALETTE.carbon }}>Sign in</Link>
      </p>
    </AuthLayout>
  )
}
