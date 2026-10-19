import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { AuthLayout, AuthInput, AuthButton, PALETTE } from './AuthLayout'
import { useT } from '../../lib/i18n'
import { AW } from './words'

// ─── Forgotten password ────────────────────────────────────────────────────
// Two halves on one page, because Supabase's emailed link comes back here:
//
//   1. No recovery session yet: ask for the email and send the link.
//   2. Arrived from that link: the client has already traded the token in the
//      URL for a session (detectSessionInUrl) and fired PASSWORD_RECOVERY, so
//      the person is signed in for exactly one purpose — choosing a new
//      password — and the form says so.
//
// The send step answers the same way whether or not the address has an
// account. Saying "no such user" would tell anyone who types an address
// whether that person works here.

// Read when this module is first evaluated, which is before the Supabase
// client finishes its async start-up and strips the token from the URL. By
// the time the page mounts the hash may already be gone, and the
// PASSWORD_RECOVERY event may already have fired before we subscribed.
const ARRIVED_FROM_LINK = typeof window !== 'undefined' &&
  (/type=recovery/.test(window.location.hash) || /[?&]code=/.test(window.location.search))

export function ResetPassword() {
  const navigate = useNavigate()
  const { t } = useT(AW)
  const [recovering, setRecovering] = useState(ARRIVED_FROM_LINK)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // The link's token lands in the URL hash (or as ?code= with PKCE). The
    // client trades it for a session and announces PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => sub?.subscription?.unsubscribe()
  }, [])

  async function sendLink(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    // A rate-limit is the one error worth showing: it is about this browser,
    // not about whether the account exists.
    if (err && /rate|seconds/i.test(err.message)) { setError(err.message); return }
    setSent(true)
  }

  async function savePassword(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError(t.tooShort); return }
    if (password !== confirm) { setError(t.noMatch); return }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) { setError(err.message); return }
    navigate('/', { replace: true })
  }

  if (recovering) {
    return (
      <AuthLayout eyebrow={t.resetEyebrow} title={t.chooseNew} subtitle={t.staySignedIn}>
        <form onSubmit={savePassword}>
          <AuthInput label={t.newPassword} type="password" autoComplete="new-password" required dir="ltr"
            value={password} onChange={e => setPassword(e.target.value)} placeholder={t.atLeast8} />
          <AuthInput label={t.typeAgain} type="password" autoComplete="new-password" required dir="ltr"
            value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
          {error && <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>}
          <AuthButton type="submit" loading={loading}>{t.savePassword}</AuthButton>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout eyebrow={t.resetEyebrow} title={t.forgotTitle} subtitle={t.forgotSub}>
      {sent ? (
        <p className="text-sm leading-relaxed" style={{ color: PALETTE.slate }}>
          {t.sentA} <strong style={{ color: PALETTE.carbon }} dir="ltr">{email.trim()}</strong> {t.sentB}
        </p>
      ) : (
        <form onSubmit={sendLink}>
          <AuthInput label={t.email} type="email" autoComplete="email" required dir="ltr"
            value={email} onChange={e => setEmail(e.target.value)} placeholder={t.emailPh} />
          {error && <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>}
          <AuthButton type="submit" loading={loading}>{t.sendLink}</AuthButton>
        </form>
      )}
      <p className="text-sm mt-6 text-center" style={{ color: PALETTE.slate }}>
        <Link to="/login" className="font-semibold" style={{ color: PALETTE.carbon }}>{t.backToSignIn}</Link>
      </p>
    </AuthLayout>
  )
}
