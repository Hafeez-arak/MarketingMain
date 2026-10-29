// ─── Pricing: the rules the screens share (v2) ─────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Pure: no React, no IO, so it is
// tested (logic.test.js). The database computes and repeats every rule that
// matters (20261201_pricing_2_rules.sql: the cost views, the issues, the
// workflow); these give the person the reason before the round trip, filter
// and group the list, and read a BOQ from a file or from pasted Excel rows.

export const PAGE_SIZE = 30
export const MAX_BOQ_ROWS = 2000
export const BASE_CURRENCY = 'SAR'
export const STATUSES = ['draft', 'submitted', 'approved', 'cancelled']
export const QUOTE_STATUSES = ['requested', 'received', 'declined']
export const COST_CATEGORIES = ['goods', 'installation', 'subcontract', 'other']
/** The checks the database reports; the first nine block, the rest only warn (a margin note frees the last two). */
export const ISSUE_CODES = ['NO_LINES', 'MIN_MARGIN_UNSET', 'UNPRICED', 'NO_SUPPLIER', 'COST_UNKNOWN', 'QUOTE_EXPIRED', 'QUOTE_VALIDITY_UNKNOWN', 'QTY_SHORT', 'BELOW_COST', 'BELOW_MIN_MARGIN']

const trim = v => String(v ?? '').trim()
const blank = v => trim(v) === ''

/** Western digits and a plain decimal point from what Excel or a keyboard gives; null when it is not a number. */
export function parseNumber(v) {
  const map = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.' }
  const s = String(v ?? '').replace(/[٠-٩٫٬,\s]/g, c => map[c] ?? '')
  if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  return Number(s)
}

/** A number for a database column: empty is null (unknown), never 0. */
export const numOrNull = v => (blank(v) ? null : parseNumber(v))

// ── The list ──

/** His filters: any of the chosen statuses, and (separately) only my sheets. */
export const SHEET_FILTERS = [
  { key: 'draft', group: 's' }, { key: 'submitted', group: 's' }, { key: 'approved', group: 's' }, { key: 'cancelled', group: 's' },
  { key: 'mine', group: 'o' },
]
export const SHEET_GROUPS = ['status']

/** Sheets that pass the active filters: OR within a group, AND across groups. */
export function filterSheets(sheets = [], active = [], me = null) {
  const byGroup = {}
  for (const k of active) {
    const f = SHEET_FILTERS.find(x => x.key === k)
    if (f) (byGroup[f.group] ||= []).push(f.key)
  }
  return sheets.filter(s => Object.entries(byGroup).every(([g, keys]) =>
    g === 's' ? keys.includes(s.status) : (g === 'o' ? Boolean(me) && s.created_by === me : true)))
}

/** Search over the sheet's number and title and its opportunity's number and title. */
export function searchSheets(sheets = [], q = '', leadsById = {}) {
  const needle = trim(q).toLowerCase()
  if (!needle) return sheets
  return sheets.filter(s => {
    const l = leadsById[s.lead_id] || {}
    return [s.sheet_no, s.title, l.lead_no, l.title].some(v => String(v || '').toLowerCase().includes(needle))
  })
}

/** Work in progress first by the opportunity's bid due date (the real priority), then the rest, newest first. */
export function sortSheets(sheets = [], leadsById = {}) {
  const live = s => (s.status === 'draft' || s.status === 'submitted' ? 0 : 1)
  const due = s => leadsById[s.lead_id]?.bid_due_date || null
  return [...sheets].sort((a, b) =>
    live(a) - live(b)
    || (due(a) === null) - (due(b) === null)
    || String(due(a)).localeCompare(String(due(b)))
    || String(b.sheet_no).localeCompare(String(a.sheet_no)))
}

/** Rows grouped by status in the workflow's order: [{ key, rows }]. */
export function groupSheets(rows = [], group = '') {
  if (group !== 'status') return [{ key: '', rows }]
  return STATUSES.map(key => ({ key, rows: rows.filter(r => r.status === key) })).filter(g => g.rows.length)
}

export function pageOf(rows = [], page = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages)
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages }
}

// ── Money and margin ──

/** Margin on the selling price, %: (sell − cost) / sell; null when either is unknown or the sell is 0. */
export function marginPct(sell, cost) {
  if (sell === null || sell === undefined || cost === null || cost === undefined) return null
  const s = Number(sell)
  if (!Number.isFinite(s) || s <= 0) return null
  return Math.round(((s - Number(cost)) / s) * 10000) / 100
}

/** Is a line's margin worth a red mark: below zero, or below the minimum when one is set. */
export const isLowMargin = (margin, min) => margin !== null && margin !== undefined && (Number(margin) < 0 || (min !== null && min !== undefined && Number(margin) < Number(min)))

export const fmtMoney = v => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
/** A quantity or rate without trailing zeros. */
export const fmtNum = v => (v === null || v === undefined || v === '' ? '' : String(Number(v)))

/** Issues grouped by code in the database's order: [{ code, blocking, lines }]. */
export function groupIssues(issues = []) {
  const out = []
  for (const i of issues) {
    let g = out.find(x => x.code === i.code)
    if (!g) { g = { code: i.code, blocking: Boolean(i.blocking), lines: [] }; out.push(g) }
    if (i.line_no !== null && i.line_no !== undefined) g.lines.push(i.line_no)
  }
  return out
}

/** The steps shown on the status bar. */
export const statusPath = status => (status === 'cancelled' ? ['draft', 'cancelled'] : ['draft', 'submitted', 'approved'])

/** Which workflow buttons this person sees: { edit, submit, return, approve, cancel }. Levels: view < work < manage. */
export function sheetActions(status, rank) {
  const work = rank >= 2
  const manage = rank >= 3
  return {
    edit: status === 'draft' && work,
    submit: status === 'draft' && work,
    return: status === 'submitted' && work,
    approve: status === 'submitted' && manage,
    cancel: status !== 'cancelled' && (status === 'draft' ? work : manage),
    remove: status === 'draft' && work,
  }
}

// ── Opportunities for a new sheet ──

/** Open opportunities, the nearest bid date first (a sheet always belongs to one). */
export function openLeads(leads = []) {
  return leads.filter(l => l.status === 'open').sort((a, b) =>
    (a.bid_due_date === null) - (b.bid_due_date === null) || String(a.bid_due_date).localeCompare(String(b.bid_due_date)) || String(b.lead_no).localeCompare(String(a.lead_no)))
}

// ── The BOQ ──

/** A cell value matched to a cost category by its English or Arabic name or its code. */
export const CATEGORY_NAMES = {
  goods: ['goods', 'بضاعة'], installation: ['installation', 'تركيب'], subcontract: ['subcontract', 'مقاول باطن'], other: ['other', 'أخرى'],
}
export function parseCategory(v) {
  const s = trim(v).toLowerCase()
  if (!s) return null
  return COST_CATEGORIES.find(c => CATEGORY_NAMES[c].some(n => n.toLowerCase() === s)) || undefined
}

/** The header names his import accepts, Arabic or English. */
export const BOQ_HEADERS = {
  boq_ref: ['رقم البند', 'البند', 'المرجع', 'item', 'item no', 'item no.', 'ref', 'ref.', 'no', 'no.', 'boq ref'],
  description: ['الوصف', 'البيان', 'description', 'item description'],
  quantity: ['الكمية', 'qty', 'qty.', 'quantity'],
  unit: ['الوحدة', 'unit', 'uom'],
  cost_category: ['التصنيف', 'تصنيف التكلفة', 'category', 'cost category'],
}
/** The template's header row, in the language asked. */
export const BOQ_TEMPLATE_HEAD = { en: ['Item no.', 'Description', 'Quantity', 'Unit', 'Category'], ar: ['رقم البند', 'الوصف', 'الكمية', 'الوحدة', 'التصنيف'] }

/**
 * Cells from CSV or tab-separated text (Excel's clipboard). Quotes may hold
 * the separator, a doubled quote is a quote, and a quoted cell may hold
 * line breaks. The separator is the tab if the first line has one, else a
 * semicolon if it has one and no comma, else a comma.
 */
export function parseDelimited(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '')
  const first = src.split(/\r?\n/, 1)[0] || ''
  const sep = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const normHeader = v => trim(v).replace(/\s+/g, ' ').toLowerCase()

/**
 * A BOQ from the first row (the header) and the rows under it. Required: the
 * description, the quantity and the unit (no unit is assumed). Every row is
 * checked first; one bad row imports nothing and its row number is reported.
 * Returns { rows } or { errors: [{ row, code, value? }] } where code is one of
 * 'noRows' | 'missingColumn' | 'noDescription' | 'badQuantity' | 'noUnit' | 'badCategory' | 'tooMany'.
 */
export function parseBoq(cells) {
  const data = (cells || []).filter(r => r.some(c => !blank(c)) || r.length > 1)
  if (data.length < 2) return { errors: [{ code: 'noRows' }] }
  const cols = {}
  data[0].forEach((h, i) => {
    const n = normHeader(h)
    for (const [field, names] of Object.entries(BOQ_HEADERS)) if (cols[field] === undefined && names.some(x => x.toLowerCase() === n)) cols[field] = i
  })
  const missing = ['description', 'quantity', 'unit'].filter(f => cols[f] === undefined)
  if (missing.length) return { errors: missing.map(f => ({ code: 'missingColumn', value: f })) }
  const rows = []
  const errors = []
  data.slice(1).forEach((r, i) => {
    const n = i + 2
    const get = f => (cols[f] === undefined ? '' : trim(r[cols[f]]))
    const ref = get('boq_ref'); const desc = get('description'); const qty = get('quantity'); const unit = get('unit'); const cat = get('cost_category')
    if (!desc && !qty && !unit) return // an empty row, or a section heading with a reference only
    if (!desc) { errors.push({ row: n, code: 'noDescription' }); return }
    const q = parseNumber(qty)
    if (q === null || q <= 0) errors.push({ row: n, code: 'badQuantity', value: qty })
    if (!unit) errors.push({ row: n, code: 'noUnit' })
    const category = cat ? parseCategory(cat) : null
    if (cat && category === undefined) errors.push({ row: n, code: 'badCategory', value: cat })
    rows.push({ boq_ref: ref ? ref.slice(0, 60) : null, description: desc.slice(0, 2000), quantity: q === null ? 0 : Math.round(q * 1000) / 1000, unit: unit.slice(0, 30), cost_category: category || null })
  })
  if (rows.length > MAX_BOQ_ROWS) return { errors: [{ code: 'tooMany', value: MAX_BOQ_ROWS }] }
  if (errors.length) return { errors }
  if (!rows.length) return { errors: [{ code: 'noRows' }] }
  return { rows }
}

/** The BOQ editor's rows, checked: { index: { field: code } }; empty when they can be saved. */
export function validateLines(lines = []) {
  const e = {}
  lines.forEach((l, i) => {
    const x = {}
    if (blank(l.description)) x.description = 'required'
    const q = parseNumber(l.quantity)
    if (q === null || q <= 0) x.quantity = 'positive'
    if (blank(l.unit)) x.unit = 'required'
    if (Object.keys(x).length) e[i] = x
  })
  if (!lines.length) e._ = { rows: 'atLeastOne' }
  return e
}

/** The editor's rows as the save function takes them. */
export function linesPayload(lines = []) {
  return lines.map(l => ({
    ...(l.id ? { id: l.id } : {}),
    boq_ref: blank(l.boq_ref) ? null : trim(l.boq_ref),
    description: trim(l.description),
    quantity: parseNumber(l.quantity),
    unit: trim(l.unit),
    catalog_item_id: l.catalog_item_id || null,
    cost_category: l.cost_category || null,
  }))
}

// ── Supplier quotes ──

export const emptyQuoteRequest = () => ({ supplier_id: '', currency: BASE_CURRENCY, requested_on: '', notes: '' })

/** What is wrong with a quote's header: { field: code }. */
export function validateQuote(h = {}) {
  const e = {}
  if (!QUOTE_STATUSES.includes(h.status)) e.status = 'required'
  if (blank(h.requested_on)) e.requested_on = 'required'
  if (h.status === 'received' && blank(h.received_on)) e.received_on = 'required'
  if (!blank(h.received_on) && !blank(h.valid_until) && h.valid_until < h.received_on) e.valid_until = 'beforeReceived'
  if (!blank(h.fx_rate)) { const r = parseNumber(h.fx_rate); if (r === null || r <= 0) e.fx_rate = 'positive' }
  for (const k of ['freight_amount', 'customs_amount', 'other_charges']) {
    if (!blank(h[k])) { const v = parseNumber(h[k]); if (v === null || v < 0) e[k] = 'nonNegative' }
  }
  return e
}

/** The header as the save function takes it: empty strings stay empty (unknown), numbers as text. */
export function quoteHeaderPayload(h = {}) {
  const num = v => (blank(v) ? '' : String(parseNumber(v)))
  return {
    status: h.status, currency: h.currency, requested_on: h.requested_on,
    received_on: h.received_on || '', valid_until: h.valid_until || '', supplier_ref: trim(h.supplier_ref), notes: trim(h.notes),
    // A quote in the base currency has rate 1, whatever is typed.
    fx_rate: h.currency === BASE_CURRENCY ? '' : num(h.fx_rate),
    freight_amount: num(h.freight_amount), customs_amount: num(h.customs_amount), other_charges: num(h.other_charges),
  }
}

/** Are all three landed charges known (a charge known to be none is 0)? */
export const chargesKnown = q => ['freight_amount', 'customs_amount', 'other_charges'].every(k => q?.[k] !== null && q?.[k] !== undefined)

/** The offers of the quote's lines as the save function takes them. */
export function offersPayload(offers = []) {
  return offers.map(o => ({
    id: o.id, quantity: parseNumber(o.quantity), unit_price: blank(o.unit_price) ? '' : String(parseNumber(o.unit_price)),
    brand: trim(o.brand), model_no: trim(o.model_no), offered_description: trim(o.offered_description),
    lead_time_days: blank(o.lead_time_days) ? '' : String(parseNumber(o.lead_time_days)),
  }))
}

export function validateOffers(offers = []) {
  const e = {}
  offers.forEach(o => {
    const x = {}
    const q = parseNumber(o.quantity)
    if (q === null || q <= 0) x.quantity = 'positive'
    if (!blank(o.unit_price)) { const p = parseNumber(o.unit_price); if (p === null || p < 0) x.unit_price = 'nonNegative' }
    if (!blank(o.lead_time_days)) { const d = parseNumber(o.lead_time_days); if (d === null || d < 0 || !Number.isInteger(d)) x.lead_time_days = 'wholeNumber' }
    if (Object.keys(x).length) e[o.id] = x
  })
  return e
}

/** New alternatives as the save function takes them; a row without a line, or with nothing offered, is dropped. */
export function altsPayload(alts = []) {
  return alts
    .filter(a => a.pricing_line_id && (!blank(a.unit_price) || !blank(a.brand) || !blank(a.model_no)))
    .map(a => ({
      pricing_line_id: a.pricing_line_id, unit_price: blank(a.unit_price) ? '' : String(parseNumber(a.unit_price)),
      quantity: blank(a.quantity) ? '' : String(parseNumber(a.quantity)), brand: trim(a.brand), model_no: trim(a.model_no), offered_description: trim(a.offered_description),
    }))
}

// ── Comparison ──

/** The lowest known landed cost among a line's offers, or null. */
export function bestCost(offers = []) {
  const known = offers.map(o => o.landed_unit_cost).filter(v => v !== null && v !== undefined).map(Number)
  return known.length ? Math.min(...known) : null
}

/** Offers keyed by `${line}-${quote}` for the comparison grid, alternatives after the main offer. */
export function offerGrid(offers = []) {
  const grid = {}
  for (const o of [...offers].sort((a, b) => Number(a.is_alternative) - Number(b.is_alternative))) (grid[`${o.pricing_line_id}-${o.quote_id}`] ||= []).push(o)
  return grid
}

/** Is a quote's validity date in the past (Riyadh's today given as YYYY-MM-DD)? */
export const expired = (validUntil, today) => Boolean(validUntil) && String(validUntil).slice(0, 10) < today

// ── The history ──

/** A history row as { who, action, changes: [[field, from, to]] } for the sheet's own columns. */
export function describeAudit(row, show = (f, v) => v) {
  const o = row.old_data || {}
  const n = row.new_data || {}
  const skip = new Set(['updated_at', 'created_at', 'workspace_id', 'id'])
  const changes = row.action === 'update'
    ? Object.keys(n).filter(k => !skip.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).map(k => [k, show(k, o[k]), show(k, n[k])])
    : []
  return { table: row.table_name, action: row.action, label: n.title || o.title || n.description || o.description || n.quote_no || o.quote_no || n.sheet_no || o.sheet_no || '', changes }
}
