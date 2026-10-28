import { describe, it, expect } from 'vitest'
import {
  riyadh, clock, fromRiyadh, toRiyadhLocal, hm, buildDays, sheetTotals, monthSummary, punchRoles, periods, parseCsv, chunks, byNumber, scheduleLabel,
} from './attendance'

// Riyadh is UTC+3: 08:00 there is 05:00Z.
const at = (day, time) => `${day}T${time}:00+03:00`
const iso = (day, time) => new Date(at(day, time)).toISOString()

const SETTINGS = { work_days: [0, 1, 2, 3, 4], work_start: '08:00:00', work_end: '17:00:00', grace_minutes: 15, schedule_from: '2026-09-01', repeat_punch_minutes: 3 }
const SARA = { id: 'e1', hire_date: '2023-02-12', end_date: null, status: 'active' }
const NOW = iso('2026-10-28', '10:00') // a Wednesday

describe('Riyadh time', () => {
  it('reads a moment on Riyadh\'s clock and calendar', () => {
    expect(riyadh('2026-10-27T22:30:00Z')).toEqual({ day: '2026-10-28', time: '01:30' })
    expect(clock(iso('2026-10-28', '08:05'))).toBe('08:05')
    expect(clock(null)).toBe('—')
  })
  it('turns a form\'s Riyadh time into a moment and back', () => {
    expect(fromRiyadh('2026-10-28T08:00')).toBe('2026-10-28T05:00:00.000Z')
    expect(toRiyadhLocal('2026-10-28T05:00:00Z')).toBe('2026-10-28T08:00')
    expect(fromRiyadh('')).toBeNull()
  })
  it('shows hours as h:mm, unknown as a dash', () => {
    expect(hm(8.5)).toBe('8:30')
    expect(hm(0.05)).toBe('0:03')
    expect(hm(null)).toBe('—')
  })
})

describe('one person\'s day', () => {
  const day = (overrides = {}, date = '2026-10-27') =>
    buildDays({ employees: [SARA], from: date, to: date, settings: SETTINGS, now: NOW, ...overrides }).e1[date]

  it('a manual session is a day worked, with its hours', () => {
    const d = day({ records: [{ employee_id: 'e1', check_in: iso('2026-10-27', '08:00'), check_out: iso('2026-10-27', '16:30'), worked_hours: 8.5, source: 'manual' }] })
    expect(d).toMatchObject({ status: 'left', source: 'manual', hours: 8.5, scheduled: '08:00–17:00' })
    expect(clock(d.arrival)).toBe('08:00')
    expect(clock(d.departure)).toBe('16:30')
  })
  it('the device\'s first and last punch are the arrival and departure', () => {
    const d = day({ punchDays: [{ employee_id: 'e1', work_day: '2026-10-27', punches: 3, first_at: iso('2026-10-27', '08:20'), last_at: iso('2026-10-27', '16:30'), state: 'applied', device_name: 'Door' }],
      records: [{ employee_id: 'e1', check_in: iso('2026-10-27', '08:20'), check_out: iso('2026-10-27', '16:30'), worked_hours: 8.17, source: 'device' }],
      flags: [{ employee_id: 'e1', work_day: '2026-10-27', kind: 'late', minutes: 20, excuse_reason: null }, { employee_id: 'e1', work_day: '2026-10-27', kind: 'early', minutes: 30, excuse_reason: 'Doctor' }] })
    expect(d).toMatchObject({ status: 'left', source: 'device', device: 'Door', punches: 3, late: 20, early: 30, earlyExcuse: 'Doctor' })
  })
  it('one punch on a past day is for review', () => {
    expect(day({ punchDays: [{ employee_id: 'e1', work_day: '2026-10-27', punches: 1, first_at: iso('2026-10-27', '08:00'), last_at: iso('2026-10-27', '08:00'), state: 'single' }] }).status).toBe('single')
  })
  it('today: in until the departure; the hours count up to now', () => {
    const d = day({ records: [{ employee_id: 'e1', check_in: iso('2026-10-28', '08:00'), check_out: null, worked_hours: null, source: 'manual' }] }, '2026-10-28')
    expect(d).toMatchObject({ status: 'present', open: true, hours: 2 })
  })
  it('a working day with nothing is absent; today not yet; leave wins', () => {
    expect(day().status).toBe('absent')
    expect(day({}, '2026-10-28').status).toBe('not_yet')
    expect(day({ leaves: [{ employee_id: 'e1', status: 'approved', date_from: '2026-10-27', date_to: '2026-10-27', leave_type_id: 't' }], leaveTypes: [{ id: 't', name_en: 'Annual', name_ar: 'سنوية' }] }))
      .toMatchObject({ status: 'leave', leave: 'Annual' })
  })
  it('nothing is assumed without a work week', () => {
    const d = day({ settings: null })
    expect(d).toMatchObject({ status: 'unknown', scheduled: null })
  })
  it('a weekend is off; before the hire date is outside the employment', () => {
    expect(day({}, '2026-10-30').status).toBe('off')
    expect(day({}, '2023-01-02').status).toBe('not_employed')
  })
  it('the schedule shows only from its start date and on working days', () => {
    expect(day({}, '2026-08-31').scheduled).toBeNull()
    expect(scheduleLabel(SETTINGS)).toBe('08:00–17:00')
  })
})

describe('the month', () => {
  it('sheet totals leave excused lateness out', () => {
    const t = sheetTotals([
      { status: 'left', hours: 8, late: 20, lateExcuse: null },
      { status: 'left', hours: 7.5, late: 10, lateExcuse: 'Traffic', early: 30, earlyExcuse: null },
      { status: 'absent' }, { status: 'leave' }, { status: 'off' },
    ])
    expect(t).toEqual({ present: 2, absent: 1, leave: 1, late: 1, lateMinutes: 20, early: 1, earlyMinutes: 30, hours: 15.5 })
  })
  it('the records page summary counts days, hours, leave and working days without a record', () => {
    const [row] = monthSummary({
      employees: [SARA], month: '2026-10', today: '2026-10-08', settings: SETTINGS,
      records: [{ employee_id: 'e1', check_in: iso('2026-10-01', '08:00'), worked_hours: 8 }, { employee_id: 'e1', check_in: iso('2026-10-01', '13:00'), worked_hours: 3 },
        { employee_id: 'e1', check_in: iso('2026-10-04', '08:00'), worked_hours: 9 }],
      leaves: [{ employee_id: 'e1', status: 'approved', date_from: '2026-10-05', date_to: '2026-10-06' }],
    })
    // Working days 1–8 Oct: 1, 4, 5, 6, 7, 8 (Thu, Sun–Thu). Recorded 1 and 4, leave 5 and 6: 7 and 8 are missing.
    expect(row).toMatchObject({ days: 2, hours: 20, leave: 2, missing: 2 })
  })
  it('missing is unknown without a work week', () => {
    expect(monthSummary({ employees: [SARA], month: '2026-10', today: '2026-10-08' })[0].missing).toBeNull()
  })
})

describe('the punch log', () => {
  const p = (id, time, no = '7', day = '2026-10-27') => ({ id, device_user_no: no, work_day: day, punched_at: iso(day, time) })
  it('first in, last out, the rest in between', () => {
    expect(punchRoles([p('a', '08:00'), p('b', '12:00'), p('c', '17:00')], 3)).toEqual({ a: 'in', b: 'mid', c: 'out' })
  })
  it('a punch pressed twice is a repeat, only when the repeat minutes are set', () => {
    expect(punchRoles([p('a', '08:00'), p('b', '08:01'), p('c', '17:00')], 3)).toEqual({ a: 'in', b: 'dup', c: 'out' })
    expect(punchRoles([p('a', '08:00'), p('b', '08:01'), p('c', '17:00')], null)).toEqual({ a: 'in', b: 'mid', c: 'out' })
  })
  it('a lone punch, or all within the repeat minutes, is single', () => {
    expect(punchRoles([p('a', '08:00')], 3)).toEqual({ a: 'single' })
    expect(punchRoles([p('a', '08:00'), p('b', '08:02')], 3)).toEqual({ a: 'single', b: 'dup' })
  })
  it('each person\'s day apart', () => {
    expect(punchRoles([p('a', '08:00'), p('b', '17:00', '8')], 3)).toEqual({ a: 'single', b: 'single' })
  })
  it('periods: the week from Sunday, last month whole', () => {
    expect(periods('2026-10-28')).toMatchObject({ week: ['2026-10-25', '2026-10-28'], last_month: ['2026-09-01', '2026-09-30'], yesterday: ['2026-10-27', '2026-10-27'] })
  })
})

describe('a file of punches', () => {
  it('reads the bridge\'s CSV, skipping a header', () => {
    expect(parseCsv('﻿user_no,time,verify,inout,workcode\r\n7,2026-10-26 8:0:16,1,0,0\n"8","2026-10-26 17:05:00"\n\n')).toEqual([
      { user_no: '7', time: '2026-10-26 8:0:16', verify: '1', inout: '0', workcode: '0' },
      { user_no: '8', time: '2026-10-26 17:05:00', verify: null, inout: null, workcode: null },
    ])
  })
  it('sends it in parts of 2,000', () => {
    expect(chunks(Array.from({ length: 4500 }, (_, i) => i)).map(c => c.length)).toEqual([2000, 2000, 500])
  })
  it('sorts device numbers as numbers', () => {
    expect(['10', '2', '1'].sort(byNumber)).toEqual(['1', '2', '10'])
  })
})
