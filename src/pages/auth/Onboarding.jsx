import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { AuthLayout, AuthInput, AuthButton } from './AuthLayout'

export function Onboarding() {
  const { user, workspaces, refreshWorkspaces } = useAuth()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!user) return <Navigate to="/login" replace />

  // Normal path: handle_new_user() already created a workspace at signup.
  // This page only renders if that somehow didn't happen yet.
  if (workspaces.length > 0) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data: ws, error: wsError } = await supabase
      .from('workspaces')
      .insert({ name: name.trim() || 'My Workspace' })
      .select()
      .single()
    if (wsError) { setError(wsError.message); setLoading(false); return }

    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' })
    setLoading(false)
    if (memberError) { setError(memberError.message); return }
    await refreshWorkspaces()
  }

  return (
    <AuthLayout eyebrow="One more step" title="Name your workspace" subtitle="This is what you and your team will see everywhere.">
      <form onSubmit={handleSubmit}>
        <AuthInput
          label="Workspace name" type="text" required autoFocus
          value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Acme Hospitality Group"
        />
        {error && (
          <p className="text-xs mb-4 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">{error}</p>
        )}
        <AuthButton type="submit" loading={loading}>Continue</AuthButton>
      </form>
    </AuthLayout>
  )
}
