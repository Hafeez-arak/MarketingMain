// ─── A fake Odoo, for v2's tests and local runs ────────────────────────────
// 2026-10-19. v2 builds the Odoo mirror (api/leads/_odooSync.js) before Arak
// has a permanent Odoo key, and must never touch the real Odoo while being
// built. This answers Odoo 18's external JSON-RPC (/jsonrpc) the way the
// real one does for what the app uses:
//
//   common.version · common.authenticate
//   object.execute_kw: search_read, search_count, search, check_access_rights,
//   read on ir.model; /web/database/list
//
// with a domain evaluator for the operators the app sends ('=', '!=', '>',
// '<', '>=', '<=', 'in', 'not in', 'ilike', '=ilike' and the prefix '|',
// '&', '!'), `order` on fields, `limit`, `fields`, and active_test.
//
//   fakeOdooFetch(data)   a fetch() stand-in for tests
//   node dev/v2db/fakeOdoo.js [port]   a server on 127.0.0.1 (default 8069)
//                                      with invented records (fakeOdooData)
//
// Every name and number in fakeOdooData is invented.

import process from 'node:process'

export const FAKE = { db: 'arak-fake', login: 'lead-agent@arak.test', apiKey: 'fake-odoo-key', uid: 2, version: '18.0+e (fake)' }

const cmp = (a, op, b) => {
  const s = v => (v === false || v === null || v === undefined ? '' : Array.isArray(v) ? v[0] : v)
  const x = s(a)
  switch (op) {
    case '=': return x === (Array.isArray(b) ? b[0] : b) || (b === false && (a === false || a === null))
    case '!=': return !cmp(a, '=', b)
    case '>': return x > b
    case '<': return x < b
    case '>=': return x >= b
    case '<=': return x <= b
    case 'in': return b.includes(x)
    case 'not in': return !b.includes(x)
    case 'ilike': return String(x).toLowerCase().includes(String(b).toLowerCase())
    case '=ilike': return String(x).toLowerCase() === String(b).toLowerCase()
    default: throw new Error(`fake Odoo: operator ${op} is not supported`)
  }
}

/** Odoo's prefix-notation domain, applied to one record. */
export function matches(rec, domain = []) {
  const stack = []
  for (let i = domain.length - 1; i >= 0; i--) {
    const term = domain[i]
    // Both operands are popped before combining: `pop() || pop()` would
    // short-circuit and leave the second on the stack.
    if (term === '|') { const a = stack.pop(), b = stack.pop(); stack.push(a || b) }
    else if (term === '&') { const a = stack.pop(), b = stack.pop(); stack.push(a && b) }
    else if (term === '!') stack.push(!stack.pop())
    else stack.push(cmp(rec[term[0]], term[1], term[2]))
  }
  // Leftover terms are ANDed, as Odoo does.
  return stack.every(Boolean)
}

function order(rows, spec = '') {
  const keys = String(spec).split(',').map(s => s.trim().split(/\s+/)).filter(k => k[0])
  return [...rows].sort((a, b) => {
    for (const [f, dir] of keys) {
      const x = a[f] ?? '', y = b[f] ?? ''
      if (x < y) return dir === 'desc' ? 1 : -1
      if (x > y) return dir === 'desc' ? -1 : 1
    }
    return 0
  })
}

/** One JSON-RPC call against `data` ({ model: [records] }). */
export function handle(data, { service, method, args }) {
  if (service === 'common' && method === 'version') return { server_version: FAKE.version }
  if (service === 'common' && method === 'authenticate') {
    const [db, login, key] = args
    return db === FAKE.db && login === FAKE.login && key === FAKE.apiKey ? FAKE.uid : false
  }
  if (service !== 'object' || method !== 'execute_kw') throw new Error(`fake Odoo: ${service}.${method} is not supported`)
  const [db, uid, key, model, fn, fnArgs = [], kw = {}] = args
  if (db !== FAKE.db || uid !== FAKE.uid || key !== FAKE.apiKey) throw new Error('Access Denied')
  if (model === 'ir.model') {
    const names = Object.keys(data).map(m => ({ id: m.length, model: m }))
    return names.filter(r => matches(r, fnArgs[0] || []))
  }
  if (!data[model]) throw new Error(`Object ${model} doesn't exist`)
  const activeTest = kw.context?.active_test !== false
  let rows = data[model].filter(r => !activeTest || r.active !== false).filter(r => matches(r, fnArgs[0] || []))
  if (fn === 'check_access_rights') return true
  if (fn === 'search_count') return rows.length
  rows = order(rows, kw.order || 'id')
  if (kw.limit) rows = rows.slice(0, kw.limit)
  if (fn === 'search') return rows.map(r => r.id)
  if (fn === 'search_read') return rows.map(r => (kw.fields ? Object.fromEntries(['id', ...kw.fields].map(f => [f, r[f] ?? false])) : { ...r }))
  throw new Error(`fake Odoo: ${model}.${fn} is not supported`)
}

/** A fetch() that is this Odoo. */
export function fakeOdooFetch(data) {
  return async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}')
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
    if (String(url).endsWith('/web/database/list')) return json({ jsonrpc: '2.0', id: body.id, result: [FAKE.db] })
    try {
      return json({ jsonrpc: '2.0', id: body.id, result: handle(data, body.params || {}) })
    } catch (err) {
      return json({ jsonrpc: '2.0', id: body.id, error: { code: 200, message: 'Odoo Server Error', data: { message: err.message } } })
    }
  }
}

// ── Invented records, for a local run ──
const at = (daysAgo, h = 9) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  d.setUTCHours(h, 0, 0, 0)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
const day = daysAgo => at(daysAgo).slice(0, 10)

export function fakeOdooData() {
  const p = (id, name) => [id, name]
  const omar = [7, 'Omar Rep'], lina = [8, 'Lina Rep']
  return {
    'crm.stage': [
      { id: 1, name: 'New', is_won: false, sequence: 1, write_date: at(200) },
      { id: 3, name: 'Quotation', is_won: false, sequence: 3, write_date: at(200) },
      { id: 4, name: 'Won', is_won: true, sequence: 9, write_date: at(200) },
    ],
    'crm.lead': [
      { id: 101, name: 'Crescent tower phase 2', type: 'opportunity', active: true, probability: 40, expected_revenue: 2400000, stage_id: [3, 'Quotation'], user_id: omar, partner_id: p(50, 'Crescent Developments'), partner_name: '', date_deadline: day(-20), date_closed: false, create_date: at(40), write_date: at(3) },
      { id: 102, name: 'Palm Tower parking lighting', type: 'opportunity', active: true, probability: 30, expected_revenue: 650000, stage_id: [1, 'New'], user_id: lina, partner_id: p(51, 'Palm Tower Contracting'), partner_name: '', date_deadline: false, date_closed: false, create_date: at(12), write_date: at(2) },
      { id: 103, name: 'Hotel lobby (no owner yet)', type: 'opportunity', active: true, probability: 10, expected_revenue: 0, stage_id: [1, 'New'], user_id: false, partner_id: p(52, 'Gulf Hospitality Group'), partner_name: '', date_deadline: false, date_closed: false, create_date: at(5), write_date: at(5) },
      { id: 104, name: 'Clinic fit-out', type: 'opportunity', active: true, probability: 100, expected_revenue: 380000, stage_id: [4, 'Won'], user_id: lina, partner_id: p(53, 'Najd Health Projects'), partner_name: '', date_deadline: false, date_closed: at(8), create_date: at(60), write_date: at(8) },
      { id: 105, name: 'Mall facade (lost on price)', type: 'opportunity', active: false, probability: 0, expected_revenue: 900000, stage_id: [3, 'Quotation'], user_id: omar, partner_id: p(54, 'Eastern Malls Co'), partner_name: '', date_deadline: false, date_closed: false, create_date: at(90), write_date: at(20) },
    ],
    'sale.order': [
      { id: 201, name: 'S00201', state: 'sale', amount_untaxed: 380000, amount_total: 437000, date_order: at(8), create_date: at(15), user_id: lina, partner_id: p(53, 'Najd Health Projects'), opportunity_id: [104, 'Clinic fit-out'], write_date: at(8) },
      { id: 202, name: 'S00202', state: 'sent', amount_untaxed: 2400000, amount_total: 2760000, date_order: at(3), create_date: at(3), user_id: omar, partner_id: p(50, 'Crescent Developments'), opportunity_id: [101, 'Crescent tower phase 2'], write_date: at(3) },
      { id: 203, name: 'S00203', state: 'sale', amount_untaxed: 1200000, amount_total: 1380000, date_order: at(50), create_date: at(55), user_id: omar, partner_id: p(50, 'Crescent Developments'), opportunity_id: false, write_date: at(50) },
    ],
    'account.move': [
      { id: 301, name: 'INV/2026/0301', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_untaxed: 380000, amount_residual: 437000, invoice_date: day(5), invoice_date_due: day(-25), partner_id: p(53, 'Najd Health Projects'), invoice_user_id: lina, write_date: at(5) },
      { id: 302, name: 'INV/2026/0210', move_type: 'out_invoice', state: 'posted', payment_state: 'partial', amount_untaxed: 1200000, amount_residual: 300000, invoice_date: day(110), invoice_date_due: day(80), partner_id: p(50, 'Crescent Developments'), invoice_user_id: omar, write_date: at(30) },
    ],
    'project.project': [
      { id: 401, name: 'Najd clinic lighting', active: true, partner_id: p(53, 'Najd Health Projects'), user_id: lina, date_start: day(8), date: day(-40), last_update_status: 'on_track', stage_id: false, write_date: at(2) },
      { id: 402, name: 'Crescent tower phase 1', active: true, partner_id: p(50, 'Crescent Developments'), user_id: omar, date_start: day(50), date: false, last_update_status: 'at_risk', stage_id: false, write_date: at(1) },
    ],
  }
}

// ── As a server: node dev/v2db/fakeOdoo.js [port] ──
if (process.argv[1] && (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createServer } = await import('node:http')
  const port = Number(process.argv[2] || 8069)
  const data = fakeOdooData()
  const fetchLike = fakeOdooFetch(data)
  createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    const r = await fetchLike(`http://127.0.0.1:${port}${req.url}`, { method: req.method, body })
    res.writeHead(r.status, { 'Content-Type': 'application/json' })
    res.end(await r.text())
  }).listen(port, '127.0.0.1', () => console.log(`fake Odoo on http://127.0.0.1:${port} (db ${FAKE.db}, login ${FAKE.login})`))
}
