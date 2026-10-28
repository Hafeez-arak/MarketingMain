import { addDays, monthDays, weekday } from './logic'

// ─── HR attendance: what the screens put together, pure (v2) ───────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. Musa's attendance rewritten in
// our stack. The database keeps the records and decides (the
// 20261128_attendance_*.sql migrations); this file reads what is recorded
// and puts one person's day together for the screens, as his AttendanceDay
// and PunchRoles do: never writes, never assumes. Without a work week or a
// schedule the planned time and "absent" are unknown («—»), not "on time".
//
// Moments come from the database as ISO strings (timestamptz); days are
// 'YYYY-MM-DD' in Riyadh's calendar, which is UTC+3 all year (no daylight
// saving). No React, no IO.

const RIYADH_MS = 3 * 3_600_000

/** A moment's Riyadh wall clock: { day: 'YYYY-MM-DD', time: 'HH:MM' }, or null. */
export function riyadh(iso) {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const s = new Date(ms + RIYADH_MS).toISOString()
  return { day: s.slice(0, 10), time: s.slice(11, 16) }
}

/** 'HH:MM' in Riyadh, or '—'. */
export const clock = iso => riyadh(iso)?.time || '—'

/** A Riyadh 'YYYY-MM-DDTHH:MM' (a datetime-local field) as an ISO moment, or null. */
export function fromRiyadh(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local || '')) return null
  return new Date(Date.parse(`${local.slice(0, 16)}:00Z`) - RIYADH_MS).toISOString()
}

/** An ISO moment as a Riyadh datetime-local value 'YYYY-MM-DDTHH:MM', or ''. */
export function toRiyadhLocal(iso) {
  const r = riyadh(iso)
  return r ? `${r.day}T${r.time}` : ''
}

/** Hours as h:mm (his hm()); '—' when unknown. */
export function hm(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return '—'
  const m = Math.round(Number(hours) * 60)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

/** Minutes between two moments (b − a). */
const minutes = (a, b) => (Date.parse(b) - Date.parse(a)) / 60_000

// ── One person's day (his AttendanceDay) ──

/**
 * Statuses: leave, present (today, in), left (in and out), single (one
 * punch, a past day: to review), absent (a working day passed with nothing
 * and no leave), not_yet (today, nothing yet), off (not a working day),
 * unknown (no work week set, nothing recorded), not_employed (before the
 * hire date / after the last day).
 */
export const DAY_STATUSES = ['leave', 'present', 'left', 'single', 'absent', 'not_yet', 'off', 'unknown', 'not_employed']
export const SOURCES = ['device', 'manual', 'corrected']

/** The company's schedule as a label 'HH:MM–HH:MM', or null when not set. */
export const scheduleLabel = s => (s?.work_start ? `${String(s.work_start).slice(0, 5)}–${String(s.work_end).slice(0, 5)}` : null)

/**
 * Every day from `from` to `to` for each employee: { [employeeId]: { [day]: day } }.
 *
 *   records    hr_attendance rows (check_in, check_out, worked_hours, source)
 *   punchDays  hr_punch_days rows of linked employees (employee_id, work_day,
 *              punches, first_at, last_at, state, device_name)
 *   flags      hr_attendance_flags rows (kind, minutes, excuse_reason)
 *   leaves     approved hr_leave_requests rows; leaveTypes to name them
 *   now        the moment "today" and the open hours are counted at
 */
export function buildDays({ employees = [], from, to, settings = null, records = [], punchDays = [], flags = [], leaves = [], leaveTypes = [], now = new Date().toISOString(), lang = 'en' }) {
  const today = riyadh(now).day
  const workDays = settings?.work_days?.length ? settings.work_days.map(Number) : null
  const schedFrom = settings?.schedule_from || null
  const key = (id, day) => `${id}|${day}`
  const punches = new Map(punchDays.filter(p => p.employee_id).map(p => [key(p.employee_id, p.work_day), p]))
  const recs = new Map()
  for (const r of [...records].sort((a, b) => Date.parse(a.check_in) - Date.parse(b.check_in))) {
    const k = key(r.employee_id, riyadh(r.check_in).day)
    if (!recs.has(k)) recs.set(k, [])
    recs.get(k).push(r)
  }
  const flagOf = new Map(flags.map(f => [`${key(f.employee_id, f.work_day)}|${f.kind}`, f]))
  const typeName = id => {
    const ty = leaveTypes.find(x => x.id === id)
    return ty ? (lang === 'ar' && ty.name_ar) || ty.name_en || ty.name_ar : ''
  }
  const out = {}
  for (const e of employees) {
    out[e.id] = {}
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const p = punches.get(key(e.id, date)) || null
      const rs = recs.get(key(e.id, date)) || []
      const leave = leaves.find(l => l.employee_id === e.id && l.status === 'approved' && l.date_from <= date && l.date_to >= date) || null
      const isWorkDay = workDays === null ? null : workDays.includes(weekday(date))
      const scheduled = settings?.work_start && schedFrom && date >= schedFrom && isWorkDay ? scheduleLabel(settings) : null
      const employed = Boolean(e.hire_date && date >= e.hire_date && (!e.end_date || date <= e.end_date))
      const open = rs.find(r => !r.check_out) || null
      const checkIn = rs[0]?.check_in || null
      const checkOut = open ? null : rs.at(-1)?.check_out || null
      const paired = Boolean(p && p.punches > 1 && ['applied', 'corrected', 'manual'].includes(p.state))
      const arrival = p?.first_at || checkIn
      const departure = p && p.punches > 1 && !['open', 'single'].includes(p.state) ? p.last_at : checkOut
      const hours = rs.reduce((n, r) => n + (r.check_out ? Number(r.worked_hours) || 0 : date === today ? Math.max(0, minutes(r.check_in, now)) / 60 : 0), 0)
      const source = rs.some(r => r.source === 'corrected') ? 'corrected'
        : rs.some(r => r.source === 'device') || p ? 'device'
          : rs.length ? 'manual' : null
      const late = flagOf.get(`${key(e.id, date)}|late`) || null
      const early = flagOf.get(`${key(e.id, date)}|early`) || null
      const status = leave ? 'leave'
        : !employed && !rs.length && !p ? 'not_employed'
          : open || (p && date === today && (p.state === 'open' || p.punches === 1) && !rs.length) ? 'present'
            : rs.length || paired || (p && p.punches > 1) ? 'left'
              : p ? 'single'
                : isWorkDay === false ? 'off'
                  : isWorkDay === null ? 'unknown'
                    : date === today ? 'not_yet'
                      : date > today ? 'off'
                        : 'absent'
      out[e.id][date] = {
        date, weekday: weekday(date), status, scheduled, arrival, departure,
        hours: rs.length ? hours : null, punches: Number(p?.punches || 0), source, device: p?.device_name || null,
        late: late?.minutes ?? null, lateExcuse: late?.excuse_reason || null,
        early: early?.minutes ?? null, earlyExcuse: early?.excuse_reason || null,
        leave: leave ? typeName(leave.leave_type_id) || true : null, open: Boolean(open),
      }
    }
  }
  return out
}

/** A month's sheet totals for one person (his monthly()): worked days, absences, leave, unexcused late and early, hours. */
export function sheetTotals(days = []) {
  const worked = days.filter(d => ['present', 'left', 'single'].includes(d.status))
  const late = days.filter(d => d.late && !d.lateExcuse)
  const early = days.filter(d => d.early && !d.earlyExcuse)
  return {
    present: worked.length,
    absent: days.filter(d => d.status === 'absent').length,
    leave: days.filter(d => d.status === 'leave').length,
    late: late.length, lateMinutes: late.reduce((n, d) => n + d.late, 0),
    early: early.length, earlyMinutes: early.reduce((n, d) => n + d.early, 0),
    hours: worked.reduce((n, d) => n + (Number(d.hours) || 0), 0),
  }
}

/**
 * The month per employee on the records page (his monthly() summary): days
 * with a record, hours, approved leave days, and working days without a
 * record up to today (null while the work week is not set). A reference for
 * the payroll: nothing is deducted.
 */
export function monthSummary({ employees = [], month, today, records = [], leaves = [], settings = null }) {
  const days = monthDays(month)
  const until = days.at(-1) < today ? days.at(-1) : today
  const workDays = settings?.work_days?.length ? settings.work_days.map(Number) : null
  return employees.filter(e => e.status === 'active').map(e => {
    const mine = records.filter(r => r.employee_id === e.id)
    const recDays = new Set(mine.map(r => riyadh(r.check_in).day).filter(d => d.startsWith(month)))
    const leaveDays = new Set(days.filter(d => leaves.some(l => l.employee_id === e.id && l.status === 'approved' && l.date_from <= d && l.date_to >= d)))
    const missing = workDays === null || until < days[0] ? null
      : days.filter(d => d <= until && workDays.includes(weekday(d)) && !recDays.has(d) && !leaveDays.has(d)).length
    const hours = mine.filter(r => riyadh(r.check_in).day.startsWith(month)).reduce((n, r) => n + (Number(r.worked_hours) || 0), 0)
    return { employee: e, days: recDays.size, hours, leave: leaveDays.size, missing }
  })
}

// ── The punch log (his PunchRoles) ──

/**
 * What each punch counts as in its day: in (the first, when the day is a
 * pair), out (the last), mid (in between), dup (within the repeat-punch
 * minutes of a neighbour, only when they are set), single (the day's only
 * punch, or all within the repeat minutes). Every punch of each day must be
 * given. Returns { [punchId]: role }.
 */
export function punchRoles(punches = [], repeat = null) {
  const out = {}
  const byDay = new Map()
  for (const p of punches) {
    const k = `${p.device_user_no}|${p.work_day}`
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(p)
  }
  const gap = (a, b) => Math.abs(Date.parse(a.punched_at) - Date.parse(b.punched_at)) / 1000
  for (const list of byDay.values()) {
    const day = [...list].sort((a, b) => Date.parse(a.punched_at) - Date.parse(b.punched_at))
    const secs = (Date.parse(day.at(-1).punched_at) - Date.parse(day[0].punched_at)) / 1000
    const pair = secs > 0 && (repeat === null || secs >= repeat * 60)
    const close = (a, b) => repeat !== null && gap(a, b) < repeat * 60
    day.forEach((p, i) => {
      out[p.id] = i === 0 ? (pair ? 'in' : 'single')
        : !pair ? 'dup'
          : i === day.length - 1 ? 'out'
            : close(p, day[i - 1]) || close(p, day[i + 1]) ? 'dup' : 'mid'
    })
  }
  return out
}

/** Punch log periods (his presets): { key: [from, to] }; the week starts on Sunday. */
export function periods(today) {
  const [y, m] = today.split('-').map(Number)
  const lastMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
  return {
    today: [today, today],
    yesterday: [addDays(today, -1), addDays(today, -1)],
    week: [addDays(today, -weekday(today)), today],
    month: [`${today.slice(0, 7)}-01`, today],
    last_month: [`${lastMonth}-01`, monthDays(lastMonth).at(-1)],
  }
}

// ── The review (his AttendancePunchDay) ──

export const PUNCH_STATES = ['applied', 'corrected', 'manual', 'open', 'single', 'unlinked', 'inactive', 'before_hire', 'on_leave', 'conflict']
/** States that wait for someone (link the number, add the missing punch, decide). */
export const NEEDS_ACTION = ['unlinked', 'single', 'before_hire', 'inactive', 'conflict']

// ── A file of punches (his AttendanceIngest::csv) ──

/**
 * Rows of a CSV as the bridge writes it: user_no,time[,verify,inout,workcode];
 * a header row is skipped. Returns [{ user_no, time, verify, inout, workcode }].
 * The database checks each value (hr_device_receive).
 */
export function parseCsv(text = '') {
  const out = []
  for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const row = splitCsv(line).map(v => v.trim())
    if (row.length < 2 || (!out.length && !/^\d+$/.test(row[0]))) continue
    out.push({ user_no: row[0], time: row[1], verify: row[2] || null, inout: row[3] || null, workcode: row[4] || null })
  }
  return out
}

function splitCsv(line) {
  const cells = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { cells.push(cur); cur = '' } else cur += ch
  }
  cells.push(cur)
  return cells
}

/** A list cut into parts of at most n (a batch is at most 2,000 punches). */
export const chunks = (list, n = 2000) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))

/** Device numbers sorted as numbers ('2' before '10'). */
export const byNumber = (a, b) => a.padStart(24, '0').localeCompare(b.padStart(24, '0'))
