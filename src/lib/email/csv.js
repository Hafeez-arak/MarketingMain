import { cleanContact, isValidEmail, normalizeEmail } from './contacts.js'

// ─── CSV in and out ────────────────────────────────────────────────────────
// Import is where a new sending domain is most often ruined: one bad
// spreadsheet of stale addresses bounces at 20% and the domain is marked as a
// spammer on day one. So this parser is strict about addresses and honest in
// its report — every row that is not imported says why.

/** RFC 4180-ish: quoted fields, doubled quotes, commas/semicolons/tabs. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] || ''
  // Excel in Arabic and European locales saves with semicolons.
  const counts = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of firstLine) if (ch in counts) counts[ch]++
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ','

  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => String(c).trim() !== ''))
}

// Header spellings people actually use → our column. Matched after
// lower-casing and stripping everything that is not a letter or digit.
const HEADER_MAP = {
  email: 'email', emailaddress: 'email', mail: 'email', eaddress: 'email', البريد: 'email',
  البريدالإلكتروني: 'email', البريدالالكتروني: 'email',
  firstname: 'first_name', first: 'first_name', givenname: 'first_name', fname: 'first_name', الاسمالأول: 'first_name',
  lastname: 'last_name', last: 'last_name', surname: 'last_name', familyname: 'last_name', lname: 'last_name',
  name: 'full_name', fullname: 'full_name', contactname: 'full_name', الاسم: 'full_name',
  company: 'company', companyname: 'company', organisation: 'company', organization: 'company', account: 'company', الشركة: 'company',
  jobtitle: 'job_title', title: 'job_title', position: 'job_title', role: 'job_title', designation: 'job_title', المسمىالوظيفي: 'job_title',
  phone: 'phone', mobile: 'phone', phonenumber: 'phone', mobilephone: 'phone', tel: 'phone', الجوال: 'phone', الهاتف: 'phone',
  city: 'city', المدينة: 'city',
  country: 'country', الدولة: 'country',
  type: 'contact_type', contacttype: 'contact_type', category: 'contact_type', segment: 'contact_type',
  language: 'language', lang: 'language', preferredlanguage: 'language', اللغة: 'language',
  notes: 'notes', note: 'notes', comments: 'notes', ملاحظات: 'notes',
}

export function headerKey(h) {
  const k = String(h || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return HEADER_MAP[k] || ''
}

function languageOf(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (['ar', 'arabic', 'عربي', 'العربية'].includes(v)) return 'ar'
  if (['en', 'english', 'انجليزي', 'الإنجليزية'].includes(v)) return 'en'
  return ''
}

/**
 * Parsed rows → contacts ready to write, plus a report of what was left out.
 *
 * @param {string[][]} rows   parseCsv output; the first row is the header
 * @param {object} defaults   { audience, language, consent, contact_type }
 * @param {Set<string>} [existing] emails already in the workspace
 * @returns {{ contacts: object[], rejected: {row:number, email:string, reason:string}[], columns: string[] }}
 */
export function rowsToContacts(rows, defaults = {}, existing = new Set()) {
  const [header = [], ...body] = rows || []
  let columns = header.map(headerKey)
  let dataRows = body
  // No header row at all, just addresses: treat the column that holds
  // addresses as `email`.
  if (!columns.includes('email')) {
    const emailCol = header.findIndex(v => isValidEmail(v))
    if (emailCol >= 0) {
      columns = header.map((_, i) => (i === emailCol ? 'email' : ''))
      dataRows = rows
    }
  }

  const contacts = []
  const rejected = []
  const seen = new Set()
  if (!columns.includes('email')) {
    return { contacts, rejected: [{ row: 1, email: '', reason: 'No email column found. Name a column "Email".' }], columns }
  }

  dataRows.forEach((cells, i) => {
    const rowNo = i + (dataRows === rows ? 1 : 2)
    const raw = {}
    columns.forEach((key, c) => { if (key && cells[c] !== undefined && !raw[key]) raw[key] = String(cells[c]).trim() })
    if (raw.full_name && !raw.first_name && !raw.last_name) {
      const parts = raw.full_name.split(/\s+/)
      raw.first_name = parts.shift() || ''
      raw.last_name = parts.join(' ')
    }
    const email = normalizeEmail(raw.email)
    if (!email) { rejected.push({ row: rowNo, email: '', reason: 'No email address' }); return }
    if (!isValidEmail(email)) { rejected.push({ row: rowNo, email, reason: 'Not a valid email address' }); return }
    if (seen.has(email)) { rejected.push({ row: rowNo, email, reason: 'Duplicate in this file' }); return }
    if (existing.has(email)) { rejected.push({ row: rowNo, email, reason: 'Already in your contacts' }); return }
    seen.add(email)
    const language = languageOf(raw.language) || defaults.language || 'en'
    contacts.push(cleanContact({
      ...raw,
      email,
      language,
      audience: defaults.audience,
      consent: defaults.consent,
      contact_type: raw.contact_type || defaults.contact_type || '',
      source: 'import',
    }, defaults))
  })
  return { contacts, rejected, columns }
}

function cell(v) {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const EXPORT_COLUMNS = [
  'email', 'first_name', 'last_name', 'company', 'job_title', 'phone', 'city', 'country',
  'contact_type', 'audience', 'language', 'consent', 'status', 'source', 'groups', 'notes', 'created_at',
]

/** Contacts → CSV text (with a BOM so Excel opens Arabic correctly). */
export function contactsToCsv(contacts, groupNamesOf = () => []) {
  const lines = [EXPORT_COLUMNS.join(',')]
  for (const c of contacts || []) {
    lines.push(EXPORT_COLUMNS.map(k => cell(k === 'groups' ? groupNamesOf(c).join('; ') : c[k])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}
