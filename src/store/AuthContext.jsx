import { useEffect, useState, useCallback, useRef } from 'react'
import { AuthContext } from './auth'
import { supabase } from '../lib/supabaseClient'
import { fetchMyAccess, fetchMySalesCompanies } from '../lib/access'
import { pickActiveWorkspace, rememberWorkspace, rememberedWorkspace } from '../lib/activeWorkspace'
import { fetchMySections } from '../lib/sectionAccess'
import { sectionLevel, atLeast } from '../lib/modules'

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
    // A sales person holds no memberships (that is what keeps the marketing
    // app shut to them); their companies are seats, read separately.
    let ws
    if (myAccess?.role === 'sales' && myAccess?.status === 'approved') {
      const { companies, error: salesError } = await fetchMySalesCompanies()
      setAccess(myAccess)
      setLoadingWorkspaces(false)
      if (salesError) { setAuthError(salesError); return }
      ws = companies.map(c => ({ ...c, role: 'sales' }))
    } else {
      setAccess(myAccess)
      setLoadingWorkspaces(false)
      if (error) { setAuthError(error.message); return }
      ws = (data || [])
        .filter(row => row.workspaces)
        .map(row => ({ ...row.workspaces, role: row.role }))
    }
    setWorkspaces(ws)
    // The company open before a refresh, if this person still holds it —
    // otherwise the first one. See lib/activeWorkspace.js.
    setActiveWorkspaceId(prev => pickActiveWorkspace(prev, rememberedWorkspace(userId), ws))
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

  // ── v2: this person's sections in the open company ──
  // { sales: 'work', … } from public.section_access, or null where that table
  // does not exist yet (production before v2 ships): lib/modules.js then
  // falls back to v1's admin / member rule. Kept with the company it was
  // read for, so switching companies never shows the previous one's grants.
  const [grants, setGrants] = useState({ ws: null, sections: null })
  const userId = session?.user?.id || null
  useEffect(() => {
    if (!userId || !activeWorkspaceId) return
    let cancelled = false
    fetchMySections(activeWorkspaceId, userId).then(sections => {
      if (!cancelled) setGrants({ ws: activeWorkspaceId, sections })
    })
    return () => { cancelled = true }
  }, [userId, activeWorkspaceId])
  const sections = grants.ws === activeWorkspaceId ? grants.sections : null
  const isAdminNow = access?.role === 'admin' && access?.status === 'approved'
  // Until the grants for this company are read, nobody is sent away: a link
  // to a Sales page must not bounce to Home on v1's rule a moment before the
  // grant that allows it arrives. The admin needs no grants.
  const sectionsReady = isAdminNow || !activeWorkspaceId || grants.ws === activeWorkspaceId
  const who = { isAccessAdmin: isAdminNow, sections }

  // Switching is the only place a choice is saved. The fallback picked on
  // load is not written back, so losing access to a company does not
  // overwrite the record of a deliberate choice with an accident.
  const switchWorkspace = useCallback(id => {
    setActiveWorkspaceId(id)
    rememberWorkspace(session?.user?.id, id)
  }, [session?.user?.id])

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
    // Leads only: the app renders SalesApp for them instead of the marketing
    // shell. The database is what actually keeps them out of everything else.
    isSales: access?.role === 'sales' && access?.status === 'approved',
    // Approve into the CRM: the access admin, or a sales admin. The server
    // asks the database again (can_approve_leads) before sending anything.
    canApproveLeads: access?.status === 'approved' && (access?.role === 'admin' || (access?.role === 'sales' && Boolean(access?.leads_approver))),
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    switchWorkspace,
    // v2 sections: the grants, and the two questions every screen asks.
    sections,
    sectionsReady,
    who,
    sectionLevel: key => sectionLevel(key, who),
    canSection: (key, min = 'view') => atLeast(sectionLevel(key, who), min),
    authError,
    signUp,
    signIn,
    signOut,
    refreshWorkspaces: () => loadWorkspaces(session?.user?.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
