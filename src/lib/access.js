import { supabase } from './supabaseClient'

// ─── Account access ─────────────────────────────────────────────────────────
// Every call here is a thin wrapper over public.user_access and the two
// SECURITY DEFINER functions that guard it (see the 20260816_access_control
// migration). Nothing in this file is a permission check — the database is.
// If someone calls approve_access() without being the admin, Postgres raises
// and we surface the message; the UI hiding the button is a courtesy, not a
// control.

// The admin's address is deliberately not exported, and not shown anywhere a
// non-admin can see. Users are told their request went to "the admin" — who
// that is, is an internal detail, and publishing it on a page anyone can
// reach by signing up just hands out a target.

// The signed-in user's own access row. RLS lets everyone read exactly this
// one, which is what makes it safe to call before we know anything about them.
export async function fetchMyAccess(userId) {
  if (!userId) return { access: null, error: null }
  const { data, error } = await supabase
    .from('user_access')
    .select('user_id, email, full_name, status, role, requested_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { access: null, error: error.message }
  return { access: data, error: null }
}

// Everyone who has ever signed up, newest request first. Returns an empty
// list for non-admins — RLS filters it down to their own row, and the page
// that calls this is admin-only anyway.
export async function fetchAllAccess() {
  const { data, error } = await supabase
    .from('user_access')
    .select('user_id, email, full_name, status, role, requested_at, decided_at')
    .order('requested_at', { ascending: false })
  if (error) return { rows: [], error: error.message }
  return { rows: data || [], error: null }
}

// How many people are waiting. Used for the sidebar badge, so it asks for a
// count rather than dragging the whole roster across on every page load.
export async function fetchPendingCount() {
  const { count, error } = await supabase
    .from('user_access')
    .select('user_id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) return 0
  return count || 0
}

// Approve: joins them to every company that exists, and the roster trigger
// keeps them joined to every company created later.
export async function approveAccess(userId) {
  const { error } = await supabase.rpc('approve_access', { target_user: userId })
  return error ? error.message : null
}

// Revoke, which is also how a pending request is denied — both end at
// status 'revoked' with zero workspace memberships. One verb, one outcome,
// nothing to reason about at 6pm on a Thursday.
export async function revokeAccess(userId) {
  const { error } = await supabase.rpc('revoke_access', { target_user: userId })
  return error ? error.message : null
}

// Addresses cleared ahead of signup — people the admin added who haven't
// created an account yet. Empty for non-admins by RLS.
export async function fetchInvites() {
  const { data, error } = await supabase
    .from('access_invites')
    .select('email, invited_at')
    .order('invited_at', { ascending: false })
  if (error) return { invites: [], error: error.message }
  return { invites: data || [], error: null }
}

// Add someone by email. One click means three different things depending on
// whether that address already has an account, so the function reports back
// which happened rather than leaving the UI to guess:
//   'approved' — they had signed up already, and are now in
//   'invited'  — no account yet; they're cleared for when they sign up
//   'already'  — nothing to do, they already had access
export async function inviteAccess(email) {
  const { data, error } = await supabase.rpc('invite_access', { target_email: email })
  if (error) return { outcome: null, error: error.message }
  return { outcome: data, error: null }
}

export async function cancelInvite(email) {
  const { error } = await supabase.rpc('cancel_invite', { target_email: email })
  return error ? error.message : null
}

// ─── Which companies each person gets ───────────────────────────────────────
// Approval lets someone into the application; these three decide which
// companies they actually see. Membership has always been the permission —
// see 20260916_assign_workspaces_per_user — so assigning a company is
// literally writing a workspace_members row, and the admin-only RPC below is
// the only thing allowed to write one.

// Every company that exists, not just the caller's own. Two select policies
// answer this table: ordinary members see the ones they belong to, the access
// admin sees all of them. Both are fine here — the page is admin-only.
export async function fetchAllCompanies() {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, admin_only')
    .order('name')
  if (error) return { companies: [], error: error.message }
  return { companies: data || [], error: null }
}

// The whole roster in one query, shaped for the UI: { [user_id]: [ws_id, …] }.
// One round trip for everyone rather than one per person — the list is a few
// dozen rows at most and the page renders a checkbox grid per row.
export async function fetchCompanyAssignments() {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('user_id, workspace_id')
  if (error) return { assignments: {}, error: error.message }
  const assignments = {}
  for (const row of data || []) {
    ;(assignments[row.user_id] ||= []).push(row.workspace_id)
  }
  return { assignments, error: null }
}

// Send the complete ticked set, not a diff: the function makes the roster
// match it exactly, so a retry is harmless and a lost request can't leave
// someone half-assigned.
export async function setUserCompanies(userId, workspaceIds) {
  const { error } = await supabase.rpc('set_user_workspaces', {
    target_user: userId,
    ws_ids: workspaceIds,
  })
  return error ? error.message : null
}
