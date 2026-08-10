import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'

export function Signup() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [workspaceName, setWorkspaceName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error } = await signUp({ email: email.trim(), password, workspaceName: workspaceName.trim() })
    setLoading(false)
    if (error) { setError(error.message); return }
    // If email confirmation is required, there's no session yet — show a
    // "check your inbox" state instead of bouncing to a blank dashboard.
    if (!data?.session) { setConfirmSent(true); return }
    navigate('/', { replace: true })
  }

  if (confirmSent) {
    return (
      <AuthLayout eyebrow="Almost there" title="Check your email" subtitle="">
        <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
          We sent a confirmation link to <span className="font-semibold" style={{ color: PALETTE.carbon }}>{email}</span>.
          Click it to activate your workspace, then come back and sign in.
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
      title="Create your workspace"
      subtitle="A KSA email (@arak-sa.com) joins the existing Arak Lighting workspace automatically — anyone else gets a brand new, private one."
    >
      <form onSubmit={handleSubmit}>
        <AuthInput
          label="Workspace name" type="text"
          value={workspaceName} onChange={e => setWorkspaceName(e.target.value)}
          placeholder="e.g. Arak Lighting"
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
        <AuthButton type="submit" loading={loading}>Create workspace</AuthButton>
      </form>
      <p className="text-sm mt-6 text-center" style={{ color: PALETTE.slate }}>
        Already have an account?{' '}
        <Link to="/login" className="font-semibold" style={{ color: PALETTE.carbon }}>Sign in</Link>
      </p>
    </AuthLayout>
  )
}
