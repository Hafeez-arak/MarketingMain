import { supabase } from '../supabaseClient'

// ─── HR attendance: the browser's reads and writes (v2) ────────────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. Straight to the database with the
// person's own login; its rules (20261128_attendance_*.sql) decide. Every
// query names its company: RLS is membership, not isolation. Corrections,
// the board button, devices, keys, linking, uploads, retries and excuses are
// SQL functions, so their rules cannot be stepped around.

const out = ({ data, error, count }, key = 'rows') => (error
  ? { [key]: key === 'rows' ? [] : null, error: error.message, count: null }
  : { [key]: data ?? (key === 'rows' ? [] : null), count: count ?? null })

const REC_COLS = 'id,employee_id,check_in,check_out,worked_hours,day,notes,source,device_day,created_by,created_at,corrected_by,corrected_at'
const DEVICE_COLS = 'id,name,timezone,key_hint,active,notes,created_at'

// ── Records ──

/**
 * Records a page at a time, newest first: { rows, count }. Filters: from/to
 * (Riyadh days of the check-in), open (no check-out yet), sources, employee
 * ids. `all` reads up to 3,000 at once (for grouping), like his list.
 */
export function fetchRecords(ws, { from = '', to = '', open = false, sources = [], employeeIds = null, page = 0, pageSize = 50, all = false } = {}) {
  let q = supabase.from('hr_attendance').select(REC_COLS, { count: 'exact' }).eq('workspace_id', ws)
  if (from) q = q.gte('day', from)
  if (to) q = q.lte('day', to)
  if (open) q = q.is('check_out', null)
  if (sources.length) q = q.in('source', sources)
  if (employeeIds) q = q.in('employee_id', employeeIds.length ? employeeIds : ['00000000-0000-0000-0000-000000000000'])
  q = q.order('check_in', { ascending: false })
  q = all ? q.limit(3000) : q.range(page * pageSize, page * pageSize + pageSize - 1)
  return q.then(r => out(r))
}

/** Every record whose check-in falls between two Riyadh days (for the day builder). */
export function fetchRecordsBetween(ws, from, to, employeeIds = null) {
  let q = supabase.from('hr_attendance').select(REC_COLS).eq('workspace_id', ws).gte('day', from).lte('day', to)
  if (employeeIds) q = q.in('employee_id', employeeIds)
  return q.order('check_in').limit(20000).then(r => out(r))
}

/** Records still open (checked in, not out), any day. */
export const fetchOpenRecords = ws =>
  supabase.from('hr_attendance').select(REC_COLS).eq('workspace_id', ws).is('check_out', null).then(r => out(r))

export const fetchAttendanceChanges = (ws, attendanceId) =>
  supabase.from('hr_attendance_changes').select('id,kind,reason,before,after,changed_by,changed_at')
    .eq('workspace_id', ws).eq('attendance_id', attendanceId).order('changed_at', { ascending: false }).then(r => out(r))

/** A manual record (Work): check-in, optional check-out, notes (why it is entered by hand). */
export const recordAttendance = (ws, me, { employeeId, checkIn, checkOut = null, notes = '' }) =>
  supabase.from('hr_attendance').insert({
    workspace_id: ws, employee_id: employeeId, check_in: checkIn, check_out: checkOut || null, notes: notes.trim(), created_by: me,
  }).select('id').single().then(r => out(r, 'row'))

/** Correct a record (Work); the notes are the reason. A device record whose times change becomes corrected. */
export const updateAttendance = (ws, id, { checkIn, checkOut = null, notes }) =>
  supabase.rpc('hr_attendance_update', { ws, attendance_id: id, new_in: checkIn, new_out: checkOut || null, new_notes: notes })
    .then(r => out(r, 'row'))

/** The board's button (Work): 'in' or 'out'. */
export const toggleAttendance = (ws, employee) =>
  supabase.rpc('hr_attendance_toggle', { ws, employee }).then(r => out(r, 'row'))

// ── Settings ──

const SETTINGS_COLS = 'workspace_id,work_days,daily_hours,work_start,work_end,grace_minutes,schedule_from,repeat_punch_minutes,employee_emails,employee_emails_changed_at,employee_emails_changed_by,updated_at'
export const fetchAttendanceSettings = ws =>
  supabase.from('hr_settings').select(SETTINGS_COLS).eq('workspace_id', ws).maybeSingle().then(r => out(r, 'row'))

/** The work week and hours (Manage): all of them at once, as his form. */
export const saveAttendanceSettings = (ws, me, f) =>
  supabase.from('hr_settings').upsert({
    workspace_id: ws, updated_by: me, work_days: f.work_days, daily_hours: f.daily_hours,
    work_start: f.work_start || null, work_end: f.work_end || null, grace_minutes: f.work_start ? f.grace_minutes : null,
    schedule_from: f.work_start ? f.schedule_from || null : null, repeat_punch_minutes: f.repeat_punch_minutes || null,
    employee_emails: Boolean(f.employee_emails),
  }, { onConflict: 'workspace_id' }).select('workspace_id').single().then(r => out(r, 'row'))

/** Is the HR mailbox connected (the late / early-leave emails go from it)? */
export const fetchMailboxReady = ws => supabase.rpc('hr_mailbox_ready', { ws }).then(r => out(r, 'row'))

// ── Devices, punches, the review ──

export const fetchDevices = ws =>
  supabase.from('hr_devices').select(DEVICE_COLS).eq('workspace_id', ws).order('created_at').then(r => out(r))

/** Per device: punches, last punch, last sync, users; per number: punches, last day; locked employees. */
export const fetchDeviceOverview = ws => supabase.rpc('hr_device_overview', { ws }).then(r => out(r, 'row'))

/** The users the devices list (number, name). */
export const fetchDeviceUsers = ws =>
  supabase.from('hr_device_users').select('device_id,device_user_no,name,enabled').eq('workspace_id', ws).order('device_user_no').limit(10000).then(r => out(r))

/**
 * Device days (hr_punch_days) a page at a time, newest first: { rows, count }.
 * Filters: from/to, states, linked (true / false), numbers, employee ids.
 */
export function fetchPunchDays(ws, { from = '', to = '', states = [], linked = null, numbers = null, employeeIds = null, page = 0, pageSize = 100, all = false } = {}) {
  let q = supabase.from('hr_punch_days').select('device_user_no,work_day,punches,first_at,last_at,device_name,employee_id,attendance_id,state', { count: 'exact' }).eq('workspace_id', ws)
  if (from) q = q.gte('work_day', from)
  if (to) q = q.lte('work_day', to)
  if (states.length) q = q.in('state', states)
  if (linked === true) q = q.not('employee_id', 'is', null)
  if (linked === false) q = q.is('employee_id', null)
  if (numbers || employeeIds) {
    const parts = []
    if (numbers?.length) parts.push(`device_user_no.in.(${numbers.join(',')})`)
    if (employeeIds?.length) parts.push(`employee_id.in.(${employeeIds.join(',')})`)
    q = parts.length ? q.or(parts.join(',')) : q.eq('device_user_no', '-')
  }
  q = q.order('work_day', { ascending: false }).order('device_user_no')
  q = all ? q.limit(5000) : q.range(page * pageSize, page * pageSize + pageSize - 1)
  return q.then(r => out(r))
}

/** State counts of the device days (for the review's filters). */
export function fetchPunchDayCounts(ws) {
  return supabase.from('hr_punch_days').select('state').eq('workspace_id', ws).limit(50000).then(r => {
    if (r.error) return { row: {}, error: r.error.message }
    const c = {}
    for (const x of r.data || []) c[x.state] = (c[x.state] || 0) + 1
    return { row: c }
  })
}

/** Punches between two days (whole number-days), with an optional number filter: up to 20,000. */
export function fetchPunches(ws, { from = '', to = '', numbers = null } = {}) {
  let q = supabase.from('hr_punches').select('id,device_id,device_user_no,local_time,punched_at,work_day,verify_mode,in_out_mode,work_code').eq('workspace_id', ws)
  if (from) q = q.gte('work_day', from)
  if (to) q = q.lte('work_day', to)
  if (numbers) q = q.in('device_user_no', numbers.length ? numbers : ['-'])
  return q.order('work_day', { ascending: false }).order('device_user_no').order('punched_at').limit(20000).then(r => out(r))
}

/** Register a device (Manage): { id, key } — the key is shown once. */
export const addDevice = (ws, { name, timezone, notes = '' }) =>
  supabase.rpc('hr_device_add', { ws, name, timezone, notes }).then(r => out(r, 'row'))

/** A new key (Manage); the old one stops at once. */
export const rotateDeviceKey = (ws, device) => supabase.rpc('hr_device_rotate_key', { ws, device }).then(r => out(r, 'row'))

/** Stop or restart a device (Manage). */
export const setDeviceActive = (ws, id, active) =>
  supabase.from('hr_devices').update({ active }).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle().then(r => out(r, 'row'))

/** { "<number>": employeeId | null } → { changed, paired } (Manage). */
export const linkDeviceNumbers = (ws, links) => supabase.rpc('hr_device_link', { ws, links }).then(r => out(r, 'row'))

/** Punches read from a CSV in the browser (Manage), one batch of ≤ 2,000. */
export const uploadPunches = (ws, device, punches) => supabase.rpc('hr_device_upload', { ws, device, punches }).then(r => out(r, 'row'))

/** Pair and flag one employee's device days again (Manage). */
export const retryEmployee = (ws, employee) => supabase.rpc('hr_attendance_retry', { ws, employee }).then(r => out(r, 'row'))

// ── Late arrivals and early leaves ──

const FLAG_COLS = 'id,employee_id,work_day,kind,scheduled_at,actual_at,grace_minutes,minutes,email_to,email_status,email_attempts,emailed_at,email_error,excused_at,excused_by,excuse_reason,created_at'

/** Flags a page at a time, newest first. Filters: kind, from/to, excused (true/false), email statuses, employee ids. */
export function fetchFlags(ws, { kinds = [], from = '', to = '', excused = null, emails = [], employeeIds = null, page = 0, pageSize = 50, all = false } = {}) {
  let q = supabase.from('hr_attendance_flags').select(FLAG_COLS, { count: 'exact' }).eq('workspace_id', ws)
  if (kinds.length) q = q.in('kind', kinds)
  if (from) q = q.gte('work_day', from)
  if (to) q = q.lte('work_day', to)
  if (excused === true) q = q.not('excused_at', 'is', null)
  if (excused === false) q = q.is('excused_at', null)
  if (emails.length) q = q.in('email_status', emails)
  if (employeeIds) q = q.in('employee_id', employeeIds.length ? employeeIds : ['00000000-0000-0000-0000-000000000000'])
  q = q.order('work_day', { ascending: false }).order('kind', { ascending: false })
  q = all ? q.limit(3000) : q.range(page * pageSize, page * pageSize + pageSize - 1)
  return q.then(r => out(r))
}

/** An excuse with its reason (Manage). */
export const excuseFlag = (ws, flag, reason) => supabase.rpc('hr_attendance_excuse', { ws, flag, reason }).then(r => out(r, 'row'))
