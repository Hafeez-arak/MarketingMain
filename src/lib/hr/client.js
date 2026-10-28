import { supabase } from '../supabaseClient'

// ─── HR: the browser's reads and writes (v2) ───────────────────────────────
// 2026-10-28. Straight to the database with the person's own login: its
// rules (supabase/migrations/20261112_hr_*.sql) decide who sees and changes
// what. Every query names its company: RLS is membership, not isolation.
// Leave decisions are SQL functions, so their rules (no self-approval, the
// balance) cannot be stepped around. Attendance is in attendanceClient.js.
// Errors come back as the database's message; the screens turn them into
// words with errorKey() (logic.js).

const EMP_COLS = 'id,workspace_id,employee_no,name_en,name_ar,job_title,department_id,manager_id,hire_date,status,end_date,end_reason,work_email,work_phone,user_id,notes,created_at,updated_at'
const out = ({ data, error }, key = 'rows') => (error ? { [key]: key === 'rows' ? [] : null, error: error.message } : { [key]: data ?? (key === 'rows' ? [] : null) })

// ── Reads ──

export const fetchDepartments = ws =>
  supabase.from('hr_departments').select('id,name_en,name_ar,head_id,active').eq('workspace_id', ws).order('name_en').then(r => out(r))

export const fetchEmployees = ws =>
  supabase.from('hr_employees').select(EMP_COLS).eq('workspace_id', ws).order('name_en').limit(2000).then(r => out(r))

export const fetchEmployee = (ws, id) =>
  supabase.from('hr_employees').select(EMP_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle().then(r => out(r, 'row'))

/** Papers: one person's, or the company's (the expiring-soon view). RLS returns only what this login may read. */
export function fetchDocuments(ws, employeeId = '') {
  let q = supabase.from('hr_documents').select('id,employee_id,doc_type,doc_number,issue_date,expiry_date,notes').eq('workspace_id', ws)
  if (employeeId) q = q.eq('employee_id', employeeId)
  return q.order('expiry_date', { ascending: true, nullsFirst: false }).limit(5000).then(r => out(r))
}

export const fetchContracts = (ws, employeeId) =>
  supabase.from('hr_contracts').select('id,employee_id,contract_type,start_date,end_date,notes').eq('workspace_id', ws).eq('employee_id', employeeId)
    .order('start_date', { ascending: false }).then(r => out(r))

export const fetchLeaveTypes = ws =>
  supabase.from('hr_leave_types').select('id,name_en,name_ar,paid,needs_balance,active').eq('workspace_id', ws).order('name_en').then(r => out(r))

export const fetchBalances = (ws, year) =>
  supabase.from('hr_leave_balances').select('id,employee_id,leave_type_id,year,days,note,updated_by,updated_at').eq('workspace_id', ws).eq('year', year).then(r => out(r))

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

/** The company's logins with emails (Manage only; empty for anyone else). */
export const fetchLogins = ws => supabase.rpc('hr_logins', { ws }).then(r => out(r))

/** Names of the company's people (for "decided by"), anyone in the company. */
export const fetchPeople = ws => supabase.rpc('task_people', { ws }).then(r => out(r))

// ── Writes ──

const clean = (fields, keys) => Object.fromEntries(keys.filter(k => k in fields).map(k => {
  const v = fields[k]
  return [k, typeof v === 'string' ? (v.trim() === '' && !['notes', 'name_en', 'name_ar', 'job_title', 'doc_number', 'reason'].includes(k) ? null : v.trim()) : v]
}))

const DEPT_KEYS = ['name_en', 'name_ar', 'head_id', 'active']
export const saveDepartment = (ws, me, id, fields) => (id
  ? supabase.from('hr_departments').update(clean(fields, DEPT_KEYS)).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_departments').insert({ ...clean(fields, DEPT_KEYS), workspace_id: ws, created_by: me }).select('id').single()
).then(r => out(r, 'row'))

const EMP_KEYS = ['employee_no', 'name_en', 'name_ar', 'job_title', 'department_id', 'manager_id', 'hire_date', 'status', 'end_date', 'end_reason', 'work_email', 'work_phone', 'user_id', 'notes']
export const saveEmployee = (ws, me, id, fields) => (id
  ? supabase.from('hr_employees').update(clean(fields, EMP_KEYS)).eq('workspace_id', ws).eq('id', id).select(EMP_COLS).maybeSingle()
  : supabase.from('hr_employees').insert({ ...clean(fields, EMP_KEYS), workspace_id: ws, created_by: me }).select(EMP_COLS).single()
).then(r => out(r, 'row'))

const DOC_KEYS = ['doc_type', 'doc_number', 'issue_date', 'expiry_date', 'notes']
export const saveDocument = (ws, me, employeeId, id, fields) => (id
  ? supabase.from('hr_documents').update(clean(fields, DOC_KEYS)).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_documents').insert({ ...clean(fields, DOC_KEYS), workspace_id: ws, employee_id: employeeId, created_by: me }).select('id').single()
).then(r => out(r, 'row'))

export const deleteDocument = (ws, id) =>
  supabase.from('hr_documents').delete().eq('workspace_id', ws).eq('id', id).then(r => out(r, 'row'))

const CONTRACT_KEYS = ['contract_type', 'start_date', 'end_date', 'notes']
export const saveContract = (ws, me, employeeId, id, fields) => (id
  ? supabase.from('hr_contracts').update(clean(fields, CONTRACT_KEYS)).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_contracts').insert({ ...clean(fields, CONTRACT_KEYS), workspace_id: ws, employee_id: employeeId, created_by: me }).select('id').single()
).then(r => out(r, 'row'))

export const deleteContract = (ws, id) =>
  supabase.from('hr_contracts').delete().eq('workspace_id', ws).eq('id', id).then(r => out(r, 'row'))

const TYPE_KEYS = ['name_en', 'name_ar', 'paid', 'needs_balance', 'active']
export const saveLeaveType = (ws, id, fields) => (id
  ? supabase.from('hr_leave_types').update(clean(fields, TYPE_KEYS)).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  : supabase.from('hr_leave_types').insert({ ...clean(fields, TYPE_KEYS), workspace_id: ws }).select('id').single()
).then(r => out(r, 'row'))

/** Set the days granted for one person, type and year (Manage). */
export const saveBalance = (ws, me, { employeeId, typeId, year, days, note = '' }) =>
  supabase.from('hr_leave_balances').upsert(
    { workspace_id: ws, employee_id: employeeId, leave_type_id: typeId, year, days, note, updated_by: me },
    { onConflict: 'employee_id,leave_type_id,year' },
  ).select('id').single().then(r => out(r, 'row'))

export const askLeave = (ws, me, { employeeId, typeId, from, to, days, reason = '' }) =>
  supabase.from('hr_leave_requests').insert({
    workspace_id: ws, employee_id: employeeId, leave_type_id: typeId, date_from: from, date_to: to, days, reason: reason.trim(), created_by: me,
  }).select('id').single().then(r => out(r, 'row'))

/** approve | reject | cancel. */
export const decideLeave = (ws, id, action, note = '') =>
  supabase.rpc('hr_leave_decide', { ws, request_id: id, action, note }).then(r => out(r, 'row'))

