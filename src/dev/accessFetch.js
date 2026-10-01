// ─── Dev-only: an in-memory stand-in for the access tables ─────────────────
// Imported FIRST by accessHarness.jsx: supabase-js captures window.fetch when
// its client is created, so the replacement must already be in place.
//
// Answers the handful of PostgREST calls the Settings, Team & Access and
// "no companies yet" screens make, from a small roster held in memory, so
// those screens can be clicked through without signing in. The RPCs follow
// the rules of 20261004_companies_by_assignment — but this file is a prop
// for looking at the screens, not the proof of those rules. The proof is
// supabase/companyAccess.test.js, which runs the real SQL.
//
// Vite's own module requests (/src, /node_modules, /@…) still load.

const params = new URLSearchParams(window.location.search)
const AS = params.get('as') || 'admin'

export const USERS = {
  admin: { user_id: 'u-admin', email: 'hafeez@arak-sa.com', full_name: 'Hafeez', role: 'admin',  status: 'approved' },
  sara:  { user_id: 'u-sara',  email: 'sara@example.com',   full_name: 'Sara Ahmed', role: 'member', status: 'approved' },
  omar:  { user_id: 'u-omar',  email: 'omar@example.com',   full_name: 'Omar Khalid', role: 'member', status: 'approved' },
  lina:  { user_id: 'u-lina',  email: 'lina@example.com',   full_name: 'Lina Saleh', role: 'member', status: 'pending' },
  // Approved a moment ago, nothing ticked yet: the "no companies" screen.
  noor:  { user_id: 'u-noor',  email: 'noor@example.com',   full_name: 'Noor Hassan', role: 'member', status: 'approved' },
}
export const ME = USERS[AS] || USERS.admin

const db = {
  access: Object.values(USERS).map((u, i) => ({ ...u, requested_at: `2026-09-${10 + i}T08:00:00Z`, decided_at: null })),
  workspaces: [
    { id: 'ws-arak',  name: 'Arak Lighting', slug: 'arak',  created_at: '2026-06-21T07:56:15Z' },
    { id: 'ws-aqeeq', name: 'Aqeeq',         slug: 'aqeeq', created_at: '2026-08-11T07:00:52Z' },
    { id: 'ws-ghusn', name: 'Ghusn',         slug: 'ghusn', created_at: '2026-10-01T08:19:19Z' },
  ],
  members: [
    ['ws-arak', 'u-admin'], ['ws-aqeeq', 'u-admin'], ['ws-ghusn', 'u-admin'],
    ['ws-aqeeq', 'u-sara'], ['ws-aqeeq', 'u-omar'], ['ws-ghusn', 'u-omar'],
  ].map(([workspace_id, user_id]) => ({ workspace_id, user_id, role: 'owner' })),
  invites: [{ email: 'waiting@example.com', invited_at: '2026-09-30T09:00:00Z', workspace_ids: ['ws-ghusn'] }],
}
window.__accessDb = db
window.__accessCalls = []

export function myWorkspaces() {
  return db.members
    .filter(m => m.user_id === ME.user_id)
    .map(m => ({ ...db.workspaces.find(w => w.id === m.workspace_id), role: m.role }))
    .filter(w => w.id)
}

const isAdmin = () => ME.role === 'admin' && ME.status === 'approved'
const join = (workspace_id, user_id) => {
  if (!db.members.some(m => m.workspace_id === workspace_id && m.user_id === user_id)) {
    db.members.push({ workspace_id, user_id, role: 'owner' })
  }
}
const fail = message => ({ status: 400, body: { message } })

const RPC = {
  create_company({ company_name, member_ids }) {
    const picked = member_ids || []
    if (picked.length && !isAdmin()) return fail('Only the access admin can choose who gets a company')
    const id = `ws-${db.workspaces.length + 1}`
    db.workspaces.push({ id, name: company_name, slug: id, created_at: new Date().toISOString() })
    for (const a of db.access) {
      if (a.status === 'approved' && (a.role === 'admin' || a.user_id === ME.user_id)) join(id, a.user_id)
    }
    for (const uid of picked) {
      if (db.access.some(a => a.user_id === uid && a.status === 'approved')) join(id, uid)
    }
    return { status: 200, body: id }
  },
  approve_access({ target_user }) {
    if (!isAdmin()) return fail('Only the access admin can approve access')
    const row = db.access.find(a => a.user_id === target_user)
    if (row) row.status = 'approved'
    return { status: 204, body: null }
  },
  revoke_access({ target_user }) {
    const row = db.access.find(a => a.user_id === target_user)
    if (row) row.status = 'revoked'
    db.members = db.members.filter(m => m.user_id !== target_user)
    return { status: 204, body: null }
  },
  invite_access({ target_email, ws_ids }) {
    const email = String(target_email || '').trim().toLowerCase()
    const wanted = (ws_ids || []).filter(id => db.workspaces.some(w => w.id === id))
    const row = db.access.find(a => a.email === email)
    if (!row) {
      db.invites = db.invites.filter(i => i.email !== email)
      db.invites.unshift({ email, invited_at: new Date().toISOString(), workspace_ids: wanted })
      return { status: 200, body: 'invited' }
    }
    if (row.status === 'approved') return { status: 200, body: 'already' }
    row.status = 'approved'
    wanted.forEach(id => join(id, row.user_id))
    return { status: 200, body: 'approved' }
  },
  cancel_invite({ target_email }) {
    db.invites = db.invites.filter(i => i.email !== target_email)
    return { status: 204, body: null }
  },
  set_user_workspaces({ target_user, ws_ids }) {
    if (!isAdmin()) return fail('Only the access admin can assign companies')
    db.members = db.members.filter(m => m.user_id !== target_user)
    ;(ws_ids || []).forEach(id => join(id, target_user))
    return { status: 204, body: null }
  },
}

const TABLES = {
  user_access: () => [...db.access].sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
  access_invites: () => db.invites,
  workspaces: () => [...db.workspaces].sort((a, b) => a.name.localeCompare(b.name)),
  workspace_members: () => db.members,
}

function respond(status, body) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' },
  })
}

const realFetch = window.fetch.bind(window)
const own = url => /^\/(src|node_modules|@)/.test(url)
  || ['/src', '/@', '/node_modules'].some(p => url.startsWith(window.location.origin + p))

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  if (own(url)) return realFetch(input, init)
  const { pathname } = new URL(url, window.location.origin)
  const rpc = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(pathname)
  if (rpc && RPC[rpc[1]]) {
    const args = JSON.parse(init.body || '{}')
    window.__accessCalls.push({ rpc: rpc[1], args })
    const { status, body } = RPC[rpc[1]](args)
    return respond(status, body)
  }
  const table = /\/rest\/v1\/([a-z_]+)$/.exec(pathname)
  if (table && TABLES[table[1]]) return respond(200, TABLES[table[1]]())
  // Everything else the layout asks for (badges, counts): an empty answer.
  return respond(200, [])
}
