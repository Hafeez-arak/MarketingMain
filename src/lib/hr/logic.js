// ─── HR: the rules the screens need, pure (v2) ─────────────────────────────
// 2026-10-28. Musa's HR (employees, leave, attendance) rewritten into v2 in
// our own stack; dev/erp-pilot/HR.md has the whole story. The database
// enforces the rules (supabase/migrations/20261112_hr_*.sql); this file
// shows them before a click: what is left of a balance, who is off, which
// papers are running out, and what a refusal from the database means in
// words. Attendance has its own file: attendance.js.
//
// Days are 'YYYY-MM-DD' strings in Riyadh's calendar and times 'HH:MM'
// (or 'HH:MM:SS' as Postgres returns them). No React, no IO.

export const DOC_WARN_DAYS = 60 // papers expiring within this many days are "soon" (his number)
export const DOC_TYPES = ['national_id', 'iqama', 'passport', 'work_permit', 'health_cert', 'driving_license', 'other']
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled']

const DAY_MS = 86_400_000
const toUtc = day => Date.parse(`${day}T00:00:00Z`)
const fromUtc = ms => new Date(ms).toISOString().slice(0, 10)

/** Today in Riyadh, 'YYYY-MM-DD'. */
export function riyadhToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
}

/** `day` moved by `n` days. */
export const addDays = (day, n) => fromUtc(toUtc(day) + n * DAY_MS)

/** Whole days from a to b (b − a). */
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS)

/** 0 = Sunday … 6 = Saturday. */
export const weekday = day => new Date(toUtc(day)).getUTCDay()

/** Calendar days from `from` to `to`, both counted. */
export const spanDays = (from, to) => (from && to && to >= from ? daysBetween(from, to) + 1 : 0)

/** Every day of a month 'YYYY-MM'. */
export function monthDays(month) {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** The days of the company's work week between two dates; the calendar span when the week is not set. */
export function workingDays(from, to, workDays = []) {
  const n = spanDays(from, to)
  if (!workDays?.length) return n
  let count = 0
  for (let i = 0; i < n; i++) if (workDays.includes(weekday(addDays(from, i)))) count++
  return count
}

// ── Names ──

/** A row's name in this language, falling back to the other one. */
export function nameOf(row, lang = 'en') {
  if (!row) return ''
  const en = (row.name_en || '').trim()
  const ar = (row.name_ar || '').trim()
  return lang === 'ar' ? ar || en : en || ar
}

/** The login whose email is this work email (case and spaces ignored), or null. */
export function matchLogin(email, logins = []) {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return null
  return logins.find(l => String(l.email || '').trim().toLowerCase() === e) || null
}

// ── The directory ──

/** Employees matching a search (names, number, job, email, phone), a department and a status. */
export function filterEmployees(employees, { q = '', department = '', status = 'active' } = {}) {
  const needle = q.trim().toLowerCase()
  return employees.filter(e =>
    (!status || e.status === status)
    && (!department || (department === 'none' ? !e.department_id : e.department_id === department))
    && (!needle || [e.name_en, e.name_ar, e.employee_no, e.job_title, e.work_email, e.work_phone]
      .some(v => String(v || '').toLowerCase().includes(needle))))
}

// ── Papers and contracts ──

/** 'none' (no expiry) | 'expired' | 'soon' | 'ok', and the days left. */
export function docState(doc, today) {
  if (!doc?.expiry_date) return { state: 'none', days: null }
  const days = daysBetween(today, doc.expiry_date)
  return { state: days < 0 ? 'expired' : days <= DOC_WARN_DAYS ? 'soon' : 'ok', days }
}

/** Papers of active employees that have expired or expire soon, soonest first. */
export function expiringDocs(docs, employees, today) {
  const active = new Set(employees.filter(e => e.status === 'active').map(e => e.id))
  return docs
    .filter(d => active.has(d.employee_id) && ['expired', 'soon'].includes(docState(d, today).state))
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
}

/** 'upcoming' | 'current' | 'ended'. */
export function contractState(c, today) {
  if (c.start_date > today) return 'upcoming'
  if (c.end_date && c.end_date < today) return 'ended'
  return 'current'
}

// ── Leave ──

/**
 * What is wrong with a request before it is sent, or null. Keys of the
 * words file: dates, days, tooMany, overlap.
 */
export function leaveProblem({ from, to, days }, others = [], employeeId = '') {
  if (!from || !to || to < from) return 'dates'
  const d = Number(days)
  if (!(d > 0) || Math.round(d * 2) !== d * 2) return 'days'
  if (d > spanDays(from, to)) return 'tooMany'
  if (overlapping(others, employeeId, from, to).length) return 'overlap'
  return null
}

/** This person's pending or approved requests that touch these dates. */
export function overlapping(requests, employeeId, from, to, ignoreId = '') {
  return requests.filter(r => r.employee_id === employeeId && r.id !== ignoreId
    && ['pending', 'approved'].includes(r.status) && r.date_from <= to && r.date_to >= from)
}

/**
 * A balance in a year, counted as the database counts it: granted − the
 * approved days of requests starting that year; pending shown beside it.
 * `granted` is null when nothing was granted (or the type keeps no balance).
 */
export function balanceOf({ balances = [], requests = [], employeeId, typeId, year }) {
  const b = balances.find(x => x.employee_id === employeeId && x.leave_type_id === typeId && Number(x.year) === Number(year))
  const mine = requests.filter(r => r.employee_id === employeeId && r.leave_type_id === typeId && Number(r.date_from.slice(0, 4)) === Number(year))
  const sum = st => mine.filter(r => r.status === st).reduce((n, r) => n + Number(r.days), 0)
  const granted = b ? Number(b.days) : null
  const used = sum('approved')
  return { granted, used, pending: sum('pending'), remaining: (granted ?? 0) - used }
}

/**
 * What this person may do with a request: { approve, reject, cancel }.
 * `level` is their HR level; `myEmployeeId` the employee their login is
 * linked to; `managerOf(employeeId)` whether they are that person's direct
 * manager. The same rules as hr_leave_decide().
 */
export function leaveActions(request, { level = null, myEmployeeId = '', managerOf = () => false } = {}) {
  const rank = { view: 1, work: 2, manage: 3 }[level] || 0
  const own = Boolean(myEmployeeId) && request.employee_id === myEmployeeId
  const approver = !own && (rank >= 3 || (rank >= 1 && managerOf(request.employee_id)))
  const pending = request.status === 'pending'
  return {
    approve: pending && approver,
    reject: pending && approver,
    cancel: (pending && (own || rank >= 2)) || (request.status === 'approved' && rank >= 3),
  }
}

/** Approved leave covering a day. */
export const offOn = (requests, day) => requests.filter(r => r.status === 'approved' && r.date_from <= day && r.date_to >= day)

// ── What the database said ──

/**
 * A refusal from the database, in words. Our own codes (HR_…) and the named
 * constraints map to a key of the words file's `errors`; anything else is
 * shown as it came.
 */
export function errorKey(message = '') {
  const m = String(message)
  const code = m.match(/\bHR_[A-Z_]+/)?.[0]
  if (code) return code
  for (const [needle, key] of [
    ['hr_employees_no_uq', 'DUP_NUMBER'], ['hr_employees_user_uq', 'DUP_LOGIN'],
    ['hr_departments_name', 'DUP_NAME'], ['hr_leave_types_name', 'DUP_NAME'],
    ['hr_employees_ended', 'END_NEEDS_REASON'], ['hr_documents_other_named', 'OTHER_NEEDS_NOTE'],
    ['hr_documents_dates', 'DATES'], ['hr_contracts_dates', 'DATES'], ['hr_contracts_fixed_ends', 'FIXED_NEEDS_END'],
    ['hr_leave_requests_days', 'DAYS'], ['hr_leave_requests_dates', 'DATES'],
    ['hr_attendance_span', 'SPAN'], ['hr_attendance_one_open', 'ONE_OPEN'], ['hr_settings_schedule', 'SCHEDULE'],
    ['hr_employees_device_user_no', 'DUP_DEVICE_NO'], ['hr_devices_name', 'NAME_NEEDED'],
    ['hr_employees_email', 'EMAIL'], ['_named', 'NAME_NEEDED'],
    ['row-level security', 'NO_RIGHT'], ['permission denied', 'NO_RIGHT'],
  ]) if (m.includes(needle)) return key
  return ''
}
