import { describe, it, expect } from 'vitest'
import {
  riyadhToday, addDays, spanDays, monthDays, workingDays, weekday, nameOf, matchLogin, filterEmployees,
  expiringDocs, contractEndingSoon, contractActions, closeProblem, groupEmployees, leaveProblem, ledgerBalance, leaveActions,
  offOn, errorKey, describeChange,
} from './logic'

const emp = (id, extra = {}) => ({ id, name_en: `E${id} (test)`, name_ar: '', status: 'active', hire_date: '2020-01-01', end_date: null, department_id: null, ...extra })
const req = (id, employee_id, date_from, date_to, days, status = 'pending', leave_type_id = 'annual') => ({ id, employee_id, date_from, date_to, days, status, leave_type_id })

describe('dates', () => {
  it('today is Riyadh\'s, not UTC\'s', () => {
    expect(riyadhToday(new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29')
    expect(riyadhToday(new Date('2026-10-28T20:59:00Z'))).toBe('2026-10-28')
  })
  it('counts calendar and working days', () => {
    expect(spanDays('2026-10-25', '2026-10-29')).toBe(5)
    expect(spanDays('2026-10-29', '2026-10-25')).toBe(0)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekday('2026-10-25')).toBe(0) // a Sunday
    // Sunday to Saturday with a Sunday–Thursday week: 5 working days.
    expect(workingDays('2026-10-25', '2026-10-31', [0, 1, 2, 3, 4])).toBe(5)
    expect(workingDays('2026-10-25', '2026-10-31', [])).toBe(7)
  })
  it('knows the length of every month', () => {
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(monthDays('2028-02')).toHaveLength(29)
    expect(monthDays('2026-10').at(-1)).toBe('2026-10-31')
  })
})

describe('names and the directory', () => {
  it('shows the name in the reader\'s language, else the other', () => {
    expect(nameOf({ name_en: 'Omar (test)', name_ar: 'عمر (تجربة)' }, 'ar')).toBe('عمر (تجربة)')
    expect(nameOf({ name_en: 'Omar (test)', name_ar: '' }, 'ar')).toBe('Omar (test)')
    expect(nameOf({ name_en: '', name_ar: 'عمر (تجربة)' }, 'en')).toBe('عمر (تجربة)')
  })
  it('matches a login by email, ignoring case and spaces', () => {
    const logins = [{ user_id: 'u1', email: 'Omar@Example.invalid' }]
    expect(matchLogin(' omar@example.invalid ', logins)?.user_id).toBe('u1')
    expect(matchLogin('', logins)).toBeNull()
    expect(matchLogin('x@example.invalid', logins)).toBeNull()
  })
  it('searches and filters', () => {
    const list = [
      emp('1', { name_en: 'Omar (test)', employee_no: 'T-003', department_id: 'sales' }),
      emp('2', { name_ar: 'سارة (تجربة)', name_en: '', job_title: 'Engineer', department_id: 'projects' }),
      emp('3', { name_en: 'Majed (test)', status: 'ended' }),
    ]
    expect(filterEmployees(list).map(e => e.id)).toEqual(['1', '2'])
    expect(filterEmployees(list, { q: 't-003' }).map(e => e.id)).toEqual(['1'])
    expect(filterEmployees(list, { q: 'سارة' }).map(e => e.id)).toEqual(['2'])
    expect(filterEmployees(list, { q: 'engin' }).map(e => e.id)).toEqual(['2'])
    expect(filterEmployees(list, { department: 'projects' }).map(e => e.id)).toEqual(['2'])
    expect(filterEmployees(list, { status: 'ended' }).map(e => e.id)).toEqual(['3'])
    expect(filterEmployees(list, { status: '', department: 'none' }).map(e => e.id)).toEqual(['3'])
  })
  it('filters by labour kind, expiring papers and a missing running contract; searches the trade', () => {
    const list = [
      emp('1', { is_direct_labor: true, trade: 'Electrician' }),
      emp('2', { is_direct_labor: false }),
      emp('3', { is_direct_labor: true, status: 'ended' }),
    ]
    expect(filterEmployees(list, { kind: 'direct' }).map(e => e.id)).toEqual(['1'])
    expect(filterEmployees(list, { kind: 'indirect' }).map(e => e.id)).toEqual(['2'])
    expect(filterEmployees(list, { q: 'electric' }).map(e => e.id)).toEqual(['1'])
    expect(filterEmployees(list, { kind: 'docs', expiringIds: new Set(['2']) }).map(e => e.id)).toEqual(['2'])
    expect(filterEmployees(list, { kind: 'noContract', runningIds: new Set(['1']) }).map(e => e.id)).toEqual(['2'])
    // Without the list of running contracts nobody is called "without one".
    expect(filterEmployees(list, { kind: 'noContract' })).toEqual([])
  })
  it('groups by department, job or manager, keeping order', () => {
    const list = [emp('1', { department_id: 'a' }), emp('2', { department_id: 'b' }), emp('3', { department_id: 'a' }), emp('4')]
    expect(groupEmployees(list, 'department').map(g => [g.key, g.rows.map(e => e.id)])).toEqual([['a', ['1', '3']], ['b', ['2']], ['', ['4']]])
    expect(groupEmployees(list, '')).toEqual([{ key: '', rows: list }])
  })
})

describe('papers and contracts', () => {
  const today = '2026-10-28'
  it('lists the papers (kept in Documents) of people still employed that expired or are within their type\'s alert days, soonest first', () => {
    const employees = [emp('a'), emp('b', { status: 'ended' })]
    const typesById = { iqama: { alert_days: [90, 30, 7] }, passport: { alert_days: null } }
    const docs = [
      { id: 1, employee_id: 'a', type_id: 'iqama', confirmed_at: '2026-01-01', expiry_date: '2027-01-20' },   // 84 days: inside 90
      { id: 2, employee_id: 'a', type_id: 'iqama', confirmed_at: '2026-01-01', expiry_date: '2026-10-01' },   // expired
      { id: 3, employee_id: 'a', type_id: 'iqama', confirmed_at: '2026-01-01', expiry_date: '2030-01-01' },   // far
      { id: 4, employee_id: 'b', type_id: 'iqama', confirmed_at: '2026-01-01', expiry_date: '2026-10-01' },   // left the company
      { id: 5, employee_id: 'a', type_id: 'passport', confirmed_at: '2026-01-01', expiry_date: '2026-11-01' }, // no alert days: never "expiring"
      { id: 6, employee_id: 'a', type_id: 'iqama', confirmed_at: null, expiry_date: '2026-10-01' },            // a draft is not a paper yet
    ]
    expect(expiringDocs(docs, employees, typesById, today).map(d => d.id)).toEqual([2, 1])
  })
  it('calls a running contract "ending soon" within 60 days of its end (past due too)', () => {
    expect(contractEndingSoon({ status: 'running', end_date: '2026-12-27' }, today)).toBe(true)
    expect(contractEndingSoon({ status: 'running', end_date: '2026-12-28' }, today)).toBe(false)
    expect(contractEndingSoon({ status: 'running', end_date: '2026-10-01' }, today)).toBe(true)
    expect(contractEndingSoon({ status: 'running', end_date: null }, today)).toBe(false)
    expect(contractEndingSoon({ status: 'draft', end_date: '2026-11-01' }, today)).toBe(false)
    expect(contractEndingSoon({ status: 'expired', end_date: '2026-11-01' }, today)).toBe(false)
  })
  it('offers a contract only what its status allows, to Manage only', () => {
    expect(contractActions({ status: 'draft' }, 'manage')).toEqual({ edit: true, start: true, close: false, cancel: true })
    expect(contractActions({ status: 'running' }, 'manage')).toEqual({ edit: false, start: false, close: true, cancel: true })
    expect(contractActions({ status: 'expired' }, 'manage')).toEqual({ edit: false, start: false, close: false, cancel: false })
    expect(contractActions({ status: 'cancelled' }, 'manage')).toEqual({ edit: false, start: false, close: false, cancel: false })
    expect(contractActions({ status: 'draft' }, 'work')).toEqual({ edit: false, start: false, close: false, cancel: false })
    expect(contractActions({ status: 'draft' }, null).start).toBe(false)
  })
  it('closes a contract no earlier than it started', () => {
    expect(closeProblem({ start_date: '2026-01-01' }, '2025-12-31')).toBe('dates')
    expect(closeProblem({ start_date: '2026-01-01' }, '')).toBe('dates')
    expect(closeProblem({ start_date: '2026-01-01' }, '2026-01-01')).toBeNull()
  })
})

describe('leave requests', () => {
  it('checks dates, days and overlaps before sending', () => {
    expect(leaveProblem({ from: '2026-11-03', to: '2026-11-01', days: 1 })).toBe('dates')
    expect(leaveProblem({ from: '2026-11-01', to: '2026-11-03', days: 0 })).toBe('days')
    expect(leaveProblem({ from: '2026-11-01', to: '2026-11-03', days: 1.3 })).toBe('days')
    expect(leaveProblem({ from: '2026-11-01', to: '2026-11-03', days: 4 })).toBe('tooMany')
    expect(leaveProblem({ from: '2026-11-01', to: '2026-11-03', days: 2.5 })).toBeNull()
    const others = [req('r1', 'a', '2026-11-03', '2026-11-05', 3, 'approved'), req('r2', 'a', '2026-11-20', '2026-11-20', 1, 'rejected')]
    expect(leaveProblem({ from: '2026-11-01', to: '2026-11-03', days: 3 }, others, 'a')).toBe('overlap')
    expect(leaveProblem({ from: '2026-11-20', to: '2026-11-20', days: 1 }, others, 'a')).toBeNull()
    expect(leaveProblem({ from: '2026-11-01', to: '2026-11-03', days: 3 }, others, 'b')).toBeNull()
  })
  it('counts a balance on a day from the ledger, the way the database does', () => {
    const allocations = [
      { employee_id: 'a', leave_type_id: 'annual', days: '21.00', valid_from: '2026-01-01', valid_to: '2026-12-31' },
      { employee_id: 'a', leave_type_id: 'annual', days: '-2.00', valid_from: '2026-01-01', valid_to: '2026-12-31' },
      { employee_id: 'a', leave_type_id: 'annual', days: '5.00', valid_from: '2027-01-01', valid_to: '2027-06-30' },
      { employee_id: 'b', leave_type_id: 'annual', days: '9.00', valid_from: '2026-01-01', valid_to: '2026-12-31' },
    ]
    const requests = [
      req('1', 'a', '2026-09-14', '2026-09-18', '5.0', 'approved'),
      req('2', 'a', '2026-11-08', '2026-11-10', '3.0', 'pending'),
      req('3', 'a', '2026-12-20', '2026-12-31', '9.0', 'rejected'),
      req('4', 'a', '2026-10-05', '2026-10-05', '1.0', 'cancelled'),
      // Starts in December: counts against 2026's window even though it ends in 2027.
      req('5', 'a', '2026-12-30', '2027-01-02', '2.0', 'approved'),
      req('6', 'a', '2027-01-10', '2027-01-10', '1.0', 'approved'),
      req('7', 'b', '2026-09-01', '2026-09-01', '1.0', 'approved'),
    ]
    // 21 - 2 granted; 5 + 2 approved inside the 2026 window; 3 waiting.
    expect(ledgerBalance({ allocations, requests, employeeId: 'a', typeId: 'annual', on: '2026-12-01' }))
      .toEqual({ granted: 19, used: 7, pending: 3, remaining: 12, until: '2026-12-31' })
    // 2027's window holds 5, minus the one approved leave that starts in it.
    expect(ledgerBalance({ allocations, requests, employeeId: 'a', typeId: 'annual', on: '2027-02-01' }))
      .toEqual({ granted: 5, used: 1, pending: 3, remaining: 4, until: '2027-06-30' })
    // Outside every window nothing is granted and nothing is left.
    expect(ledgerBalance({ allocations, requests, employeeId: 'a', typeId: 'annual', on: '2028-01-01' }))
      .toEqual({ granted: null, used: 0, pending: 3, remaining: 0, until: null })
  })
  it('counts a request once even when two allocations cover it', () => {
    const allocations = [
      { employee_id: 'a', leave_type_id: 't', days: '10', valid_from: '2026-01-01', valid_to: '2026-12-31' },
      { employee_id: 'a', leave_type_id: 't', days: '4', valid_from: '2026-06-01', valid_to: '2026-12-31' },
    ]
    const requests = [req('1', 'a', '2026-07-01', '2026-07-02', '2', 'approved', 't')]
    expect(ledgerBalance({ allocations, requests, employeeId: 'a', typeId: 't', on: '2026-08-01' }).remaining).toBe(12)
  })
  it('lets only Manage decide, never for the employee themselves (his hr.leave_approve; no manager path)', () => {
    const pending = req('1', 'omar', '2026-11-08', '2026-11-10', 3)
    const approved = { ...pending, status: 'approved' }
    expect(leaveActions(pending, { level: 'manage' })).toEqual({ approve: true, reject: true, cancel: true })
    expect(leaveActions(pending, { level: 'manage', myEmployeeId: 'omar' })).toEqual({ approve: false, reject: false, cancel: true })
    // A direct manager with View decides nothing.
    expect(leaveActions(pending, { level: 'view', myEmployeeId: 'boss' })).toEqual({ approve: false, reject: false, cancel: false })
    // Work (attendance) neither decides nor cancels another's waiting request.
    expect(leaveActions(pending, { level: 'work' })).toEqual({ approve: false, reject: false, cancel: false })
    expect(leaveActions(pending, { level: 'view', myEmployeeId: 'omar' })).toEqual({ approve: false, reject: false, cancel: true })
    expect(leaveActions(pending, { level: 'view' })).toEqual({ approve: false, reject: false, cancel: false })
    expect(leaveActions(approved, { level: 'work' }).cancel).toBe(false)
    expect(leaveActions(approved, { level: 'manage' })).toEqual({ approve: false, reject: false, cancel: true })
    expect(leaveActions({ ...pending, status: 'rejected' }, { level: 'manage' })).toEqual({ approve: false, reject: false, cancel: false })
  })
  it('finds who is off on a day (approved only)', () => {
    const requests = [req('1', 'a', '2026-10-27', '2026-10-31', 4, 'approved'), req('2', 'b', '2026-10-28', '2026-10-28', 1, 'pending')]
    expect(offOn(requests, '2026-10-28').map(r => r.employee_id)).toEqual(['a'])
    expect(offOn(requests, '2026-11-01')).toEqual([])
  })
})

describe('refusals in words', () => {
  it('maps our codes and constraint names', () => {
    expect(errorKey('HR_LEAVE_BALANCE: 3 days left, 5 asked')).toBe('HR_LEAVE_BALANCE')
    expect(errorKey('duplicate key value violates unique constraint "hr_employees_no_uq"')).toBe('DUP_NUMBER')
    expect(errorKey('new row for relation "hr_attendance" violates check constraint "hr_attendance_span"')).toBe('SPAN')
    expect(errorKey('new row violates row-level security policy for table "hr_employees"')).toBe('NO_RIGHT')
    expect(errorKey('something else')).toBe('')
  })
  it('maps the parity pass names', () => {
    expect(errorKey('duplicate key value violates unique constraint "hr_contracts_one_running"')).toBe('ONE_RUNNING')
    expect(errorKey('HR_CONTRACT_LOCKED: the terms of a running contract cannot change')).toBe('HR_CONTRACT_LOCKED')
    expect(errorKey('violates check constraint "hr_leave_allocations_reason_check"')).toBe('ALLOC_REASON')
    expect(errorKey('violates unique constraint "hr_employee_private_identity_uq"')).toBe('DUP_IDENTITY')
    expect(errorKey('violates check constraint "hr_contracts_weekly_hours"')).toBe('WEEKLY_HOURS')
  })
})

describe('history', () => {
  it('lists the fields that changed, without the noise', () => {
    const row = { action: 'update', old_data: { id: 'x', status: 'draft', notes: '', updated_at: '1' }, new_data: { id: 'x', status: 'running', notes: '', updated_at: '2' } }
    expect(describeChange(row)).toEqual([{ field: 'status', from: 'draft', to: 'running' }])
  })
  it('lists what a new row held, skipping the empty', () => {
    const row = { action: 'insert', old_data: null, new_data: { id: 'x', workspace_id: 'w', contract_no: 'HC-1', notes: '', weekly_hours: null, status: 'draft' } }
    expect(describeChange(row).map(c => c.field).sort()).toEqual(['contract_no', 'status'])
  })
})
