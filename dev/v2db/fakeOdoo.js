// ─── A fake Odoo, for v2's tests and local runs ────────────────────────────
// 2026-10-19. v2 builds the Odoo mirror (api/leads/_odooSync.js) before Arak
// has a permanent Odoo key, and must never touch the real Odoo while being
// built. This answers Odoo 18's external JSON-RPC (/jsonrpc) the way the
// real one does for what the app uses:
//
//   common.version · common.authenticate
//   object.execute_kw: search_read, search_count, search, check_access_rights,
//   fields_get, read on ir.model; /web/database/list
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
  // A model's fields are whatever its records carry (an empty model checks
  // nothing). Asking for one it lacks fails as Odoo's does, so the mirror's
  // optional fields are tested for real.
  const schema = new Set(['id', ...data[model].flatMap(r => Object.keys(r))])
  if (fn === 'fields_get') return Object.fromEntries([...schema].map(f => [f, { type: 'char' }]))
  if (data[model].length && kw.fields) {
    const unknown = kw.fields.find(f => !schema.has(f))
    if (unknown) throw new Error(`Invalid field '${unknown}' on model '${model}'`)
  }
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
  const omar = [7, 'Omar Rep'], lina = [8, 'Lina Rep'], sara = [9, 'Sara PM'], khalid = [10, 'Khalid PM']
  // Arak's nine project stages, as they would be named in Odoo Project.
  const st = [
    'Awarded', 'Technical submittal', 'Client review', 'Purchase order', 'Production & shipping',
    'Delivery to site', 'Installation & commissioning', 'Handover', 'Collection & maintenance',
  ].map((name, i) => ({ id: 11 + i, name, sequence: i + 1, fold: false, write_date: at(300) }))
  const stage = i => [st[i].id, st[i].name]
  const data = {
    'res.users': [
      { id: 2, name: 'Lead Agent', login: FAKE.login, email: FAKE.login, active: true, write_date: at(300) },
      { id: 7, name: 'Omar Rep', login: 'rep.omar@arak.test', email: 'rep.omar@arak.test', active: true, write_date: at(300) },
      { id: 8, name: 'Lina Rep', login: 'rep.lina@arak.test', email: 'rep.lina@arak.test', active: true, write_date: at(300) },
      // A login that is a username: matched on the email field instead.
      { id: 9, name: 'Sara PM', login: 'sara', email: 'pm.sara@arak.test', active: true, write_date: at(300) },
      { id: 10, name: 'Khalid PM', login: 'pm.khalid@arak.test', email: 'pm.khalid@arak.test', active: true, write_date: at(300) },
    ],
    'crm.stage': [
      { id: 1, name: 'New', is_won: false, sequence: 1, write_date: at(200) },
      { id: 3, name: 'Quotation', is_won: false, sequence: 3, write_date: at(200) },
      { id: 4, name: 'Won', is_won: true, sequence: 9, write_date: at(200) },
    ],
    'crm.lead': [
      { id: 101, name: 'Crescent tower phase 2', type: 'opportunity', active: true, probability: 40, expected_revenue: 2400000, stage_id: [3, 'Quotation'], user_id: omar, partner_id: p(50, 'Crescent Developments'), partner_name: '', date_deadline: day(-20), date_closed: false, create_date: at(40), lost_reason_id: false, write_date: at(3) },
      { id: 102, name: 'Palm Tower parking lighting', type: 'opportunity', active: true, probability: 30, expected_revenue: 650000, stage_id: [1, 'New'], user_id: lina, partner_id: p(51, 'Palm Tower Contracting'), partner_name: '', date_deadline: false, date_closed: false, create_date: at(12), lost_reason_id: false, write_date: at(2) },
      { id: 103, name: 'Hotel lobby (no owner yet)', type: 'opportunity', active: true, probability: 10, expected_revenue: 0, stage_id: [1, 'New'], user_id: false, partner_id: p(52, 'Gulf Hospitality Group'), partner_name: '', date_deadline: false, date_closed: false, create_date: at(5), lost_reason_id: false, write_date: at(5) },
      { id: 104, name: 'Clinic fit-out', type: 'opportunity', active: true, probability: 100, expected_revenue: 380000, stage_id: [4, 'Won'], user_id: lina, partner_id: p(53, 'Najd Health Projects'), partner_name: '', date_deadline: false, date_closed: at(8), create_date: at(60), lost_reason_id: false, write_date: at(8) },
      { id: 105, name: 'Mall facade (lost on price)', type: 'opportunity', active: false, probability: 0, expected_revenue: 900000, stage_id: [3, 'Quotation'], user_id: omar, partner_id: p(54, 'Eastern Malls Co'), partner_name: '', date_deadline: false, date_closed: false, create_date: at(90), lost_reason_id: [1, 'Price'], write_date: at(20) },
    ],
    // margin_percent is a fraction, as Odoo's Sales margin stores it.
    'sale.order': [
      { id: 201, name: 'S00201', state: 'sale', amount_untaxed: 380000, amount_total: 437000, margin: 106400, margin_percent: 0.28, date_order: at(8), create_date: at(15), user_id: lina, partner_id: p(53, 'Najd Health Projects'), opportunity_id: [104, 'Clinic fit-out'], project_id: false, write_date: at(8) },
      { id: 202, name: 'S00202', state: 'sent', amount_untaxed: 2400000, amount_total: 2760000, margin: 600000, margin_percent: 0.25, date_order: at(3), create_date: at(3), user_id: omar, partner_id: p(50, 'Crescent Developments'), opportunity_id: [101, 'Crescent tower phase 2'], project_id: false, write_date: at(3) },
      { id: 203, name: 'S00203', state: 'sale', amount_untaxed: 1200000, amount_total: 1380000, margin: 264000, margin_percent: 0.22, date_order: at(130), create_date: at(135), user_id: omar, partner_id: p(50, 'Crescent Developments'), opportunity_id: false, project_id: false, write_date: at(50) },
      { id: 204, name: 'S00204', state: 'sale', amount_untaxed: 650000, amount_total: 747500, margin: 162500, margin_percent: 0.25, date_order: at(45), create_date: at(50), user_id: lina, partner_id: p(51, 'Palm Tower Contracting'), opportunity_id: false, project_id: false, write_date: at(45) },
      { id: 205, name: 'S00205', state: 'sale', amount_untaxed: 900000, amount_total: 1035000, margin: 270000, margin_percent: 0.30, date_order: at(160), create_date: at(165), user_id: omar, partner_id: p(55, 'Desert Rose Hotels'), opportunity_id: false, project_id: [404, 'Desert Rose hotel lobby'], write_date: at(75) },
      { id: 206, name: 'S00206', state: 'sale', amount_untaxed: 1100000, amount_total: 1265000, margin: false, margin_percent: false, date_order: at(4), create_date: at(6), user_id: lina, partner_id: p(56, 'Eastern Schools Co'), opportunity_id: false, project_id: false, write_date: at(4) },
    ],
    'account.move': [
      { id: 301, name: 'INV/2026/0301', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_untaxed: 380000, amount_total: 437000, amount_residual: 437000, invoice_date: day(5), invoice_date_due: day(-25), invoice_origin: 'S00201', partner_id: p(53, 'Najd Health Projects'), invoice_user_id: lina, write_date: at(5) },
      { id: 302, name: 'INV/2026/0210', move_type: 'out_invoice', state: 'posted', payment_state: 'partial', amount_untaxed: 1200000, amount_total: 1380000, amount_residual: 300000, invoice_date: day(110), invoice_date_due: day(80), invoice_origin: 'S00203', partner_id: p(50, 'Crescent Developments'), invoice_user_id: omar, write_date: at(30) },
      { id: 303, name: 'INV/2026/0288', move_type: 'out_invoice', state: 'posted', payment_state: 'paid', amount_untaxed: 325000, amount_total: 373750, amount_residual: 0, invoice_date: day(40), invoice_date_due: day(10), invoice_origin: 'S00204', partner_id: p(51, 'Palm Tower Contracting'), invoice_user_id: lina, write_date: at(12) },
      { id: 304, name: 'INV/2026/0251', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_untaxed: 900000, amount_total: 1035000, amount_residual: 1035000, invoice_date: day(75), invoice_date_due: day(45), invoice_origin: 'S00205', partner_id: p(55, 'Desert Rose Hotels'), invoice_user_id: omar, write_date: at(75) },
      { id: 305, name: 'INV/2026/0122', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_untaxed: 120000, amount_total: 138000, amount_residual: 138000, invoice_date: day(200), invoice_date_due: day(170), invoice_origin: '', partner_id: p(54, 'Eastern Malls Co'), invoice_user_id: omar, write_date: at(170) },
      { id: 306, name: 'RINV/2026/0004', move_type: 'out_refund', state: 'posted', payment_state: 'paid', amount_untaxed: 20000, amount_total: 23000, amount_residual: 0, invoice_date: day(25), invoice_date_due: day(25), invoice_origin: 'S00204', partner_id: p(51, 'Palm Tower Contracting'), invoice_user_id: lina, write_date: at(25) },
      { id: 307, name: 'INV/2026/0400', move_type: 'out_invoice', state: 'draft', payment_state: 'not_paid', amount_untaxed: 50000, amount_total: 57500, amount_residual: 57500, invoice_date: false, invoice_date_due: false, invoice_origin: 'S00206', partner_id: p(56, 'Eastern Schools Co'), invoice_user_id: lina, write_date: at(1) },
    ],
    'account.payment': [
      { id: 601, name: 'PBNK1/2026/0090', date: day(3), amount: 350750, partner_id: p(51, 'Palm Tower Contracting'), payment_type: 'inbound', partner_type: 'customer', state: 'paid', write_date: at(3) },
      { id: 602, name: 'PBNK1/2026/0071', date: day(30), amount: 1080000, partner_id: p(50, 'Crescent Developments'), payment_type: 'inbound', partner_type: 'customer', state: 'paid', write_date: at(30) },
      { id: 603, name: 'PBNK1/2026/0095', date: day(1), amount: 15000, partner_id: p(54, 'Eastern Malls Co'), payment_type: 'inbound', partner_type: 'customer', state: 'draft', write_date: at(1) },
    ],
    // Income (positive) and costs (negative) on each project's analytic account.
    'account.analytic.line': [
      { id: 701, name: 'INV/2026/0301', date: day(5), amount: 380000, account_id: [501, 'Najd clinic lighting'], project_id: false, category: 'invoice', write_date: at(5) },
      { id: 702, name: 'Fixtures (vendor bill)', date: day(10), amount: -250000, account_id: [501, 'Najd clinic lighting'], project_id: false, category: 'vendor_bill', write_date: at(10) },
      { id: 703, name: 'Site hours', date: day(4), amount: -20000, account_id: [501, 'Najd clinic lighting'], project_id: [401, 'Najd clinic lighting'], category: 'other', write_date: at(4) },
      { id: 704, name: 'INV/2026/0210', date: day(110), amount: 1200000, account_id: [502, 'Crescent tower phase 1'], project_id: false, category: 'invoice', write_date: at(110) },
      { id: 705, name: 'Fixtures and freight (vendor bills)', date: day(90), amount: -1010000, account_id: [502, 'Crescent tower phase 1'], project_id: false, category: 'vendor_bill', write_date: at(90) },
      { id: 706, name: 'INV/2026/0288', date: day(40), amount: 325000, account_id: [503, 'Palm Tower parking'], project_id: false, category: 'invoice', write_date: at(40) },
      { id: 707, name: 'Drivers and housings', date: day(30), amount: -240000, account_id: [503, 'Palm Tower parking'], project_id: false, category: 'vendor_bill', write_date: at(30) },
      { id: 708, name: 'INV/2026/0251', date: day(75), amount: 900000, account_id: [504, 'Desert Rose hotel lobby'], project_id: false, category: 'invoice', write_date: at(75) },
      { id: 709, name: 'Chandeliers (vendor bill)', date: day(70), amount: -690000, account_id: [504, 'Desert Rose hotel lobby'], project_id: false, category: 'vendor_bill', write_date: at(70) },
    ],
    'project.project.stage': st,
    'project.project': [
      // On track: in production well within its 60 days.
      { id: 401, name: 'Najd clinic lighting', active: true, partner_id: p(53, 'Najd Health Projects'), user_id: sara, date_start: day(30), date: day(-40), last_update_status: 'on_track', stage_id: stage(4), date_last_stage_update: at(20), account_id: [501, 'Najd clinic lighting'], sale_order_id: [201, 'S00201'], write_date: at(2) },
      // Red: 25 days in client review (14 allowed); margin 6 points under plan.
      { id: 402, name: 'Crescent tower phase 1', active: true, partner_id: p(50, 'Crescent Developments'), user_id: khalid, date_start: day(130), date: false, last_update_status: 'at_risk', stage_id: stage(2), date_last_stage_update: at(25), account_id: [502, 'Crescent tower phase 1'], sale_order_id: [203, 'S00203'], write_date: at(1) },
      // Amber: a submittal came back C four days ago.
      { id: 403, name: 'Palm Tower parking', active: true, partner_id: p(51, 'Palm Tower Contracting'), user_id: sara, date_start: day(45), date: day(-90), last_update_status: 'on_track', stage_id: stage(1), date_last_stage_update: at(5), account_id: [503, 'Palm Tower parking'], sale_order_id: [204, 'S00204'], write_date: at(4) },
      // Red: its delivery date passed during installation. Linked from the order's side.
      { id: 404, name: 'Desert Rose hotel lobby', active: true, partner_id: p(55, 'Desert Rose Hotels'), user_id: khalid, date_start: day(160), date: day(3), last_update_status: 'off_track', stage_id: stage(6), date_last_stage_update: at(10), account_id: [504, 'Desert Rose hotel lobby'], sale_order_id: false, write_date: at(3) },
      // Just awarded; no delivery date in Odoo yet.
      { id: 405, name: 'Eastern schools lighting', active: true, partner_id: p(56, 'Eastern Schools Co'), user_id: sara, date_start: day(2), date: false, last_update_status: false, stage_id: stage(0), date_last_stage_update: at(2), account_id: false, sale_order_id: [206, 'S00206'], write_date: at(2) },
      { id: 406, name: 'Old warehouse (archived)', active: false, partner_id: p(54, 'Eastern Malls Co'), user_id: khalid, date_start: day(400), date: day(300), last_update_status: 'done', stage_id: stage(8), date_last_stage_update: at(300), account_id: false, sale_order_id: false, write_date: at(280) },
    ],
    'project.task': [
      { id: 801, name: 'Shop drawings', project_id: [402, 'Crescent tower phase 1'], stage_id: [1, 'In progress'], user_ids: [10], date_deadline: day(6), active: true, priority: '1', state: '01_in_progress', date_last_stage_update: at(20), write_date: at(6) },
      { id: 802, name: 'Fixture schedule revision', project_id: [402, 'Crescent tower phase 1'], stage_id: [1, 'In progress'], user_ids: [10], date_deadline: day(-3), active: true, priority: '0', state: '02_changes_requested', date_last_stage_update: at(4), write_date: at(4) },
      { id: 803, name: 'Factory acceptance test', project_id: [401, 'Najd clinic lighting'], stage_id: [1, 'In progress'], user_ids: [9], date_deadline: day(-12), active: true, priority: '0', state: '01_in_progress', date_last_stage_update: at(8), write_date: at(8) },
      { id: 804, name: 'Resubmit driver datasheets', project_id: [403, 'Palm Tower parking'], stage_id: [1, 'In progress'], user_ids: [9], date_deadline: day(-3), active: true, priority: '1', state: '01_in_progress', date_last_stage_update: at(4), write_date: at(4) },
      { id: 805, name: 'Commissioning report', project_id: [404, 'Desert Rose hotel lobby'], stage_id: [2, 'Done'], user_ids: [10], date_deadline: day(1), active: true, priority: '0', state: '1_done', date_last_stage_update: at(1), write_date: at(1) },
      { id: 806, name: 'Snag list', project_id: [404, 'Desert Rose hotel lobby'], stage_id: [1, 'In progress'], user_ids: [10], date_deadline: day(2), active: true, priority: '1', state: '01_in_progress', date_last_stage_update: at(2), write_date: at(2) },
    ],
    'project.update': [
      { id: 901, name: 'Week 41', project_id: [401, 'Najd clinic lighting'], status: 'on_track', date: day(3), user_id: sara, progress: 55, write_date: at(3) },
      { id: 902, name: 'Week 40', project_id: [402, 'Crescent tower phase 1'], status: 'at_risk', date: day(9), user_id: khalid, progress: 30, write_date: at(9) },
    ],
    // Each stage's planned date, as a milestone named after the stage.
    'project.milestone': [
      { id: 1001, name: 'Awarded', project_id: [401, 'Najd clinic lighting'], deadline: day(28), is_reached: true, reached_date: day(29), write_date: at(29) },
      { id: 1002, name: 'Production & shipping', project_id: [401, 'Najd clinic lighting'], deadline: day(-25), is_reached: false, reached_date: false, write_date: at(20) },
      { id: 1003, name: 'Handover', project_id: [401, 'Najd clinic lighting'], deadline: day(-40), is_reached: false, reached_date: false, write_date: at(20) },
      // Crescent: client review was planned to end six days ago.
      { id: 1004, name: 'Client review', project_id: [402, 'Crescent tower phase 1'], deadline: day(6), is_reached: false, reached_date: false, write_date: at(25) },
      // Palm: the technical submittal is due in two days.
      { id: 1005, name: 'Technical submittal', project_id: [403, 'Palm Tower parking'], deadline: day(-2), is_reached: false, reached_date: false, write_date: at(5) },
    ],
    'ir.attachment': [
      { id: 1101, name: 'Lighting layout rev C.pdf', mimetype: 'application/pdf', res_model: 'project.project', res_id: 402, create_date: at(30), write_date: at(30) },
      { id: 1102, name: 'Consultant comments round 1.pdf', mimetype: 'application/pdf', res_model: 'project.task', res_id: 802, create_date: at(4), write_date: at(4) },
      { id: 1103, name: 'Fixture schedule.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', res_model: 'project.project', res_id: 401, create_date: at(20), write_date: at(20) },
    ],
  }
  // The consultant, as a field Arak would add in Odoo Studio (Odoo has none).
  const consultant = { 401: 'Example Health Engineering', 402: 'Example Design Consultants', 403: 'Example MEP Partners', 404: 'Example Hospitality Design' }
  data['project.project'] = data['project.project'].map(pr => ({ ...pr, x_studio_consultant: consultant[pr.id] || false }))
  return data
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
