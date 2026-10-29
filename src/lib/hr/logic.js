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

import { docState as documentState } from '../documents/logic'

export const DOC_WARN_DAYS = 60 // papers expiring within this many days are "soon" (his number)
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled']
export const CONTRACT_STATUSES = ['draft', 'running', 'expired', 'cancelled']
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor']
export const ID_TYPES = ['national_id', 'iqama', 'passport']

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

/**
 * Employees matching a search (names, number, trade, job, email, phone), a
 * department, a status and a kind: 'direct' | 'indirect' | 'docs' (papers
 * expiring: needs `expiringIds`) | 'noContract' (needs `runningIds`).
 */
export function filterEmployees(employees, { q = '', department = '', status = 'active', kind = '', expiringIds = null, runningIds = null } = {}) {
  const needle = q.trim().toLowerCase()
  return employees.filter(e =>
    (!status || e.status === status)
    && (!department || (department === 'none' ? !e.department_id : e.department_id === department))
    && (!kind
      || (kind === 'direct' && e.is_direct_labor)
      || (kind === 'indirect' && !e.is_direct_labor)
      || (kind === 'docs' && Boolean(expiringIds?.has(e.id)))
      || (kind === 'noContract' && e.status === 'active' && runningIds != null && !runningIds.has(e.id)))
    && (!needle || [e.name_en, e.name_ar, e.employee_no, e.trade, e.job_title, e.work_email, e.work_phone]
      .some(v => String(v || '').toLowerCase().includes(needle))))
}

/** Rows grouped by 'department' | 'job' | 'manager' (or one group when `by` is empty): [{ key, rows }] in the order found. */
export function groupEmployees(rows, by = '') {
  if (!by) return [{ key: '', rows }]
  const keyOf = e => (by === 'department' ? e.department_id : by === 'job' ? e.job_id : by === 'manager' ? e.manager_id : '') || ''
  const groups = new Map()
  for (const e of rows) {
    const k = keyOf(e)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(e)
  }
  return [...groups].map(([key, list]) => ({ key, rows: list }))
}

// ── Papers and contracts ──

/**
 * Papers of active employees that have expired or are within their type's
 * alert days (the Documents app's rule), soonest first. `typesById` are the
 * company's document types.
 */
export function expiringDocs(docs, employees, typesById, today) {
  const active = new Set(employees.filter(e => e.status === 'active').map(e => e.id))
  return docs
    .filter(d => active.has(d.employee_id) && ['expired', 'expiring'].includes(documentState(d, typesById[d.type_id], today)))
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)))
}

/** Running, with an end date within DOC_WARN_DAYS (his "ending soon"; past-due ones count). */
export const contractEndingSoon = (c, today) => c.status === 'running' && Boolean(c.end_date) && c.end_date <= addDays(today, DOC_WARN_DAYS)

/**
 * What a contract's page may offer: edit (a draft only), start (a draft),
 * close (a running one, with its end date), cancel (draft or running). The
 * database checks the same, and that only one contract runs at a time.
 */
export function contractActions(c, level = null) {
  const manage = level === 'manage'
  return {
    edit: manage && c.status === 'draft',
    start: manage && c.status === 'draft',
    close: manage && c.status === 'running',
    cancel: manage && (c.status === 'draft' || c.status === 'running'),
  }
}

/** The least end date a closing may have: the contract's start. */
export const closeProblem = (c, endDate) => (!endDate || endDate < c.start_date ? 'dates' : null)

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
 * A balance on a day, counted as the database counts it (his ledger): the
 * allocations valid that day, less the approved days of requests that start
 * inside one of those windows (each request once). `pending` is every
 * waiting request of the type; `until` the latest end of the windows valid
 * that day; `granted` is null when no allocation is valid that day.
 */
export function ledgerBalance({ allocations = [], requests = [], employeeId, typeId, on }) {
  const mine = allocations.filter(a => a.employee_id === employeeId && a.leave_type_id === typeId)
  const valid = mine.filter(a => a.valid_from <= on && on <= a.valid_to)
  const granted = valid.length ? valid.reduce((n, a) => n + Number(a.days), 0) : null
  const reqs = requests.filter(r => r.employee_id === employeeId && r.leave_type_id === typeId)
  const used = reqs.filter(r => r.status === 'approved' && valid.some(a => r.date_from >= a.valid_from && r.date_from <= a.valid_to))
    .reduce((n, r) => n + Number(r.days), 0)
  const pending = reqs.filter(r => r.status === 'pending').reduce((n, r) => n + Number(r.days), 0)
  return { granted, used, pending, remaining: (granted ?? 0) - used, until: valid.length ? valid.map(a => a.valid_to).sort().at(-1) : null }
}

/**
 * What this person may do with a request: { approve, reject, cancel }.
 * `level` is their HR level; `myEmployeeId` the employee their login is
 * linked to. His app: only the leave approver (Manage here) decides, never
 * their own; a pending request is cancelled by the employee or the approver,
 * an approved one by the approver. The same rules as hr_leave_decide().
 */
export function leaveActions(request, { level = null, myEmployeeId = '' } = {}) {
  const manage = level === 'manage'
  const own = Boolean(myEmployeeId) && request.employee_id === myEmployeeId
  const pending = request.status === 'pending'
  return {
    approve: pending && manage && !own,
    reject: pending && manage && !own,
    cancel: (pending && (own || manage)) || (request.status === 'approved' && manage),
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
    ['hr_job_positions_name', 'DUP_NAME'], ['hr_employees_employment_type', 'EMPLOYMENT_TYPE'],
    ['hr_employee_private_identity_uq', 'DUP_IDENTITY'], ['hr_employee_private_id_typed', 'ID_NEEDS_TYPE'],
    ['hr_contracts_one_running', 'ONE_RUNNING'], ['hr_contracts_weekly_hours', 'WEEKLY_HOURS'], ['hr_contracts_no_uq', 'DUP_NUMBER'],
    ['hr_leave_allocations_reason', 'ALLOC_REASON'], ['hr_leave_allocations_days', 'ALLOC_DAYS'], ['hr_leave_allocations_dates', 'DATES'],
    ['hr_documents_file_place', 'FILE_PLACE'], ['hr_documents_file_size', 'FILE_SIZE'],
    ['row-level security', 'NO_RIGHT'], ['permission denied', 'NO_RIGHT'],
  ]) if (m.includes(needle)) return key
  return ''
}

// ── History ──

const QUIET = new Set(['id', 'workspace_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'employee_id', 'file_size'])

/** The fields that changed in one history row: [{ field, from, to }]. An insert lists what was set; a delete what was held. */
export function describeChange(row) {
  const oldD = row.old_data || {}
  const newD = row.new_data || {}
  const keys = [...new Set([...Object.keys(newD), ...Object.keys(oldD)])].filter(k => !QUIET.has(k))
  if (row.action === 'update') return keys.filter(k => JSON.stringify(oldD[k]) !== JSON.stringify(newD[k])).map(k => ({ field: k, from: oldD[k] ?? null, to: newD[k] ?? null }))
  const src = row.action === 'insert' ? newD : oldD
  return keys.filter(k => src[k] !== null && src[k] !== '' && src[k] !== undefined).map(k => ({ field: k, from: null, to: src[k] }))
}
