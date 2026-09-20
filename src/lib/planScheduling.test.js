import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' }))

const { bookingFor, accountFor, bookPostAt } = await import('./planScheduling')

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

// ─── bookPostAt ────────────────────────────────────────────────────────────
// The Schedule page's one write. Every branch below returns BEFORE any
// network call, which is the point: the page must refuse a bad slot itself
// rather than discovering it from a failed workflow run.
describe('bookPostAt', () => {
  const at = { dateKey: '2026-09-20', time: '19:00' }

  it('refuses a post that has already gone out', async () => {
    const res = await bookPostAt({ post: row({ publish_status: 'published' }), ...at, accounts: [ig], now: NOW })
    expect(res.error).toMatch(/already published/i)
  })

  it('refuses a post that is publishing right now', async () => {
    const res = await bookPostAt({ post: row({ publish_status: 'publishing' }), ...at, accounts: [ig], now: NOW })
    expect(res.error).toMatch(/publishing right now/i)
  })

  it('refuses a slot in the past', async () => {
    const res = await bookPostAt({
      post: row(), dateKey: '2026-09-15', time: '09:00', accounts: [ig], now: NOW,
    })
    expect(res.error).toMatch(/already passed/i)
  })

  it('refuses an unparseable slot rather than booking midnight', async () => {
    const res = await bookPostAt({ post: row(), dateKey: 'not-a-date', time: '19:00', accounts: [ig], now: NOW })
    expect(res.error).toMatch(/not a valid slot/i)
  })

  it('says which account is missing rather than guessing one', async () => {
    const res = await bookPostAt({ post: row(), ...at, accounts: [], now: NOW })
    expect(res.error).toMatch(/no instagram account is connected/i)
  })

  it('will not book a protected platform', async () => {
    const li = { platform: 'linkedin', is_active: true, zernio_account_id: 'acc-li' }
    const res = await bookPostAt({
      post: row({ platform: 'linkedin' }), ...at, accounts: [li], now: NOW,
    })
    expect(res.error).toMatch(/drafts/i)
  })
})
