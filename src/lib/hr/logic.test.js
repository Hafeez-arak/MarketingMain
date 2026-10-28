import { describe, it, expect } from 'vitest'
import {
  riyadhToday, addDays, spanDays, monthDays, workingDays, weekday, nameOf, matchLogin, filterEmployees,
  docState, expiringDocs, contractState, leaveProblem, balanceOf, leaveActions, offOn, errorKey,
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
})

describe('papers and contracts', () => {
  const today = '2026-10-28'
  it('marks expired, soon (60 days) and fine', () => {
    expect(docState({ expiry_date: '2026-10-27' }, today)).toEqual({ state: 'expired', days: -1 })
    expect(docState({ expiry_date: '2026-10-28' }, today).state).toBe('soon')
    expect(docState({ expiry_date: '2026-12-27' }, today)).toEqual({ state: 'soon', days: 60 })
    expect(docState({ expiry_date: '2026-12-28' }, today).state).toBe('ok')
    expect(docState({ expiry_date: null }, today).state).toBe('none')
  })
  it('lists running-out papers of people still employed, soonest first', () => {
    const employees = [emp('a'), emp('b', { status: 'ended' })]
    const docs = [
      { id: 1, employee_id: 'a', expiry_date: '2026-11-30' },
      { id: 2, employee_id: 'a', expiry_date: '2026-10-01' },
      { id: 3, employee_id: 'a', expiry_date: '2030-01-01' },
      { id: 4, employee_id: 'b', expiry_date: '2026-10-01' },
    ]
    expect(expiringDocs(docs, employees, today).map(d => d.id)).toEqual([2, 1])
  })
  it('tells a contract\'s state by its dates', () => {
    expect(contractState({ start_date: '2027-01-01', end_date: null }, today)).toBe('upcoming')
    expect(contractState({ start_date: '2024-01-01', end_date: '2026-10-28' }, today)).toBe('current')
    expect(contractState({ start_date: '2024-01-01', end_date: '2026-10-27' }, today)).toBe('ended')
    expect(contractState({ start_date: '2024-01-01', end_date: null }, today)).toBe('current')
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
  it('counts a balance the way the database does', () => {
    const balances = [{ employee_id: 'a', leave_type_id: 'annual', year: 2026, days: '21.0' }]
    const requests = [
      req('1', 'a', '2026-09-14', '2026-09-18', '5.0', 'approved'),
      req('2', 'a', '2026-11-08', '2026-11-10', '3.0', 'pending'),
      req('3', 'a', '2026-12-20', '2026-12-31', '9.0', 'rejected'),
      req('4', 'a', '2026-10-05', '2026-10-05', '1.0', 'cancelled'),
      // Starts in December: counts in 2026 even though it ends in 2027.
      req('5', 'a', '2026-12-30', '2027-01-02', '2.0', 'approved'),
      req('6', 'a', '2027-01-10', '2027-01-10', '1.0', 'approved'),
      req('7', 'b', '2026-09-01', '2026-09-01', '1.0', 'approved'),
    ]
    expect(balanceOf({ balances, requests, employeeId: 'a', typeId: 'annual', year: 2026 })).toEqual({ granted: 21, used: 7, pending: 3, remaining: 14 })
    expect(balanceOf({ balances, requests, employeeId: 'a', typeId: 'annual', year: 2027 })).toEqual({ granted: null, used: 1, pending: 0, remaining: -1 })
  })
  it('lets the right people decide, never the employee', () => {
    const pending = req('1', 'omar', '2026-11-08', '2026-11-10', 3)
    const approved = { ...pending, status: 'approved' }
    const isManager = id => id === 'omar'
    expect(leaveActions(pending, { level: 'manage' })).toEqual({ approve: true, reject: true, cancel: true })
    expect(leaveActions(pending, { level: 'manage', myEmployeeId: 'omar' })).toEqual({ approve: false, reject: false, cancel: true })
    expect(leaveActions(pending, { level: 'view', managerOf: isManager })).toEqual({ approve: true, reject: true, cancel: false })
    expect(leaveActions(pending, { level: 'work' })).toEqual({ approve: false, reject: false, cancel: true })
    expect(leaveActions(pending, { level: 'view', myEmployeeId: 'omar' })).toEqual({ approve: false, reject: false, cancel: true })
    expect(leaveActions(pending, { level: 'view' })).toEqual({ approve: false, reject: false, cancel: false })
    expect(leaveActions(approved, { level: 'work' }).cancel).toBe(false)
    expect(leaveActions(approved, { level: 'manage' })).toEqual({ approve: false, reject: false, cancel: true })
    expect(leaveActions({ ...pending, status: 'rejected' }, { level: 'manage' })).toEqual({ approve: false, reject: false, cancel: false })
    expect(leaveActions(pending, { level: null, managerOf: isManager }).approve).toBe(false)
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
})
