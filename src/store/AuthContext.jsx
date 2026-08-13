import { useEffect, useState, useCallback, useRef } from 'react'
import { AuthContext } from './auth'
import { supabase } from '../lib/supabaseClient'
import { fetchMyAccess } from '../lib/access'

// ─── Auth + workspace context ──────────────────────────────────────────────
// Phase 0: real accounts, real session, and a real workspace resolved from
// workspace_members — not the old localStorage-only `workspaces` array in
// appStore. A signed-in user can belong to one workspace (the common case
// today) or several (the agency case, Phase 4); this exposes both.
//
// Since the access gate landed, a session alone no longer means "let them
// in" — every signed-in user also has a public.user_access row that is
// pending until the admin approves it. That row is loaded here alongside
// the workspace list because both answer the same question (what is this
// person allowed to see?) and both must settle before RequireAuth decides
// which screen to render. Splitting them into two loading flags would let
// the app flash the dashboard at someone still waiting for approval.
export function AuthProvider({ children }) {
  const [session, setSession]   = useState(undefined) // undefined = not loaded yet, null = signed out
  const [workspaces, setWorkspaces] = useState([])     // [{ id, name, slug, role }]
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null)
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false)
  const [access, setAccess] = useState(null)           // { status, role, ... } | null
  const [authError, setAuthError] = useState('')
  // Tracks the currently-loaded user id so we can ignore the auth events
  // Supabase re-fires on tab focus / token refresh (same user) — see effect below.
  const lastUserIdRef = useRef(undefined)

  const loadWorkspaces = useCallback(async (userId) => {
    if (!userId) { setWorkspaces([]); setActiveWorkspaceId(null); setAccess(null); return }
    setLoadingWorkspaces(true)
    const [{ data, error }, { access: myAccess }] = await Promise.all([
      supabase
        .from('workspace_members')
        // No `plan` — every workspace is the same product, so there was no
        // tier for the "Trial plan" / "Agency plan" line to name truthfully.
        .select('role, workspaces ( id, name, slug, created_at )')
        .eq('user_id', userId),
      fetchMyAccess(userId),
    ])
    setAccess(myAccess)
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
      lastUserIdRef.current = data.session?.user?.id ?? null
      setSession(data.session ?? null)
      loadWorkspaces(data.session?.user?.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const newUserId = newSession?.user?.id ?? null
      // Always keep the freshest session/token so API calls stay authenticated.
      setSession(newSession)
      // But Supabase re-fires auth events (TOKEN_REFRESHED, SIGNED_IN) every time
      // the tab regains focus, with the SAME user. Calling loadWorkspaces() there
      // flips `loading`, which makes RequireAuth unmount the entire app subtree and
      // wipe in-progress form state (e.g. a half-written prompt). Only reload the
      // workspace list when the signed-in user actually changes (real sign-in/out).
      if (newUserId !== lastUserIdRef.current) {
        lastUserIdRef.current = newUserId
        loadWorkspaces(newUserId)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadWorkspaces])

  async function signUp({ email, password, fullName }) {
    setAuthError('')
    const { data, error } = await supabase.auth.signUp({
      email, password,
      // handle_new_user() copies this onto the access request, so the admin
      // sees a name next to the email instead of guessing from the address.
      options: { data: { full_name: fullName || '' } },
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
    // Access gate. `accessStatus` is 'pending' | 'approved' | 'revoked', or
    // null while signed out. Treat a missing row as pending, not approved:
    // if the trigger ever failed to file the request, the safe reading is
    // "not let in yet", and the admin will see nothing to approve — which
    // is a visible bug rather than a silent hole.
    access,
    accessStatus: access?.status || (session ? 'pending' : null),
    isApproved: access?.status === 'approved',
    isAccessAdmin: access?.role === 'admin' && access?.status === 'approved',
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
