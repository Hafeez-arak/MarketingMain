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
    // '*' rather than a list: `landing` (20261025_ceo_control) may not exist
    // yet, and naming a missing column would fail every sign-in.
    .select('*')
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
    .select('user_id, email, full_name, status, role, leads_approver, requested_at, decided_at')
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

// Approve: lets them sign in, and nothing more. They hold no company until
// one is ticked for them with setUserCompanies below.
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
    .select('email, invited_at, workspace_ids, role')
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
// workspaceIds are the companies ticked on the form. They are applied now for
// 'approved', kept on the invite for 'invited', and ignored for 'already' —
// someone who is in has their companies edited on their own row.
// role is 'member' (the marketing app) or 'sales' (Leads only).
export async function inviteAccess(email, workspaceIds = [], role = 'member') {
  const { data, error } = await supabase.rpc('invite_access', {
    target_email: email,
    ws_ids: workspaceIds,
    as_role: role,
  })
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
    .select('id, name')
    .order('name')
  if (error) return { companies: [], error: error.message }
  return { companies: data || [], error: null }
}

// The whole roster in one query, shaped for the UI: { [user_id]: [ws_id, …] }.
// One round trip for everyone rather than one per person — the list is a few
// dozen rows at most and the page renders a checkbox grid per row.
//
// A sales person's companies are seats, not memberships (20261013_sales_seats),
// so both tables are read; a person only ever has rows in one of them.
export async function fetchCompanyAssignments() {
  const [members, seats] = await Promise.all([
    supabase.from('workspace_members').select('user_id, workspace_id'),
    supabase.from('sales_seats').select('user_id, workspace_id'),
  ])
  const error = members.error || seats.error
  if (error) return { assignments: {}, error: error.message }
  const assignments = {}
  for (const row of [...(members.data || []), ...(seats.data || [])]) {
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

// Create a company and say who gets it. The administrators and the person
// creating it are always joined (the roster trigger does that); memberIds is
// everyone else. Only the access admin may pass any — the function raises for
// a member who tries, so the form simply does not offer it to them.
export async function createCompany(name, memberIds = []) {
  const { data, error } = await supabase.rpc('create_company', {
    company_name: name,
    member_ids: memberIds,
  })
  if (error) return { id: null, error: error.message }
  return { id: data, error: null }
}

// ─── Sales: Leads and nothing else ─────────────────────────────────────────
// A sales person holds no company membership at all, so every marketing
// table and function refuses them without knowing they exist. Their
// companies are seats, read through this function (a workspaces policy would
// have made them look like members to every server function).
export async function fetchMySalesCompanies() {
  const { data, error } = await supabase.rpc('my_sales_companies')
  if (error) return { companies: [], error: error.message }
  return { companies: data || [], error: null }
}

// Move someone between the marketing app ('member'), Leads only ('sales')
// and Leads only with Approve into the CRM ('sales_admin'). Their companies
// come with them.
export async function setUserRole(userId, role) {
  const { error } = await supabase.rpc('set_user_role', { target_user: userId, new_role: role })
  return error ? error.message : null
}
