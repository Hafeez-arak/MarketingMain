import { describe, it, expect } from 'vitest'
import { eventsAhead, whenLabel, isOpenTarget, targetStats } from './view'

const NOW = new Date('2026-10-07T09:00:00Z')

describe('events sales can still act on', () => {
  const events = [
    { id: 'late', start_date: '2027-03-01' },
    { id: 'soon', start_date: '2026-10-20', exhibitor_deadline: '2026-10-10' },
    { id: 'undated', start_date: null },
    { id: 'past', start_date: '2026-09-01', end_date: '2026-09-03' },
    { id: 'running', start_date: '2026-10-05', end_date: '2026-10-09' },
    { id: 'concluded', start_date: '2026-11-01', status: 'concluded' },
    { id: 'skipped', start_date: '2026-11-01', decision: 'skipping' },
    { id: 'far', start_date: '2028-01-01' },
  ]

  it('keeps upcoming, running and undated events, soonest first', () => {
    expect(eventsAhead(events, NOW).map(e => e.id)).toEqual(['running', 'soon', 'late', 'undated'])
  })

  it('carries how many days to the exhibitor deadline', () => {
    expect(eventsAhead(events, NOW).find(e => e.id === 'soon').deadlineDays).toBe(3)
  })

  it('narrows to a horizon', () => {
    expect(eventsAhead(events, NOW, 90).map(e => e.id)).toEqual(['running', 'soon', 'undated'])
  })
})

describe('labels and counts', () => {
  it('says when in words', () => {
    expect(whenLabel(null)).toBe('date to confirm')
    expect(whenLabel(0)).toBe('today')
    expect(whenLabel(1)).toBe('in 1 day')
    expect(whenLabel(120)).toBe('in 4 months')
  })

  it('a won, lost or dropped target is closed', () => {
    expect(isOpenTarget({ status: 'new' })).toBe(true)
    expect(isOpenTarget({ status: 'dropped' })).toBe(false)
  })

  it('counts what is still to work', () => {
    const s = targetStats({
      accounts: [{ status: 'new' }, { status: 'contacted' }, { status: 'won' }],
      ranked: { core: [{ fit: { band: 'strong' } }], broader: [{ fit: { band: 'weak' } }], other: [] },
      events: [{ start_date: '2026-10-20' }],
      now: NOW,
    })
    expect(s).toEqual({ accounts: 2, accountsUntouched: 1, core: 1, broader: 1, strong: 1, events90: 1 })
  })
})
