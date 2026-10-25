// ─── Team & Access: the people list (v2, 2026-10-25) ───────────────────────
// The owner asked for Team & Access to be easy to use. The page used to be
// five stacked boxes (add form, invites, requests, people, removed) with a row
// of buttons on every person. It is now one list with tabs and search, the
// waiting requests on top, and one side panel per person. This file is the
// list's logic, pure so it is tested: who is in which tab, what each person
// uses, which companies they hold.
//
// Nothing here changes who may do what. The access model is unchanged:
//   · user_access.status   approved | pending | revoked  (may they sign in)
//   · user_access.role     admin | member | sales (+ leads_approver = sales admin)
//   · companies            workspace_members (member) or sales_seats (sales)
//   · sections             section_access, per company (members only)

/** member | sales | sales_admin | admin, from a user_access row or an invite. */
export const accessOf = (row = {}) =>
  (row.role === 'sales' ? (row.leads_approver ? 'sales_admin' : 'sales') : row.role || 'member')

/** The three kinds the admin can give (an admin is never made here). */
export const ACCESS_KINDS = ['member', 'sales', 'sales_admin']

/**
 * One list of everyone the page shows: people with an account, and people
 * cleared by email who have not signed up yet. Pending requests are kept apart
 * (they are the page's to-do), the rest are tabbed.
 */
export function buildPeople({ rows = [], invites = [], assignments = {}, companies = [], me = null } = {}) {
  const known = new Set(companies.map(c => c.id))
  const people = rows.map(r => ({
    id: r.user_id,
    kind: 'person',
    name: (r.full_name || '').trim() || String(r.email || '').split('@')[0],
    email: r.email || '',
    access: accessOf(r),
    status: r.status,
    companyIds: (assignments[r.user_id] || []).filter(id => known.has(id)),
    at: r.requested_at || null,
    isMe: Boolean(me && r.user_id === me),
    row: r,
  }))
  const invited = invites.map(i => ({
    id: `invite:${i.email}`,
    kind: 'invite',
    name: String(i.email || '').split('@')[0],
    email: i.email || '',
    access: accessOf({ role: i.role === 'sales_admin' ? 'sales' : i.role, leads_approver: i.role === 'sales_admin' }),
    status: 'invited',
    companyIds: (i.workspace_ids || []).filter(id => known.has(id)),
    at: i.invited_at || null,
    isMe: false,
    row: i,
  }))
  const byName = (a, b) => (a.access === 'admin' ? -1 : 0) - (b.access === 'admin' ? -1 : 0) || a.name.localeCompare(b.name)
  return {
    pending: people.filter(p => p.status === 'pending').sort((a, b) => String(b.at).localeCompare(String(a.at))),
    active: people.filter(p => p.status === 'approved').sort(byName),
    invited: invited.sort(byName),
    removed: people.filter(p => p.status === 'revoked').sort(byName),
  }
}

/** The tab's people, narrowed by a search over name, email and company names. */
export function filterPeople(list = [], query = '', companies = []) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return list
  const nameOf = new Map(companies.map(c => [c.id, String(c.name || '').toLowerCase()]))
  return list.filter(p => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    || p.companyIds.some(id => (nameOf.get(id) || '').includes(q)))
}

/** The company names to show on a row: the first `max`, and how many more. */
export function companyChips(person, companies = [], max = 2) {
  if (person.access === 'admin') return { all: true, shown: [], more: 0 }
  const names = companies.filter(c => person.companyIds.includes(c.id)).map(c => c.name)
  return { all: false, shown: names.slice(0, max), more: Math.max(0, names.length - max) }
}

/** Did the ticked set change from what they hold? */
export const sameSet = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x))
