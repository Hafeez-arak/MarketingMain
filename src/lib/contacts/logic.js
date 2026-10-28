// ─── Contacts: the rules the screens share ─────────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. One record per organisation or
// person with several roles at once (Musa's ERP, item 3). The database
// (20261120_contacts_2_rules.sql) refuses what breaks a rule; this says so
// before saving, field by field, and finds likely duplicates, which the
// database cannot (a similar name is a warning, not a refusal).
//
// Pure: no React, no IO, so it is tested (logic.test.js). Words are in
// pages/contacts/words.js: these functions return codes.

/** The roles, in the order the database keeps them. */
export const ROLES = ['client', 'supplier', 'main_contractor', 'consultant', 'subcontractor', 'sister_company']

/** The quick filters above the list. `roles`: any of these. */
export const QUICK = [
  { key: 'all', roles: [] },
  { key: 'clients', roles: ['client'] },
  { key: 'suppliers', roles: ['supplier'] },
  { key: 'contractors', roles: ['main_contractor', 'subcontractor'] },
  { key: 'consultants', roles: ['consultant'] },
]

/** A client company registered for VAT gives these (his rule, for e-invoicing). */
export const ADDRESS_REQUIRED = ['nat_building_no', 'nat_street', 'nat_district', 'city', 'nat_postal_code']

export const ORG_FIELDS = [
  'kind', 'name', 'name_ar', 'roles', 'vat_number', 'cr_number', 'country',
  'nat_building_no', 'nat_street', 'nat_district', 'city', 'nat_postal_code', 'nat_additional_no', 'address',
  'phone', 'email', 'website', 'category_id', 'iban', 'swift', 'payment_terms_days', 'notes',
]
export const PERSON_FIELDS = ['org_id', 'name', 'name_ar', 'job_title', 'phone', 'email', 'is_primary', 'notes']

const DIGITS = ['nat_building_no', 'nat_postal_code', 'nat_additional_no']
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const blank = v => v === null || v === undefined || String(v).trim() === ''
const clean = v => (blank(v) ? '' : String(v).trim())

/** A VAT number as stored: digits only once spaces are out. */
export const tidyVat = v => clean(v).replace(/\s+/g, '')
/** An IBAN or SWIFT as stored: no spaces, capitals. */
export const tidyCode = v => clean(v).replace(/\s+/g, '').toUpperCase()

/** Outside the Kingdom (his isForeign): a country other than SA. */
export const isForeign = o => Boolean(o?.country) && String(o.country).toUpperCase() !== 'SA'

/** A supplier's details (category, banking, terms) apply: we buy from it or pay it. */
export const paysUs = f => (f.roles || []).some(r => r === 'supplier' || r === 'subcontractor')

export function emptyOrg() {
  return {
    kind: 'company', name: '', name_ar: '', roles: [], vat_number: '', cr_number: '', country: 'SA',
    nat_building_no: '', nat_street: '', nat_district: '', city: '', nat_postal_code: '', nat_additional_no: '', address: '',
    phone: '', email: '', website: '', category_id: '', iban: '', swift: '', payment_terms_days: '', notes: '',
  }
}

export function emptyPerson(orgId = '') {
  return { org_id: orgId || '', name: '', name_ar: '', job_title: '', phone: '', email: '', is_primary: false, notes: '' }
}

/** Does this organisation have to give its national address? */
export const needsAddress = f => f.kind === 'company' && !blank(tidyVat(f.vat_number)) && (f.roles || []).includes('client')

/**
 * What is wrong with an organisation's fields: { field: code }, empty when
 * it can be saved. Codes: required, vat_format, digits, email, role,
 * address_required, country, iban, iban_sa, swift, terms.
 */
export function validateOrg(f) {
  const e = {}
  if (blank(f.name)) e.name = 'required'
  const vat = tidyVat(f.vat_number)
  if (vat && !/^[0-9]{15}$/.test(vat)) e.vat_number = 'vat_format'
  for (const k of DIGITS) if (!blank(f[k]) && !/^[0-9]{1,10}$/.test(clean(f[k]))) e[k] = 'digits'
  if (!blank(f.email) && !EMAIL.test(clean(f.email))) e.email = 'email'
  if (!blank(f.country) && !/^[A-Za-z]{2}$/.test(clean(f.country))) e.country = 'country'
  if ((f.roles || []).some(r => !ROLES.includes(r))) e.roles = 'role'
  // His IBAN rule: any country's shape, the Saudi shape when the country is SA.
  const iban = tidyCode(f.iban)
  if (iban && !/^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$/.test(iban)) e.iban = 'iban'
  else if (iban && !isForeign({ country: clean(f.country) || 'SA' }) && !/^SA[0-9]{2}[0-9A-Z]{20}$/.test(iban)) e.iban = 'iban_sa'
  if (!blank(f.swift) && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(tidyCode(f.swift))) e.swift = 'swift'
  if (!blank(f.payment_terms_days) && !(/^[0-9]+$/.test(clean(f.payment_terms_days)) && Number(f.payment_terms_days) <= 3650)) e.payment_terms_days = 'terms'
  if (needsAddress(f)) for (const k of ADDRESS_REQUIRED) if (blank(f[k]) && !e[k]) e[k] = 'address_required'
  return e
}

export function validatePerson(p) {
  const e = {}
  if (blank(p.name)) e.name = 'required'
  if (!blank(p.email) && !EMAIL.test(clean(p.email))) e.email = 'email'
  return e
}

/** The row to send: trimmed, blanks as null, roles in the fixed order. */
export function orgRow(f) {
  const row = {}
  for (const k of ORG_FIELDS) {
    if (k === 'roles') row.roles = ROLES.filter(r => (f.roles || []).includes(r))
    else if (k === 'notes') row.notes = clean(f.notes)
    else if (k === 'kind') row.kind = f.kind === 'individual' ? 'individual' : 'company'
    else if (k === 'vat_number') row.vat_number = tidyVat(f.vat_number) || null
    else if (k === 'country') row.country = clean(f.country).toUpperCase() || 'SA'
    else if (k === 'email') row.email = clean(f.email).toLowerCase() || null
    else if (k === 'iban' || k === 'swift') row[k] = tidyCode(f[k]) || null
    else if (k === 'payment_terms_days') row[k] = blank(f[k]) ? null : Number(f[k])
    else row[k] = clean(f[k]) || null
  }
  return row
}

export function personRow(p) {
  return {
    org_id: p.org_id || null,
    name: clean(p.name),
    name_ar: clean(p.name_ar) || null,
    job_title: clean(p.job_title) || null,
    phone: clean(p.phone) || null,
    email: clean(p.email).toLowerCase() || null,
    is_primary: Boolean(p.org_id) && Boolean(p.is_primary),
    notes: clean(p.notes),
  }
}

// ── The duplicate guard ──

// Words that say what kind of firm it is, not which one: "Najd Towers Co"
// and "Najd Towers Company Ltd" are the same firm.
const NOISE = new Set([
  'co', 'company', 'companies', 'ltd', 'limited', 'llc', 'est', 'establishment', 'corp', 'corporation', 'inc',
  'group', 'the', 'and', 'for', 'of', 'trading', 'srl', 'spa', 'test',
  'شركة', 'شركه', 'مؤسسة', 'مؤسسه', 'مجموعة', 'مجموعه', 'المحدودة', 'المحدوده', 'محدودة', 'ذات', 'مسؤولية', 'مسئولية', 'تجربة', 'تجربه', 'و',
])

/**
 * A name reduced to what identifies it: lower case, Arabic letter forms
 * folded (أ إ آ → ا, ة → ه, ى → ي, no diacritics), punctuation out, firm-type
 * words out.
 */
export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(w => w && !NOISE.has(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ')
}

function distance(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** Are these two names very likely the same firm? */
export function similarNames(a, b) {
  const x = normalizeName(a), y = normalizeName(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  // One inside the other, as whole words ("Najd Towers" / "Najd Towers Riyadh").
  if (short.length >= 5 && ` ${long} `.includes(` ${short} `)) return true
  // A typo or two: about one edit per eight letters.
  return short.length >= 6 && distance(x, y) <= Math.max(1, Math.floor(long.length / 8))
}

/**
 * Organisations in this company that look like the one being entered:
 * [{ org, reasons: ['vat'|'cr'|'name'], blocking }]. Same VAT or CR blocks
 * (the database refuses it too); a similar name only warns. `selfId`: the
 * one being edited, which is never its own duplicate.
 */
export function findDuplicates(f, orgs = [], selfId = '') {
  const vat = tidyVat(f.vat_number)
  const cr = clean(f.cr_number).toLowerCase()
  const out = []
  for (const o of orgs) {
    if (o.id === selfId) continue
    const reasons = []
    if (vat && o.vat_number === vat) reasons.push('vat')
    if (cr && clean(o.cr_number).toLowerCase() === cr) reasons.push('cr')
    const names = [f.name, f.name_ar].filter(n => !blank(n))
    const theirs = [o.name, o.name_ar].filter(n => !blank(n))
    if (names.some(n => theirs.some(t => similarNames(n, t)))) reasons.push('name')
    if (reasons.length) out.push({ org: o, reasons, blocking: reasons.includes('vat') || reasons.includes('cr') })
  }
  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.reasons.length - a.reasons.length)
}

// ── The list ──

/** The name to show: the Arabic one in Arabic when there is one. */
export const displayName = (row, lang = 'en') => (lang === 'ar' && !blank(row?.name_ar) ? row.name_ar : row?.name || '')
/** The other language's name, shown smaller under it. */
export const otherName = (row, lang = 'en') => (lang === 'ar' ? (!blank(row?.name_ar) ? row.name : '') : row?.name_ar || '')

const hasAny = (org, roles) => !roles.length || roles.some(r => (org.roles || []).includes(r))

/**
 * The organisations to list. `quick`: a QUICK key; `role`: one role;
 * `status`: 'active' | 'archived' | 'all'; `kind`: 'company' | 'individual';
 * `vat`: 'yes' registered for VAT, 'no' not; `foreign`: outside the
 * Kingdom only; `category`: a category id; `q`: words found in the names,
 * the number, VAT, CR, city, phone or email (each word must appear somewhere).
 * His client and supplier lists' filters, on one list.
 */
export function filterOrgs(orgs = [], { q = '', quick = 'all', role = '', status = 'active', kind = '', vat = '', foreign = false, category = '' } = {}) {
  const quickRoles = QUICK.find(x => x.key === quick)?.roles || []
  const words = normalizeSearch(q).split(' ').filter(Boolean)
  return orgs.filter(o =>
    (status === 'all' || o.status === status)
    && hasAny(o, quickRoles)
    && (!role || (o.roles || []).includes(role))
    && (!kind || o.kind === kind)
    && (!vat || (vat === 'yes') === Boolean(o.vat_number))
    && (!foreign || isForeign(o))
    && (!category || o.category_id === category)
    && (!words.length || matches(searchText(o), words)))
}

export const GROUPS = ['kind', 'city', 'category']

/**
 * Rows in groups, as his lists' "group by": [{ key, rows }], groups in
 * order of their title, the empty key ("no city") last. `title(key)` names
 * a group for sorting.
 */
export function groupOrgs(rows = [], by = '', title = k => k) {
  if (!GROUPS.includes(by)) return [{ key: '', rows }]
  const keyOf = o => (by === 'kind' ? o.kind : by === 'city' ? clean(o.city) : o.category_id || '')
  const groups = new Map()
  for (const o of rows) {
    const k = keyOf(o)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(o)
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, rows: list }))
    .sort((a, b) => (a.key === '') - (b.key === '') || String(title(a.key)).localeCompare(String(title(b.key))))
}

/** People to list: `q` over names, title, phone, email and organisation; `scope` 'all' | 'with' | 'alone'. */
export function filterPeople(people = [], orgsById = {}, { q = '', scope = 'all' } = {}) {
  const words = normalizeSearch(q).split(' ').filter(Boolean)
  return people.filter(p =>
    (scope === 'all' || (scope === 'alone' ? !p.org_id : Boolean(p.org_id)))
    && (!words.length || matches(searchText({ ...p, org: orgsById[p.org_id] }), words)))
}

/** How many active organisations each quick filter would show. */
export function quickCounts(orgs = []) {
  const active = orgs.filter(o => o.status === 'active')
  return Object.fromEntries(QUICK.map(x => [x.key, active.filter(o => hasAny(o, x.roles)).length]))
}

const normalizeSearch = s => String(s || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/\s+/g, ' ').trim()

function searchText(o) {
  return normalizeSearch([
    o.contact_no, o.name, o.name_ar, o.vat_number, o.cr_number, o.city, o.phone, o.email, o.job_title,
    o.org?.name, o.org?.name_ar,
  ].filter(Boolean).join(' ') + ' ' + String(o.phone || '').replace(/\D/g, ''))
}

const matches = (text, words) => words.every(w => text.includes(w))

// ── CSV import ──

/**
 * CSV text → rows of cells. Quotes ("a, b" and "" for a quote), commas or
 * semicolons (whichever the header line uses), CRLF, a leading BOM.
 */
export function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '')
  const firstLine = s.split(/\r?\n/, 1)[0] || ''
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

// Header → field. English, the field's own name and Arabic all work.
const HEADERS = {
  name: ['name', 'name (english)', 'english name', 'organisation', 'organization', 'company', 'الاسم', 'الاسم بالإنجليزية'],
  name_ar: ['name_ar', 'arabic name', 'name (arabic)', 'الاسم بالعربية', 'الاسم العربي'],
  kind: ['kind', 'type', 'النوع'],
  roles: ['roles', 'role', 'الأدوار', 'الدور'],
  vat_number: ['vat_number', 'vat', 'vat number', 'الرقم الضريبي'],
  cr_number: ['cr_number', 'cr', 'cr number', 'commercial registration', 'السجل التجاري', 'رقم السجل التجاري'],
  country: ['country', 'الدولة'],
  nat_building_no: ['nat_building_no', 'building', 'building no', 'building number', 'رقم المبنى'],
  nat_street: ['nat_street', 'street', 'الشارع'],
  nat_district: ['nat_district', 'district', 'الحي'],
  city: ['city', 'المدينة'],
  nat_postal_code: ['nat_postal_code', 'postal code', 'postcode', 'zip', 'الرمز البريدي'],
  nat_additional_no: ['nat_additional_no', 'additional no', 'additional number', 'الرقم الإضافي'],
  address: ['address', 'العنوان'],
  iban: ['iban', 'الآيبان', 'الآيبان (iban)'],
  swift: ['swift', 'swift code', 'رمز السويفت'],
  payment_terms_days: ['payment_terms_days', 'payment terms', 'payment terms (days)', 'مدة السداد', 'مدة السداد (أيام)'],
  phone: ['phone', 'telephone', 'mobile', 'الهاتف', 'الجوال'],
  email: ['email', 'e-mail', 'البريد', 'البريد الإلكتروني'],
  website: ['website', 'web', 'site', 'الموقع'],
  notes: ['notes', 'note', 'ملاحظات'],
}
const HEADER_OF = Object.fromEntries(Object.entries(HEADERS).flatMap(([f, names]) => names.map(n => [n, f])))

/** A template's first line, the field names in order. */
export const CSV_TEMPLATE = 'name,name_ar,kind,roles,vat_number,cr_number,country,city,nat_building_no,nat_street,nat_district,nat_postal_code,nat_additional_no,address,phone,email,website,iban,swift,payment_terms_days,notes'

/**
 * Role words in a cell ("client; supplier", "عميل، مورد", "main_contractor")
 * → role keys, and the words not understood. `names` maps a role key to its
 * label in each language, so a file written in either language reads.
 */
export function parseRoles(cell, names = {}) {
  const lookup = {}
  for (const r of ROLES) {
    lookup[r] = r
    lookup[r.replace(/_/g, ' ')] = r
    for (const label of names[r] || []) lookup[normalizeSearch(label)] = r
  }
  const roles = [], unknown = []
  for (const part of String(cell || '').split(/[;|,،/]+/)) {
    const w = normalizeSearch(part)
    if (!w) continue
    const r = lookup[w]
    if (r) { if (!roles.includes(r)) roles.push(r) } else unknown.push(part.trim())
  }
  return { roles: ROLES.filter(r => roles.includes(r)), unknown }
}

/**
 * A CSV file → organisations to import, each with its line (the header is
 * line 1; empty lines are skipped and not counted), its fields, what is wrong ({ field: code }, as validateOrg) and
 * its likely duplicates (against `orgs` and the rows above it).
 * `columns` lists what each header was read as; `ignored` the headers not
 * understood. `roleNames`: as parseRoles.
 */
export function csvToOrgs(text, orgs = [], roleNames = {}) {
  const rows = parseCsv(text)
  if (!rows.length) return { columns: [], ignored: [], rows: [] }
  const header = rows[0].map(h => HEADER_OF[normalizeSearch(h)] || null)
  const ignored = rows[0].filter((h, i) => !header[i] && h.trim())
  const out = []
  rows.slice(1).forEach((cells, i) => {
    const f = emptyOrg()
    const errors = {}
    header.forEach((field, c) => {
      if (!field) return
      const v = (cells[c] || '').trim()
      if (field === 'roles') {
        const r = parseRoles(v, roleNames)
        f.roles = r.roles
        if (r.unknown.length) errors.roles = 'role'
      } else if (field === 'kind') {
        const k = normalizeSearch(v)
        f.kind = ['individual', 'person', 'فرد'].includes(k) ? 'individual' : 'company'
      } else f[field] = v
    })
    Object.assign(errors, validateOrg(f), errors)
    const earlier = out.map((r, j) => ({ ...orgRow(r.fields), id: `line:${j}`, line: r.line }))
    out.push({ line: i + 2, fields: f, errors, duplicates: findDuplicates(f, [...orgs, ...earlier]) })
  })
  return { columns: header, ignored, rows: out }
}

// ── The activity log ──

// Fields the log shows by their own value; the rest are shown as written.
const IGNORED = new Set(['id', 'workspace_id', 'org_id', 'contact_no'])

/**
 * One activity row (contacts_activity) as the history shows it:
 * { who: 'person' | 'org', action, label, changes: [[field, old, new]] }.
 * `show(field, value)` writes a value for the reader (a role list, a
 * category's name); fields it does not know are written as they are.
 */
export function describeActivity(row, show = (_f, v) => v) {
  const fmt = (f, v) => (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? '—' : String(show(f, v)))
  const changes = Object.entries(row.changes || {})
    .filter(([f]) => !IGNORED.has(f))
    .map(([f, [from, to]]) => [f, fmt(f, from), fmt(f, to)])
  return { who: row.person_id ? 'person' : 'org', action: row.action, label: row.label || '', changes }
}
