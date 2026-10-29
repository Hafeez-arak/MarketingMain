import { normalizeSearch } from '../contacts/logic'

// ─── Documents: what the screens decide without asking the database ────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. Pure: the state of a document,
// the list's filters and figures, the review form's checks, Hijri dates, the
// alert schedule, file checks. The database has the last word on every rule
// (supabase/migrations/20261201_documents_2_rules.sql); these say it first,
// next to the field.

export const LINK_KINDS = ['company', 'employee', 'asset', 'supplier']
/** Fixed assets are not in v2 yet: the kind exists, nothing takes it. */
export const LINK_READY = { company: true, employee: true, asset: false, supplier: true }
export const COMPANY_FIELDS = ['cr_number', 'vat_number']
export const FIELDS = ['number', 'issuer', 'issue_date', 'expiry_date']
export const STATES = ['expired', 'expiring', 'valid', 'no_expiry', 'awaiting', 'archived']
export const PAGE_SIZE = 30
/** The two windows of the list's figures (days to the expiry). */
export const SOON_DAYS = [30, 90]
export const FILE_MAX_BYTES = 20 * 1024 * 1024
export const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
export const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'

/** Today in Riyadh (YYYY-MM-DD): the company's day, whatever the browser's zone. */
export function riyadhToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
}

const dayNumber = iso => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / 86_400_000)
/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from)

export function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** A type's name in this language (Arabic first, as the company wrote it). */
export const typeName = (t, lang) => (lang === 'en' && t?.name_en ? t.name_en : t?.name || '')

/** The largest alert day of a type, or null when it has none: where "expiring" begins. */
export const warnDays = type => (type?.alert_days?.length ? Math.max(...type.alert_days) : null)

/** Days to the expiry (negative once expired), or null without one. */
export const daysLeft = (doc, today) => (doc?.expiry_date ? daysBetween(today, doc.expiry_date) : null)

/**
 * 'archived' | 'draft' | 'no_expiry' | 'expired' | 'expiring' | 'valid': the
 * same rule everywhere (his v_company_documents): expiring is within the
 * type's largest alert day.
 */
export function docState(doc, type, today) {
  if (doc.archived_at) return 'archived'
  if (!doc.confirmed_at) return 'draft'
  if (!doc.expiry_date) return 'no_expiry'
  const left = daysBetween(today, doc.expiry_date)
  if (left < 0) return 'expired'
  const warn = warnDays(type)
  return warn !== null && left <= warn ? 'expiring' : 'valid'
}

// ── Who may do what (the database enforces the same; this hides the buttons) ──

export const isRestricted = doc => Boolean(doc?.confidential) || doc?.link_kind === 'employee'

/** `level` is the person's level in the documents section: 'view' | 'work' | 'manage' | null. */
export function canManageDoc(doc, level) {
  return isRestricted(doc) ? level === 'manage' : level === 'work' || level === 'manage'
}
/** May this level create a document of this kind? */
export const canCreateKind = (kind, level) => (kind === 'employee' ? level === 'manage' : level === 'work' || level === 'manage')

// ── The list ──

/** Soonest expiry first (none last); drafts first; archived last. */
export function sortDocuments(docs) {
  const rank = d => (d.archived_at ? 2 : d.confirmed_at ? 1 : 0)
  return [...docs].sort((a, b) =>
    rank(a) - rank(b)
    || (a.expiry_date ? 0 : 1) - (b.expiry_date ? 0 : 1)
    || String(a.expiry_date || '').localeCompare(String(b.expiry_date || ''))
    || String(b.document_no).localeCompare(String(a.document_no)))
}

/**
 * The list's filters: search (number, title, DOC- number, issuer, type, who it
 * is linked to), type, link kind, state, responsible, and "ends within N
 * days". Archived ones show only under the archived state.
 */
export function filterDocuments(docs, f, ctx) {
  const { typesById = {}, pendingIds = new Set(), today, linkNames = {} } = ctx
  const q = normalizeSearch(f.q || '')
  const within = Number(f.within) || 0
  return docs.filter(d => {
    const state = docState(d, typesById[d.type_id], today)
    if (f.state === 'archived') { if (state !== 'archived') return false } else if (state === 'archived') return false
    if (f.state === 'awaiting') { if (!(state === 'draft' || pendingIds.has(d.id))) return false }
    else if (f.state && f.state !== 'archived' && state !== f.state) return false
    if (f.type_id && d.type_id !== f.type_id) return false
    if (f.link_kind && d.link_kind !== f.link_kind) return false
    if (f.responsible_id && d.responsible_id !== f.responsible_id) return false
    if (within) {
      if (!d.confirmed_at || !d.expiry_date) return false
      const left = daysBetween(today, d.expiry_date)
      if (left < 0 || left > Math.min(within, 3650)) return false
    }
    if (q) {
      const t = typesById[d.type_id]
      const hay = normalizeSearch([d.document_no, d.title, d.number, d.issuer, t?.name, t?.name_en, linkNames[d.id]].filter(Boolean).join(' '))
      if (!q.split(' ').every(w => hay.includes(w))) return false
    }
    return true
  })
}

/** The five figures above the list (his index). `docs` are what the person may see. */
export function figures(docs, types, ctx) {
  const { pendingIds = new Set(), today, openTasks = new Set() } = ctx
  const live = docs.filter(d => d.confirmed_at && !d.archived_at)
  const expired = live.filter(d => d.expiry_date && d.expiry_date < today).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
  const within = days => live.filter(d => d.expiry_date && d.expiry_date >= today && daysBetween(today, d.expiry_date) <= days)
  const soon = within(SOON_DAYS[0])
  const required = types.filter(t => t.is_required && t.is_active)
  const present = new Set(live.filter(d => !d.expiry_date || d.expiry_date >= today).map(d => d.type_id))
  const missing = required.filter(t => !present.has(t.id))
  const awaiting = docs.filter(d => !d.archived_at && (!d.confirmed_at || pendingIds.has(d.id)))
  return {
    expired: { count: expired.length, names: expired.slice(0, 2).map(d => d.title) },
    soon: { count: soon.length, tasks: soon.filter(d => openTasks.has(d.id)).length },
    later: { count: within(SOON_DAYS[1]).length },
    required: { total: required.length, held: required.length - missing.length, missing: missing.slice(0, 2).map(t => t.id) },
    awaiting: { count: awaiting.length },
  }
}

// ── Review and confirm ──

/** Which fields the type requires that are still empty: ['number', 'expiry_date']. */
export function missingFields(type, v) {
  const out = []
  if (type?.number_required && !String(v.number || '').trim()) out.push('number')
  if (type?.issuer_required && !String(v.issuer || '').trim()) out.push('issuer')
  if (type?.issue_date_required && !v.issue_date) out.push('issue_date')
  if (type?.expiry_required && !v.expiry_date) out.push('expiry_date')
  return out
}

/** Where each filled field came from: what was suggested if it still matches, else typed by hand. */
export function sourcesFor(values, suggestions = {}) {
  const out = {}
  for (const f of FIELDS) {
    const val = values[f]
    if (val === null || val === undefined || String(val).trim() === '') continue
    let src = 'manual'
    for (const origin of ['ai', 'file']) {
      const s = suggestions?.[origin]?.[f]
      if (s && String(s.value) === String(val)) { src = origin; break }
    }
    out[f] = src
  }
  return out
}

/** Field problems on the review form, keyed by field; the type's required ones only when confirming. */
export function reviewProblems(type, v, { confirm }) {
  const p = {}
  if (!String(v.title || '').trim()) p.title = 'required'
  else if (String(v.title).length > 200) p.title = 'long'
  if (String(v.number || '').length > 60) p.number = 'long'
  if (String(v.issuer || '').length > 200) p.issuer = 'long'
  if (v.issue_date && v.expiry_date && v.expiry_date < v.issue_date) p.expiry_date = 'order'
  if (confirm) {
    for (const f of missingFields(type, v)) p[f] = p[f] || 'needed'
    if (!v.responsible_id) p.responsible_id = 'needed'
  }
  return p
}

// ── The document type form ──

/** "90, 30، 7" → [90, 30, 7] (largest first, no repeats); null for text that is not a list of days. */
export function parseAlertDays(text) {
  const s = String(text ?? '').trim()
  if (!s) return []
  if (!/^\d{1,4}(\s*[,،]\s*\d{1,4}){0,5}$/.test(s)) return null
  const days = [...new Set(s.split(/[,،]/).map(Number))].filter(d => d > 0 && d <= 1000)
  return days.sort((a, b) => b - a)
}

export function typeProblems(t, { names = [], ownId = null } = {}) {
  const p = {}
  const name = String(t.name || '').trim()
  if (!name) p.name = 'required'
  else if (name.length > 120) p.name = 'long'
  else if (names.some(n => n.id !== ownId && String(n.name).trim() === name)) p.name = 'taken'
  if (!t.link_kinds?.length) p.link_kinds = 'required'
  if (parseAlertDays(t.alert_days_text) === null) p.alert_days = 'format'
  const task = t.task_days_before
  if (task !== '' && task !== null && task !== undefined && !(Number.isInteger(Number(task)) && Number(task) >= 0 && Number(task) <= 1000)) p.task_days = 'range'
  if (t.number_pattern) {
    if (String(t.number_pattern).length > 200) p.number_pattern = 'long'
    else { try { new RegExp(t.number_pattern, 'u') } catch { p.number_pattern = 'regex' } }
  }
  return p
}

// ── Hijri dates (Umm al-Qura), by the browser's own calendar ──

const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' })

/** '2026-10-29' → { y, m, d } in the Umm al-Qura calendar. */
export function gregorianToHijri(iso) {
  const parts = HIJRI.formatToParts(new Date(`${iso}T12:00:00Z`))
  const get = type => Number(parts.find(p => p.type === type)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** { y, m, d } in Umm al-Qura → '2026-10-29', or null when there is no such day. */
export function hijriToGregorian(y, m, d) {
  if (!(y >= 1300 && y <= 1600) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 30)) return null
  const guess = Date.UTC(622, 6, 16) + ((y - 1) * 354.36708 + (m - 1) * 29.530588 + (d - 1)) * 86_400_000
  for (let off = -6; off <= 6; off++) {
    const iso = new Date(guess + off * 86_400_000).toISOString().slice(0, 10)
    const h = gregorianToHijri(iso)
    if (h.y === y && h.m === m && h.d === d) return iso
  }
  return null
}

const EASTERN = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }

/** "١٤٤٨/٠٥/٠٨ هـ", "1448-5-8" → { y: 1448, m: 5, d: 8 }; null when it is not a Hijri date. */
export function parseHijri(text) {
  const s = String(text || '').replace(/[٠-٩]/g, c => EASTERN[c]).replace(/هـ|ه/g, '').trim()
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s)
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
}

/**
 * The Gregorian date from the date field or, when only it is filled, the Hijri
 * one; both must agree. { value } or { error: 'hijriFormat' | 'hijriMismatch' }.
 */
export function dateFromInputs(greg, hijri) {
  const h = String(hijri || '').trim()
  let fromHijri = null
  if (h) {
    const p = parseHijri(h)
    fromHijri = p ? hijriToGregorian(p.y, p.m, p.d) : null
    if (!fromHijri) return { error: 'hijriFormat' }
  }
  if (greg && fromHijri && greg !== fromHijri) return { error: 'hijriMismatch' }
  return { value: greg || fromHijri || null }
}

// ── The alert schedule on a document's page ──

/**
 * What will happen, and what has: one row per alert day of the type, then the
 * renewal task, then "after the expiry". `alerts` are the document_alerts rows.
 */
export function alertSchedule(doc, type, alerts, today) {
  if (!doc.expiry_date || !type) return []
  const mine = alerts.filter(a => a.expiry_date === doc.expiry_date)
  const rows = []
  for (const n of type.alert_days || []) {
    const at = addDays(doc.expiry_date, -n)
    const hit = mine.find(a => a.kind === 'notice' && a.days_before === n)
    rows.push({ kind: 'notice', days: n, at, status: hit ? hit.status : at <= today ? 'due' : 'later' })
  }
  if (type.task_days_before !== null && type.task_days_before !== undefined) {
    const at = addDays(doc.expiry_date, -type.task_days_before)
    const hit = mine.find(a => a.kind === 'task')
    rows.push({ kind: 'task', days: type.task_days_before, at, status: hit ? 'sent' : at <= today ? 'due' : 'later', taskId: hit?.task_id || null })
  }
  return rows
}

// ── Files ──

/** 'FILE_TYPE' | 'FILE_SIZE' | null. */
export function fileProblem(file) {
  if (!file) return null
  if (!FILE_TYPES.includes(file.type)) return 'FILE_TYPE'
  if (file.size < 1 || file.size > FILE_MAX_BYTES) return 'FILE_SIZE'
  return null
}

export const formatBytes = n => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** SHA-256 of a file's bytes as hex: the same file twice is refused by it. */
export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
/** <workspace>/<document>/<fresh id>.<ext>: nothing is ever overwritten. */
export function filePath(ws, documentId, file, id = crypto.randomUUID()) {
  return `${ws}/${documentId}/${id}.${EXT[file.type] || 'bin'}`
}

// ── Titles and links ──

/** "Iqama — Laila": the type, and who or what it is linked to. */
export function defaultTitle(type, linkName, lang) {
  const base = typeName(type, lang) || ''
  return linkName ? `${base} — ${linkName}` : base
}

/** What the old HR "papers expiring" filter and the employee page use: confirmed, in force or ending, per the document's own type. */
export function papersToRenew(docs, typesById, today) {
  return docs.filter(d => d.link_kind === 'employee' && ['expired', 'expiring'].includes(docState(d, typesById[d.type_id], today)))
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)))
}

// ── Refusals ──

/** The code a refusal carries ('DOCUMENT_LOCKED'), or the constraint it names; '' when neither. */
export function errorKey(err) {
  const msg = String(err?.message || err || '')
  const code = /\b(DOCUMENT_[A-Z_]+)\b/.exec(msg)
  if (code) return code[1]
  const named = [
    ['document_types_name_uq', 'nameTaken'], ['company_documents_link', 'DOCUMENT_LINK'], ['company_document_versions_dates', 'dates'],
    ['company_documents_dates', 'dates'], ['company_document_versions_place', 'DOCUMENT_VERSION_FILE'], ['company_document_versions_file_uq', 'DOCUMENT_FILE_REPEATED'],
    ['company_document_versions_pending_uq', 'DOCUMENT_VERSION_PENDING'], ['company_documents_employee_fk', 'employeeUsed'],
  ].find(([c]) => msg.includes(c))
  if (named) return named[1]
  if (err?.code === '42501' || msg.includes('row-level security')) return 'notAllowed'
  return ''
}
