import { describe, it, expect } from 'vitest'
import {
  deadlineFrom, turnaroundDays, quoteClock, parseSar, sizeBands, dealOdds,
  workingDay, followUpPlan, normaliseFollowUps, nextFollowUps, followUpState, followUpSummary,
  lostReasonFrom, outcomeFrom, pilotEmails, inPilot,
} from './cardFollowUp.js'

const BANDS = { quote_days: 15, size_odds: [{ max: 100000, rate: 39 }, { max: 500000, rate: 17 }, { max: 2000000, rate: 13 }, { max: null, rate: 2 }] }

describe('deadlineFrom', () => {
  it('reads the usual ways a deadline is written', () => {
    expect(deadlineFrom('Quote within 10 days (by 18 Oct).', '2026-10-08T09:00:00Z')).toBe('2026-10-18')
    expect(deadlineFrom('Offer due 12/11/2026', '')).toBe('2026-11-12')
    expect(deadlineFrom('closing date Nov 3rd', '2026-10-20')).toBe('2026-11-03')
    expect(deadlineFrom('submission 2026-11-12', '')).toBe('2026-11-12')
    expect(deadlineFrom('before the 5th of January', '2026-12-20')).toBe('2027-01-05')
  })
  it('puts a yearless date on or after the enquiry', () => {
    expect(deadlineFrom('by 2 Jan', '2026-12-28')).toBe('2027-01-02')
  })
  it('finds nothing in words without a date, or an impossible date', () => {
    expect(deadlineFrom('urgent', '2026-10-01')).toBe('')
    expect(deadlineFrom('31/02/2026', '')).toBe('')
    expect(deadlineFrom('by 18 Oct', '')).toBe('') // no year and no enquiry date to place it
  })
})

describe('quoteClock', () => {
  const base = { receivedAt: '2026-11-04T08:00:00Z', turnaround: 15, today: '2026-11-04' }
  it('warns when the deadline is shorter than our turnaround', () => {
    const c = quoteClock({ ...base, quoteDue: '2026-11-12' })
    expect(c.tone).toBe('tight')
    expect(c.text).toBe('8 days left (due 12 Nov) · our usual turnaround is 15 days → agree a budget price or a firm date today.')
  })
  it('is calm with time to spare, and falls back to the enquiry\'s date', () => {
    const c = quoteClock({ ...base, urgency: 'by 30 Dec' })
    expect(c).toMatchObject({ tone: 'ok', due: '2026-12-30' })
  })
  it('says when the deadline has passed', () => {
    expect(quoteClock({ ...base, today: '2026-11-14', quoteDue: '2026-11-12' }).tone).toBe('late')
  })
  it('says when the quote went, and whether it was late', () => {
    expect(quoteClock({ ...base, quoteDue: '2026-11-12', sentOn: '2026-11-07' }))
      .toEqual({ tone: 'sent', due: '2026-11-12', text: 'Quote sent 7 Nov, 3 days after the enquiry.' })
    expect(quoteClock({ ...base, quoteDue: '2026-11-12', sentOn: '2026-11-20' }).text).toMatch(/after their deadline \(12 Nov\)/)
  })
  it('shows nothing without a date, and no turnaround without the company\'s number', () => {
    expect(quoteClock({ ...base })).toBeNull()
    expect(quoteClock({ ...base, turnaround: 0, quoteDue: '2026-11-06' })).toMatchObject({ tone: 'ok', text: '2 days left (due 6 Nov).' })
    expect(turnaroundDays({})).toBe(0)
    expect(turnaroundDays({ quote_days: '15' })).toBe(15)
  })
})

describe('parseSar and dealOdds', () => {
  it('reads what salespeople type', () => {
    expect(parseSar('950k SAR')).toBe(950000)
    expect(parseSar('1.2M')).toBe(1200000)
    expect(parseSar('SAR 1,200,000')).toBe(1200000)
    expect(parseSar('about 600k for lighting')).toBe(600000)
    expect(parseSar('1.5 million')).toBe(1500000)
    expect(parseSar('not shared')).toBe(0)
    expect(parseSar('5')).toBe(0)
  })
  it('names the odds at that size, and the move when they are low', () => {
    expect(dealOdds('80k', BANDS)).toMatchObject({ rate: 39, low: false, text: 'At about 80k SAR we win about 39% of decided deals.' })
    expect(dealOdds('1.2M SAR', BANDS)).toMatchObject({ rate: 13, low: true })
    expect(dealOdds('5M', BANDS).rate).toBe(2)
    expect(dealOdds('', BANDS)).toBeNull()
    expect(dealOdds('950k', {})).toBeNull()
  })
  it('drops bands that make no sense', () => {
    expect(sizeBands({ size_odds: [{ max: 'x', rate: 5 }, { max: 100, rate: 150 }, { max: 100, rate: 10 }] })).toEqual([{ max: 100, rate: 10 }])
  })
})

describe('follow-ups', () => {
  it('moves a Friday or a Saturday to the Sunday after', () => {
    expect(workingDay('2026-11-13')).toBe('2026-11-15') // Fri
    expect(workingDay('2026-11-14')).toBe('2026-11-15') // Sat
    expect(workingDay('2026-11-16')).toBe('2026-11-16') // Mon
  })
  it('plans day 3, 10 and 30 from the sent date', () => {
    expect(followUpPlan('2026-11-07')).toEqual([
      { day: 3, date: '2026-11-10' }, { day: 10, date: '2026-11-17' }, { day: 30, date: '2026-12-07' },
    ])
    expect(followUpPlan('')).toEqual([])
  })
  it('re-plans on a new date, keeping the Odoo to-dos to move', () => {
    const was = nextFollowUps([], { sentOn: '2026-11-07' }).map((f, i) => ({ ...f, activity_id: 900 + i }))
    const moved = nextFollowUps(was, { sentOn: '2026-11-09', sentBefore: '2026-11-07' })
    expect(moved.map((f) => [f.date, f.activity_id])).toEqual([['2026-11-12', 900], ['2026-11-19', 901], ['2026-12-09', 902]])
  })
  it('applies ticks and notes by day, and clears with the date', () => {
    const now = new Date('2026-11-10T10:00:00Z')
    const was = nextFollowUps([], { sentOn: '2026-11-07' })
    const ticked = nextFollowUps(was, { sentOn: '2026-11-07', sentBefore: '2026-11-07', sent: [{ day: 3, done: true, note: 'Comparing offers' }], now })
    expect(ticked[0]).toMatchObject({ done_at: now.toISOString(), note: 'Comparing offers' })
    expect(ticked[1].done_at).toBeNull()
    expect(nextFollowUps(ticked, { sentOn: '', sentBefore: '2026-11-07' })).toEqual([])
  })
  it('keeps one per day, in order, whatever was stored', () => {
    expect(normaliseFollowUps([{ day: 10, date: '2026-11-17' }, { day: 3, date: '2026-11-10' }, { day: 3, date: '2026-11-11' }, { day: 7, date: '2026-11-14' }, 'x']).map((f) => f.day)).toEqual([3, 10])
  })
  it('knows late, today and done', () => {
    expect(followUpState({ date: '2026-11-10' }, '2026-11-11')).toBe('late')
    expect(followUpState({ date: '2026-11-11' }, '2026-11-11')).toBe('today')
    expect(followUpState({ date: '2026-11-10', done_at: 'x' }, '2026-11-11')).toBe('done')
    expect(followUpState({ date: '2026-11-20' }, '2026-11-11')).toBe('')
  })
  it('says why to call in the to-do', () => {
    expect(followUpSummary(3)).toMatch(/^Quote follow-up, day 3: Did the quote reach/)
  })
})

describe('the close from Odoo', () => {
  it('reads won and lost the way Odoo stores them', () => {
    expect(outcomeFrom({ active: true, probability: 100 })).toEqual({ stage: 'won', reason: '', reasonName: '' })
    expect(outcomeFrom({ active: false, probability: 0, lost_reason_id: [4, 'Too expensive'] })).toEqual({ stage: 'lost', reason: 'price', reasonName: 'Too expensive' })
    expect(outcomeFrom({ active: true, probability: 40 })).toBeNull()
    expect(outcomeFrom({ active: false, probability: 30 })).toBeNull() // archived, not lost
  })
  it('puts our own lateness first, whatever the reason says after', () => {
    expect(lostReasonFrom('Late reply from Arak')).toBe('arak_late')
    expect(lostReasonFrom('Samples / submittal not on time')).toBe('arak_late')
    expect(lostReasonFrom('Cannot quote specified brand')).toBe('brand')
    expect(lostReasonFrom('Not enough stock')).toBe('lead_time')
    expect(lostReasonFrom('No response from client')).toBe('no_reply')
    expect(lostReasonFrom('Regret to quote')).toBe('declined')
    expect(lostReasonFrom('Project on hold')).toBe('cancelled')
    expect(lostReasonFrom('')).toBe('other')
  })
})

describe('the pilot', () => {
  it('is off until people are named', () => {
    expect(inPilot({}, 'ammar@arak-sa.com')).toBe(false)
    expect(inPilot({ pilot: ['Ammar@Arak-sa.com', 'nonsense'] }, 'ammar@arak-sa.com')).toBe(true)
    expect(pilotEmails({ pilot: ['a@b.co', 'bad'] })).toEqual(['a@b.co'])
  })
})
