import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' }))

const { bookingFor, accountFor } = await import('./planScheduling')

// 2026-09-15 12:00 UTC = 15:00 in Riyadh.
const NOW = Date.parse('2026-09-15T12:00:00Z')
const ig = { platform: 'instagram', is_active: true, zernio_account_id: 'acc-ig' }
const row = over => ({
  id: 'p1', platform: 'instagram', publish_status: 'not_published',
  scheduled_date: '2026-09-20', publish_time: '19:00', ...over,
})

describe('bookingFor', () => {
  it('books a future post on the only connected account', () => {
    const plan = bookingFor(row(), { accounts: [ig], now: NOW })
    expect(plan.action).toBe('book')
    expect(plan.account).toBe(ig)
  })

  it('never touches a post that has gone out', () => {
    expect(bookingFor(row({ publish_status: 'published' }), { accounts: [ig], now: NOW }).action).toBe('skip')
    expect(bookingFor(row({ publish_status: 'scheduled', scheduled_publish_at: '2026-09-14T17:52:00Z' }), { accounts: [ig], now: NOW }).action).toBe('skip')
  })

  it('keeps an unchanged booked post and re-books a changed one', () => {
    const booked = row({ publish_status: 'scheduled', scheduled_publish_at: '2026-09-20T16:00:00Z' })
    expect(bookingFor(booked, { accounts: [ig], changed: false, now: NOW }).action).toBe('keep')
    expect(bookingFor(booked, { accounts: [ig], changed: true, now: NOW }).action).toBe('rebook')
  })

  it('leaves a post whose time has passed for a person', () => {
    const plan = bookingFor(row({ scheduled_date: '2026-09-15', publish_time: '09:30' }), { accounts: [ig], now: NOW })
    expect(plan.action).toBe('attention')
    expect(plan.reason).toMatch(/passed/)
  })

  it('keeps LinkedIn a draft', () => {
    const li = { platform: 'linkedin', is_active: true, zernio_account_id: 'acc-li' }
    expect(bookingFor(row({ platform: 'linkedin' }), { accounts: [li], now: NOW }).action).toBe('attention')
  })

  it('asks rather than guessing between two accounts', () => {
    const two = [ig, { ...ig, zernio_account_id: 'acc-ig-2' }]
    expect(bookingFor(row(), { accounts: two, now: NOW }).reason).toMatch(/More than one/)
    expect(accountFor(row({ zernio_account_id: 'acc-ig-2' }), two).zernio_account_id).toBe('acc-ig-2')
  })

  it('needs a connected account and a date', () => {
    expect(bookingFor(row(), { accounts: [], now: NOW }).reason).toMatch(/No instagram account/)
    expect(bookingFor(row({ scheduled_date: null }), { accounts: [ig], now: NOW }).reason).toMatch(/No date/)
  })
})
