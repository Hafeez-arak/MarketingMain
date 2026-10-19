import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'
import { useT } from '../../lib/i18n'
import { AW } from './words'

// Signing up no longer creates anything. It files an access request that an
// administrator approves — so the copy here promises a request, not a
// workspace. The old version asked for a workspace name and told people
// their workspace was ready; both were true then and would be lies now.
//
// Who the admin is stays unnamed. This page is reachable by anyone with the
// URL, and printing an address on it is free reconnaissance for whoever
// wants to phish or pester the one account that can grant access.
export function Signup() {
  const { signUp } = useAuth()
  const { t } = useT(AW)
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
      <AuthLayout eyebrow={t.almostThere} title={t.checkEmail} subtitle="">
        <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
          {t.sentConfirmA} <span className="font-semibold" style={{ color: PALETTE.carbon }} dir="ltr">{email}</span>.
          {' '}{t.sentConfirmB}
        </p>
        <Link to="/login" className="inline-block mt-6 text-sm font-semibold" style={{ color: PALETTE.carbon }}>
          {t.backToSignIn}
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      eyebrow={t.getStarted}
      title={t.requestAccess}
      subtitle={t.requestSub}
    >
      <form onSubmit={handleSubmit}>
        <AuthInput
          label={t.fullName} type="text" dir="auto"
          value={fullName} onChange={e => setFullName(e.target.value)}
          placeholder={t.fullNamePh}
        />
        <AuthInput
          label={t.email} type="email" autoComplete="email" required dir="ltr"
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder={t.emailPh}
        />
        <AuthInput
          label={t.password} type="password" autoComplete="new-password" required minLength={8} dir="ltr"
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder={t.atLeast8}
        />
        {error && (
          <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>
        )}
        <AuthButton type="submit" loading={loading}>{t.requestAccess}</AuthButton>
      </form>
      <p className="text-sm mt-6 text-center" style={{ color: PALETTE.slate }}>
        {t.haveAccount}{' '}
        <Link to="/login" className="font-semibold" style={{ color: PALETTE.carbon }}>{t.signIn}</Link>
      </p>
    </AuthLayout>
  )
}
