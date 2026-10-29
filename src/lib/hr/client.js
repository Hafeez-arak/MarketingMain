import { supabase } from '../supabaseClient'
import { fetchDocuments as fetchEmployeeDocuments, fetchTypes as fetchDocumentTypes } from '../documents/client'

// ─── HR: the browser's reads and writes (v2) ───────────────────────────────
// 2026-10-28, parity pass 2026-10-29. Straight to the database with the
// person's own login: its rules (supabase/migrations/20261112_hr_*.sql and
// 20261129_hr_parity_*.sql) decide who sees and changes what. Every query
// names its company: RLS is membership, not isolation. Leave decisions,
// grants and deleting an employee are SQL functions, so their rules (no
// self-approval, the balance, "never used") cannot be stepped around.
// Attendance is in attendanceClient.js. Errors come back as the database's
// message; the screens turn them into words with errorKey() (logic.js).

const EMP_COLS = 'id,workspace_id,employee_no,name_en,name_ar,job_title,job_id,trade,employment_type,is_direct_labor,department_id,manager_id,hire_date,status,end_date,end_reason,work_email,work_phone,user_id,device_user_no,created_at,updated_at'
const CONTRACT_COLS = 'id,employee_id,contract_no,contract_type,start_date,end_date,weekly_hours,status,notes,created_at'
const out = ({ data, error }, key = 'rows') => (error ? { [key]: key === 'rows' ? [] : null, error: error.message } : { [key]: data ?? (key === 'rows' ? [] : null) })

// ── Reads ──

export const fetchDepartments = ws =>
  supabase.from('hr_departments').select('id,name_en,name_ar,head_id,parent_id,active').eq('workspace_id', ws).order('name_en').then(r => out(r))

export const fetchJobs = ws =>
  supabase.from('hr_job_positions').select('id,name_en,name_ar,department_id,description,active').eq('workspace_id', ws).order('name_en').then(r => out(r))

export const fetchEmployees = ws =>
  supabase.from('hr_employees').select(EMP_COLS).eq('workspace_id', ws).order('name_en').limit(2000).then(r => out(r))

export const fetchEmployee = (ws, id) =>
  supabase.from('hr_employees').select(EMP_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle().then(r => out(r, 'row'))

/** The personal file of one person (Manage only; empty for anyone else). */
export const fetchPrivate = (ws, employeeId) =>
  supabase.from('hr_employee_private')
    .select('employee_id,nationality,id_type,id_number,birth_date,gender,mobile,emergency_contact,emergency_phone,address,notes')
    .eq('workspace_id', ws).eq('employee_id', employeeId).maybeSingle().then(r => out(r, 'row'))

/**
 * Papers: one person's, or the company's (the expiring-soon view). They live
 * in Documents since 20261201_documents_3_hr_move.sql: these are the
 * employees' documents this login may read, with the company's types (for
 * each paper's name and alert days). `error` is in words, not a message.
 */
export async function fetchDocuments(ws, employeeId = '') {
  const [d, t] = await Promise.all([fetchEmployeeDocuments(ws, { employeeId, kind: 'employee' }), fetchDocumentTypes(ws)])
  return { rows: d.rows, types: t.rows, error: d.error || t.error || '' }
}

/** Contracts: one person's, or all of the company's (Manage; the person themselves sees their own). */
export function fetchContracts(ws, employeeId = '') {
  let q = supabase.from('hr_contracts').select(CONTRACT_COLS).eq('workspace_id', ws)
  if (employeeId) q = q.eq('employee_id', employeeId)
  return q.order('start_date', { ascending: false }).limit(5000).then(r => out(r))
}

/** The ids of employees with a running contract (anyone in HR may ask; no contract is read). */
export const fetchRunningContracts = ws => supabase.rpc('hr_running_contracts', { ws }).then(r => out(r))

export const fetchLeaveTypes = ws =>
  supabase.from('hr_leave_types').select('id,name_en,name_ar,paid,needs_balance,active').eq('workspace_id', ws).order('name_en').then(r => out(r))

/** The ledger of allocations: everyone's for Manage, only the person's own for anyone else. */
export function fetchAllocations(ws, employeeId = '') {
  let q = supabase.from('hr_leave_allocations').select('id,employee_id,leave_type_id,days,valid_from,valid_to,reason,approved_by,created_at').eq('workspace_id', ws)
  if (employeeId) q = q.eq('employee_id', employeeId)
  return q.order('created_at', { ascending: false }).limit(5000).then(r => out(r))
}

/** Leave requests touching a date range (all when no range), newest first. */
export function fetchLeaveRequests(ws, { from = '', to = '', employeeId = '' } = {}) {
  let q = supabase.from('hr_leave_requests')
    .select('id,employee_id,leave_type_id,date_from,date_to,days,reason,status,decided_by,decided_at,decision_note,cancelled_by,cancelled_at,created_by,created_at')
    .eq('workspace_id', ws)
  if (from) q = q.gte('date_to', from)
  if (to) q = q.lte('date_from', to)
  if (employeeId) q = q.eq('employee_id', employeeId)
  return q.order('date_from', { ascending: false }).limit(3000).then(r => out(r))
}

/** The history of one person's rows, or of one contract (Manage). */
export function fetchAudit(ws, { employeeId = '', rowId = '' } = {}) {
  let q = supabase.from('hr_audit').select('id,table_name,row_id,employee_id,action,changed_by,changed_at,old_data,new_data').eq('workspace_id', ws)
  if (employeeId) q = q.eq('employee_id', employeeId)
  if (rowId) q = q.eq('row_id', rowId)
  return q.order('id', { ascending: false }).limit(100).then(r => out(r))
}

/** The company's logins with emails (Manage only; empty for anyone else). */
export const fetchLogins = ws => supabase.rpc('hr_logins', { ws }).then(r => out(r))

/** Names of the company's people (for "decided by"), anyone in the company. */
export const fetchPeople = ws => supabase.rpc('task_people', { ws }).then(r => out(r))

// ── Writes ──

const NOT_NULL_TEXT = ['notes', 'name_en', 'name_ar', 'job_title', 'trade', 'doc_number', 'reason', 'description', 'nationality', 'mobile', 'emergency_contact', 'emergency_phone', 'address']
const clean = (fields, keys) => Object.fromEntries(keys.filter(k => k in fields).map(k => {
  const v = fields[k]
  return [k, typeof v === 'string' ? (v.trim() === '' && !NOT_NULL_TEXT.includes(k) ? null : v.trim()) : v]
}))

const DEPT_KEYS = ['name_en', 'name_ar', 'head_id', 'parent_id', 'active']
export const saveDepartment = (ws, me, id, fields) => (id
  ? supabase.from('hr_departments').update(clean(fields, DEPT_KEYS)).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_departments').insert({ ...clean(fields, DEPT_KEYS), workspace_id: ws, created_by: me }).select('id').single()
).then(r => out(r, 'row'))

const JOB_KEYS = ['name_en', 'name_ar', 'department_id', 'description', 'active']
export const saveJob = (ws, me, id, fields) => (id
  ? supabase.from('hr_job_positions').update(clean(fields, JOB_KEYS)).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_job_positions').insert({ ...clean(fields, JOB_KEYS), workspace_id: ws, created_by: me }).select('id').single()
).then(r => out(r, 'row'))

// (the employee number is made by the database and never sent)
const EMP_KEYS = ['name_en', 'name_ar', 'job_id', 'trade', 'employment_type', 'is_direct_labor', 'department_id', 'manager_id', 'hire_date', 'status', 'end_date', 'end_reason', 'work_email', 'work_phone', 'user_id']
export const saveEmployee = (ws, me, id, fields) => (id
  ? supabase.from('hr_employees').update(clean(fields, EMP_KEYS)).eq('workspace_id', ws).eq('id', id).select(EMP_COLS).maybeSingle()
  : supabase.from('hr_employees').insert({ ...clean(fields, EMP_KEYS), workspace_id: ws, created_by: me }).select(EMP_COLS).single()
).then(r => out(r, 'row'))

const PRIVATE_KEYS = ['nationality', 'id_type', 'id_number', 'birth_date', 'gender', 'mobile', 'emergency_contact', 'emergency_phone', 'address', 'notes']
export const savePrivate = (ws, employeeId, fields) =>
  supabase.from('hr_employee_private').upsert({ ...clean(fields, PRIVATE_KEYS), workspace_id: ws, employee_id: employeeId }, { onConflict: 'employee_id' })
    .select('employee_id').single().then(r => out(r, 'row'))

/**
 * Delete a person who was never used anywhere (Manage). Returns the files of
 * their papers, which are then removed from Storage (SQL cannot).
 */
export async function deleteEmployee(ws, id) {
  const { data, error } = await supabase.rpc('hr_employee_delete', { ws, emp: id })
  if (error) return { error: error.message }
  await removePaperFiles(data || [])
  return { row: { id } }
}

// ── Files of papers kept before they moved to Documents (bucket 'hr-papers') ──

/** Remove files from Storage; a failure only leaves an orphan under the company's folder. */
export async function removePaperFiles(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return
  try { await supabase.storage.from('hr-papers').remove(list) } catch { /* the company folder is cleaned when the company is deleted */ }
}

// ── Contracts: a draft is edited; the rest is a change of status ──

const CONTRACT_KEYS = ['contract_type', 'start_date', 'end_date', 'weekly_hours', 'notes']
export const saveContract = (ws, me, employeeId, id, fields) => (id
  ? supabase.from('hr_contracts').update(clean(fields, CONTRACT_KEYS)).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_contracts').insert({ ...clean(fields, CONTRACT_KEYS), workspace_id: ws, employee_id: employeeId, created_by: me }).select('id').single()
).then(r => out(r, 'row'))

/** start (draft → running) | close (running → expired, with its end date) | cancel. */
export function moveContract(ws, id, action, endDate = '') {
  const change = action === 'start' ? { status: 'running' }
    : action === 'close' ? { status: 'expired', end_date: endDate }
      : { status: 'cancelled' }
  return supabase.from('hr_contracts').update(change).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle().then(r => out(r, 'row'))
}

// ── Leave ──

const TYPE_KEYS = ['name_en', 'name_ar', 'paid', 'needs_balance', 'active']
export const saveLeaveType = (ws, id, fields) => (id
  // (whether a type is paid / keeps a balance is fixed once it exists)
  ? supabase.from('hr_leave_types').update(clean(fields, TYPE_KEYS.filter(k => !['paid', 'needs_balance'].includes(k)))).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_leave_types').insert({ ...clean(fields, TYPE_KEYS), workspace_id: ws }).select('id').single()
).then(r => out(r, 'row'))

/** Grant days to one employee, or to every active one (employeeId null). Returns how many entries were made. */
export const allocateLeave = (ws, { employeeId = null, typeId, days, from, to, reason }) =>
  supabase.rpc('hr_leave_allocate', { ws, emp: employeeId, typ: typeId, p_days: days, p_from: from, p_to: to, p_reason: reason }).then(r => out(r, 'row'))

export const askLeave = (ws, me, { employeeId, typeId, from, to, days, reason = '' }) =>
  supabase.from('hr_leave_requests').insert({
    workspace_id: ws, employee_id: employeeId, leave_type_id: typeId, date_from: from, date_to: to, days, reason: reason.trim(), created_by: me,
  }).select('id').single().then(r => out(r, 'row'))

/** approve | reject | cancel. */
export const decideLeave = (ws, id, action, note = '') =>
  supabase.rpc('hr_leave_decide', { ws, request_id: id, action, note }).then(r => out(r, 'row'))
