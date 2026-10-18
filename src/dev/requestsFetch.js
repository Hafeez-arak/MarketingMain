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
// A made-up brief in the stored shape, for looking at the CEO page.
const bi = (ar, en) => ({ ar, en })
db.briefs = [{
  id: 'b1', period_start: ago(24 * 7), period_end: ago(1), trigger: 'schedule', created_at: ago(5), cost_usd: 0.16,
  kpis: [
    { key: 'leads', label: bi('استفسارات جيدة هذا الأسبوع', 'Good enquiries this week'), value: bi('9', '9'), sub: bi('4 الأسبوع الماضي · 6 بلا مسؤول', '4 last week · 6 with no owner'), tone: 'bad' },
    { key: 'money', label: bi('فرص مفتوحة مع العملاء الرئيسيين', 'Open with key accounts'), value: bi('12.5 مليون ريال', 'SAR 12.5M'), sub: bi('5 مشاريع جديدة هذا الأسبوع', '5 new projects found this week'), tone: 'good' },
    { key: 'social', label: bi('المتابعون على المنصات', 'Social followers'), value: bi('3,200', '3,200'), sub: bi('+40 مؤخرًا · منشور واحد هذا الأسبوع', '+40 recently · 1 post this week'), tone: 'good' },
    { key: 'requests', label: bi('طلباتك المفتوحة', 'Your open requests'), value: bi('2', '2'), sub: bi('1 أُنجزت هذا الأسبوع', '1 done this week'), tone: 'good' },
  ],
  brief: {
    headline: bi('أسبوع جيد في الطلبات الواردة وضعيف في المتابعة.', 'A good week for incoming enquiries and a poor one for follow-up.'),
    needs_you: [
      { area: 'leads', title: bi('ستة استفسارات جيدة بلا مسؤول.', 'Six good enquiries have no owner.'), action: bi('كلّف شخصًا واحدًا اليوم بمتابعة كل استفسار جديد.', 'Name one person today to own every new enquiry.') },
      { area: 'money', title: bi('عميل رئيسي بلا طلب منذ ستة أشهر.', 'A key account has not ordered in six months.'), action: bi('اتصل بإدارتهم هذا الأسبوع.', 'Call their management this week.') },
    ],
    found: [
      { area: 'leads', tone: 'bad', text: bi('وصلت استفسارات أكثر من الأسبوع الماضي لكن لم نرد على معظمها.', 'More enquiries came in than last week, but most have not been answered.') },
      { area: 'money', tone: 'good', text: bi('مشروع مدارس كبير تمت ترسيته ويناسبنا تمامًا.', 'A large schools project was awarded and fits us well.') },
      { area: 'social', tone: 'watch', text: bi('لينكدإن ينمو رغم قلة النشر، وإنستغرام ثابت.', 'LinkedIn is growing despite little posting; Instagram is flat.') },
    ],
    watch: [bi('معرض قادم في الرياض بداية الشهر المقبل.', 'A trade show in Riyadh early next month.')],
  },
}]
db.cap = 30
db.usage = [
  { surface: 'run', cost_usd: 9.15, created_at: ago(24 * 12) },
  { surface: 'chat', cost_usd: 0.68, created_at: ago(2) },
  { surface: 'lead_qualifier', cost_usd: 0.37, created_at: ago(30) },
  { surface: 'run', cost_usd: 8.2, created_at: ago(24 * 30) },
]
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
  if (rpc?.[1] === 'set_agent_cap') {
    const { cap } = JSON.parse(init.body || '{}')
    if (!(cap >= 1 && cap <= 5000)) return respond(400, { message: 'The monthly limit must be between $1 and $5,000.' })
    db.cap = cap
    return respond(200, cap)
  }
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
  if (table === 'requests' && method === 'POST') {
    const row = { id: `r${Date.now()}`, status: 'new', resolution: '', link: '', assigned_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), closed_at: null, ...JSON.parse(init.body || '{}') }
    db.requests.unshift(row)
    return respond(201, row)
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
  if (table === 'agent_usage') return respond(200, db.usage)
  if (table === 'workspaces') return respond(200, { agent_monthly_cap_usd: db.cap })
  if (table === 'agent_cap_log') return respond(200, [])
  if (table === 'ceo_briefs') return respond(200, MODE === 'empty' ? [] : db.briefs)
  return respond(200, [])
}
