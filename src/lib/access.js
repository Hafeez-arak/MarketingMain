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
