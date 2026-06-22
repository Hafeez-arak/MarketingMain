import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

// ─── Auth + workspace context ──────────────────────────────────────────────
// Phase 0: real accounts, real session, and a real workspace resolved from
// workspace_members — not the old localStorage-only `workspaces` array in
// appStore. A signed-in user can belong to one workspace (the common case
// today) or several (the agency case, Phase 4); this exposes both.
export function AuthProvider({ children }) {
  const [session, setSession]   = useState(undefined) // undefined = not loaded yet, null = signed out
  const [workspaces, setWorkspaces] = useState([])     // [{ id, name, slug, plan, role }]
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null)
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false)
  const [authError, setAuthError] = useState('')

  const loadWorkspaces = useCallback(async (userId) => {
    if (!userId) { setWorkspaces([]); setActiveWorkspaceId(null); return }
    setLoadingWorkspaces(true)
    const { data, error } = await supabase
      .from('workspace_members')
      .select('role, workspaces ( id, name, slug, plan, created_at )')
      .eq('user_id', userId)
    setLoadingWorkspaces(false)
    if (error) { setAuthError(error.message); return }
    const ws = (data || [])
      .filter(row => row.workspaces)
      .map(row => ({ ...row.workspaces, role: row.role }))
    setWorkspaces(ws)
    setActiveWorkspaceId(prev => prev && ws.some(w => w.id === prev) ? prev : (ws[0]?.id || null))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      loadWorkspaces(data.session?.user?.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      loadWorkspaces(newSession?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadWorkspaces])

  async function signUp({ email, password, workspaceName }) {
    setAuthError('')
    const { data, error } = await supabase.auth.signUp({
      email, password,
      // Picked up by the handle_new_user() trigger for the new workspace's
      // display name — falls back to "<email prefix>'s Workspace" if blank.
      options: { data: { workspace_name: workspaceName || '' } },
    })
    if (error) { setAuthError(error.message); return { error } }
    return { data }
  }

  async function signIn({ email, password }) {
    setAuthError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setAuthError(error.message); return { error } }
    return { data }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null

  const value = {
    session,
    user: session?.user || null,
    // Pages that still build raw fetch() calls (rather than the supabase-js
    // client) need this for the Authorization header — falls back to the
    // anon key only when truly signed out, which RLS then scopes to the
    // legacy workspace anyway, never to a real tenant's data.
    accessToken: session?.access_token || null,
    loading: session === undefined || loadingWorkspaces,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    switchWorkspace: setActiveWorkspaceId,
    authError,
    signUp,
    signIn,
    signOut,
    refreshWorkspaces: () => loadWorkspaces(session?.user?.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
