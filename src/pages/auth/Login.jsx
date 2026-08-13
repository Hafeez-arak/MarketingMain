import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await signIn({ email: email.trim(), password })
    setLoading(false)
    if (error) { setError(error.message); return }
    navigate(from, { replace: true })
  }

  return (
    <AuthLayout eyebrow="Welcome back" title="Sign in" subtitle="Pick up where your workspace left off.">
      <form onSubmit={handleSubmit}>
        <AuthInput
          label="Email" type="email" autoComplete="email" required
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <AuthInput
          label="Password" type="password" autoComplete="current-password" required
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        {error && (
          <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>
        )}
        <AuthButton type="submit" loading={loading}>Sign in</AuthButton>
      </form>
      <p className="text-sm mt-6 text-center" style={{ color: PALETTE.slate }}>
        Don't have an account yet?{' '}
        <Link to="/signup" className="font-semibold" style={{ color: PALETTE.carbon }}>Create one</Link>
      </p>
    </AuthLayout>
  )
}
