import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'
import { useT } from '../../lib/i18n'
import { AW } from './words'

export function Login() {
  const { signIn } = useAuth()
  const { t } = useT(AW)
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
    <AuthLayout eyebrow={t.welcome} title={t.signIn} subtitle={t.signInSub}>
      <form onSubmit={handleSubmit}>
        <AuthInput
          label={t.email} type="email" autoComplete="email" required dir="ltr"
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder={t.emailPh}
        />
        <AuthInput
          label={t.password} type="password" autoComplete="current-password" required dir="ltr"
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <p className="text-xs -mt-2 mb-4 text-end">
          <Link to="/reset-password" className="font-semibold" style={{ color: PALETTE.slate }}>{t.forgot}</Link>
        </p>
        {error && (
          <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>
        )}
        <AuthButton type="submit" loading={loading}>{t.signIn}</AuthButton>
      </form>
      <p className="text-sm mt-6 text-center" style={{ color: PALETTE.slate }}>
        {t.noAccount}{' '}
        <Link to="/signup" className="font-semibold" style={{ color: PALETTE.carbon }}>{t.createOne}</Link>
      </p>
    </AuthLayout>
  )
}
