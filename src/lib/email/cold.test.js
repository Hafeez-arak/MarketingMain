import { describe, it, expect } from 'vitest'
import {
  inSendingWindow, nextWindowStart, gapMinutes, mailboxDomainProblem, mailboxCap, mailboxReadiness, inboxMessageKind,
  classifySmtpError, followUpSubject, HARD_MAX_PER_MAILBOX,
} from './cold.js'

describe('sending hours (Riyadh, Sunday–Thursday, 09:00–17:00)', () => {
  it('opens Sunday 09:00 and closes 17:00', () => {
    expect(inSendingWindow(new Date('2026-09-27T05:59:00Z'))).toBe(false)  // Sun 08:59
    expect(inSendingWindow(new Date('2026-09-27T06:00:00Z'))).toBe(true)   // Sun 09:00
    expect(inSendingWindow(new Date('2026-09-27T13:59:00Z'))).toBe(true)   // Sun 16:59
    expect(inSendingWindow(new Date('2026-09-27T14:00:00Z'))).toBe(false)  // Sun 17:00
  })
  it('is shut on Friday and Saturday', () => {
    expect(inSendingWindow(new Date('2026-10-02T08:00:00Z'))).toBe(false)  // Fri
    expect(inSendingWindow(new Date('2026-10-03T08:00:00Z'))).toBe(false)  // Sat
    expect(inSendingWindow(new Date('2026-10-01T08:00:00Z'))).toBe(true)   // Thu
  })
  it('next opens Sunday morning after a Thursday evening', () => {
    expect(nextWindowStart(new Date('2026-10-01T15:00:00Z')).toISOString()).toBe('2026-10-04T06:00:00.000Z')
    expect(nextWindowStart(new Date('2026-09-28T04:00:00Z')).toISOString()).toBe('2026-09-28T06:00:00.000Z')
  })
})

describe('the gap between two sends', () => {
  it('spreads the day and never goes under 4 minutes', () => {
    expect(gapMinutes(5, 0.5)).toBe(96)
    expect(gapMinutes(5, 0)).toBe(58)
    expect(gapMinutes(5, 1)).toBe(134)
    expect(gapMinutes(40, 0)).toBe(7)
    expect(gapMinutes(1000, 0)).toBe(4)
  })
})

describe('which addresses may send outreach', () => {
  const company = ['email.arak-sa.com', 'arak-sa.com']
  it('refuses the company domain, any subdomain of it, and free mail', () => {
    expect(mailboxDomainProblem('ahmed@arak-sa.com', company)).toMatch(/domain your company email depends on/)
    expect(mailboxDomainProblem('ahmed@outreach.arak-sa.com', company)).toMatch(/arak-sa\.com/)
    expect(mailboxDomainProblem('ahmed.arak@gmail.com', company)).toMatch(/personal Gmail/)
    expect(mailboxDomainProblem('not an address', company)).toMatch(/not a valid/)
  })
  it('accepts a separate outreach domain', () => {
    expect(mailboxDomainProblem('ahmed@araklighting.com', company)).toBe('')
  })
})

describe('how much a mailbox may send today', () => {
  const mb = { daily_limit: 30, first_sent_on: '2026-09-01' }
  it('ramps 5, then 10, then its own limit', () => {
    expect(mailboxCap({ ...mb, first_sent_on: null }, '2026-09-27').cap).toBe(5)
    expect(mailboxCap(mb, '2026-09-03').cap).toBe(5)
    expect(mailboxCap(mb, '2026-09-09').cap).toBe(10)
    expect(mailboxCap(mb, '2026-09-20').cap).toBe(30)
  })
  it('never exceeds the hard ceiling, whatever is stored', () => {
    expect(mailboxCap({ daily_limit: 500, first_sent_on: '2026-01-01' }, '2026-09-27').cap).toBe(HARD_MAX_PER_MAILBOX)
  })
  it('is ready two weeks after warm-up starts, and not while paused', () => {
    expect(mailboxReadiness({ status: 'active', warmup_started_on: '2026-09-13' }, '2026-09-27').ready).toBe(true)
    expect(mailboxReadiness({ status: 'active', warmup_started_on: '2026-09-14' }, '2026-09-27')).toMatchObject({ ready: false, readyOn: '2026-09-28' })
    expect(mailboxReadiness({ status: 'active', warmup_started_on: null }, '2026-09-27').ready).toBe(false)
    // A company Microsoft 365 mailbox needs no warm-up service; a date, if given, still holds it.
    expect(mailboxReadiness({ status: 'active', provider: 'microsoft', warmup_started_on: null }, '2026-09-27').ready).toBe(true)
    expect(mailboxReadiness({ status: 'active', provider: 'microsoft', warmup_started_on: '2026-09-20' }, '2026-09-27').ready).toBe(false)
    expect(mailboxReadiness({ status: 'error', provider: 'microsoft', warmup_started_on: null }, '2026-09-27').ready).toBe(false)
    expect(mailboxReadiness({ status: 'paused', status_reason: 'Paused by x', warmup_started_on: '2026-01-01' }, '2026-09-27')).toMatchObject({ ready: false, reason: 'Paused by x' })
  })
})

describe('what an SMTP failure means', () => {
  it('tells a bad login, a daily limit, a missing person and a blip apart', () => {
    expect(classifySmtpError({ code: 'EAUTH', responseCode: 535 })).toBe('auth')
    expect(classifySmtpError({ responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' })).toBe('limit')
    expect(classifySmtpError({ command: 'RCPT TO', responseCode: 550, response: '550 5.1.1 The email account does not exist' })).toBe('recipient')
    expect(classifySmtpError({ code: 'ETIMEDOUT' })).toBe('transient')
    expect(classifySmtpError({ responseCode: 421 })).toBe('transient')
  })
})

describe('follow-up subjects', () => {
  it('reply to the first email unless given their own', () => {
    expect(followUpSubject('', 'Lighting for Hotel Co')).toBe('Re: Lighting for Hotel Co')
    expect(followUpSubject('', 'Re: already')).toBe('Re: already')
    expect(followUpSubject('A new angle', 'Lighting')).toBe('A new angle')
  })
})

describe('inboxMessageKind', () => {
  it('knows a bounce by its sender or subject, in English or Arabic', () => {
    expect(inboxMessageKind({ from: 'postmaster@araksa.onmicrosoft.com', subject: 'Undeliverable: Hi' })).toBe('bounce')
    expect(inboxMessageKind({ from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)' })).toBe('bounce')
    expect(inboxMessageKind({ from: 'someone@x.com', subject: 'لم يتم التسليم: عرض' })).toBe('bounce')
  })
  it('knows an out-of-office', () => {
    expect(inboxMessageKind({ from: 'a@hotel.sa', subject: 'Automatic reply: Lighting' })).toBe('auto')
    expect(inboxMessageKind({ from: 'a@hotel.sa', subject: 'Out of Office: back Sunday' })).toBe('auto')
    expect(inboxMessageKind({ from: 'a@hotel.sa', subject: 'رد تلقائي: الإضاءة' })).toBe('auto')
  })
  it('anything else in the thread is a reply', () => {
    expect(inboxMessageKind({ from: 'a@hotel.sa', subject: 'RE: Lighting for Hotel Co' })).toBe('reply')
    expect(inboxMessageKind({ from: 'a@hotel.sa', subject: '' })).toBe('reply')
  })
})
