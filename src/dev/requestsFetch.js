// ─── Dev-only: an in-memory stand-in for requests and notifications ────────
// Imported FIRST by requestsHarness.jsx: supabase-js captures window.fetch
// when its client is created, so the replacement must already be in place.
// A prop for looking at the Requests page, the bell and the @ picker without
// signing in. The proof of the rules is the trigger test run against the real
// database (docs/CEO-ASSISTANT-PLAN.md, PR 2) and api/agent/_requests.test.js.

const params = new URLSearchParams(window.location.search)
export const MODE = params.get('mode') || 'data' // data | empty | fail | hang

export const ME = { user_id: 'u-ceo', email: 'mkader@arak-sa.com', full_name: 'mkader', role: 'admin', status: 'approved' }
const ago = h => new Date(Date.now() - h * 3_600_000).toISOString()

const db = {
  requests: [
    { id: 'r1', kind: 'content', title: 'Redo the Friday caption', body: 'this caption is weak', brief: 'Rewrite the Friday post caption with a stronger opening line about the Diriyah project. Keep it under 120 words, Arabic and English.', page: '/schedule', status: 'new', resolution: '', link: '', created_by: 'u-ceo', assigned_to: 'u-shadia', created_at: ago(3), updated_at: ago(3), closed_at: null },
    { id: 'r2', kind: 'improvement', title: 'Add a monthly sales report', body: 'I want one page every month with leads, quotes and what we won.', brief: '', page: '/leads', status: 'in_progress', resolution: '', link: '', created_by: 'u-ceo', assigned_to: 'u-hafeez', created_at: ago(30), updated_at: ago(5), closed_at: null },
    { id: 'r3', kind: 'bug', title: 'Analytics shows zero reach for LinkedIn', body: 'why is it zero', brief: '', page: '/analytics', status: 'done', resolution: 'LinkedIn does not report reach for company pages; the card now says so.', link: 'https://github.com/Hafeez-arak/MarketingMain/pull/240', created_by: 'u-ceo', assigned_to: null, created_at: ago(80), updated_at: ago(20), closed_at: ago(20) },
  ],
  events: [
    { id: 'e1', request_id: 'r2', kind: 'created', body: 'I want one page every month', actor: 'u-ceo', created_at: ago(30) },
    { id: 'e2', request_id: 'r2', kind: 'status', body: '', actor: 'u-hafeez', to_status: 'in_progress', created_at: ago(5) },
    { id: 'e3', request_id: 'r2', kind: 'comment', body: 'Draft ready by Thursday.', actor: 'u-hafeez', created_at: ago(4) },
  ],
  notifications: [
    { id: 'n1', kind: 'request_done', title: 'Done: Analytics shows zero reach for LinkedIn', body: 'LinkedIn does not report reach for company pages; the card now says so.', link: '/requests?id=r3', request_id: 'r3', workspace_id: 'ws-arak', created_at: ago(20), read_at: null },
    { id: 'n2', kind: 'comment', title: 'hafeez commented on: Add a monthly sales report', body: 'Draft ready by Thursday.', link: '/requests?id=r2', request_id: 'r2', workspace_id: 'ws-arak', created_at: ago(4), read_at: null },
  ],
  people: [
    { user_id: 'u-ceo', name: 'mkader' },
    { user_id: 'u-shadia', name: 'shadia' },
    { user_id: 'u-hafeez', name: 'hafeez' },
  ],
  taggable: [
    { user_id: 'u-shadia', name: 'shadia', label: 'Marketing' },
    { user_id: 'u-hafeez', name: 'hafeez', label: 'Builds the app' },
  ],
}
if (MODE === 'empty') { db.requests = []; db.notifications = []; db.events = [] }

window.__requestCalls = []

function respond(status, body) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-0/${Array.isArray(body) ? body.length : 0}` },
  })
}

const realFetch = window.fetch.bind(window)
const own = url => /^\/(src|node_modules|@)/.test(url)
  || ['/src', '/@', '/node_modules'].some(p => url.startsWith(window.location.origin + p))

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  if (own(url)) return realFetch(input, init)
  const u = new URL(url, window.location.origin)
  const method = (init.method || 'GET').toUpperCase()
  window.__requestCalls.push({ method, path: u.pathname + u.search, body: init.body })
  if (MODE === 'hang') return new Promise(() => {})
  const rpc = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname)
  if (rpc?.[1] === 'taggable_people') return respond(200, db.taggable)
  if (rpc?.[1] === 'workspace_people') return respond(200, db.people)
  const table = /\/rest\/v1\/([a-z_]+)$/.exec(u.pathname)?.[1]
  if (MODE === 'fail' && table === 'requests') return respond(500, { message: 'connection reset' })
  if (table === 'requests' && method === 'PATCH') {
    const id = /id=eq\.([^&]+)/.exec(u.search)?.[1]
    const patch = JSON.parse(init.body || '{}')
    const r = db.requests.find(x => x.id === id)
    if (r) Object.assign(r, patch, { updated_at: new Date().toISOString() })
    if (r && patch.status) db.events.push({ id: `e${Date.now()}`, request_id: id, kind: 'status', body: patch.resolution || '', actor: ME.user_id, to_status: patch.status, created_at: new Date().toISOString() })
    return respond(204, null)
  }
  if (table === 'requests') return respond(200, db.requests)
  if (table === 'request_events' && method === 'POST') {
    const row = JSON.parse(init.body || '{}')
    db.events.push({ id: `e${Date.now()}`, created_at: new Date().toISOString(), ...row })
    return respond(201, null)
  }
  if (table === 'request_events') {
    const id = /request_id=eq\.([^&]+)/.exec(u.search)?.[1]
    return respond(200, db.events.filter(e => e.request_id === id))
  }
  if (table === 'notifications' && method === 'PATCH') {
    for (const n of db.notifications) if (!n.read_at && u.search.includes(n.id)) n.read_at = new Date().toISOString()
    return respond(204, null)
  }
  if (table === 'notifications') return respond(200, db.notifications)
  return respond(200, [])
}
