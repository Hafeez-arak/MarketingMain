import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { spendBreakdown, projectedMonth, surfaceLabel, monthStarts } = await import('./aiSpend')

const NOW = new Date('2026-10-18T12:00:00Z')

describe('spendBreakdown', () => {
  it('totals this month and last, and splits this month by feature, largest first', () => {
    const out = spendBreakdown([
      { surface: 'run', cost_usd: 9.15, created_at: '2026-10-05T00:00:00Z' },
      { surface: 'chat', cost_usd: 0.25, created_at: '2026-10-18T09:00:00Z' },
      { surface: 'chat', cost_usd: 0.18, created_at: '2026-10-17T09:00:00Z' },
      { surface: 'lead_qualifier', cost_usd: 0.16, created_at: '2026-10-02T00:00:00Z' },
      { surface: 'run', cost_usd: 5, created_at: '2026-09-20T00:00:00Z' },
      { surface: 'run', cost_usd: 7, created_at: '2026-08-31T23:59:59Z' },
    ], NOW)
    expect(out.total).toBe(9.74)
    expect(out.lastTotal).toBe(5)
    expect(out.bySurface.map(s => [s.label, s.cost])).toEqual([
      ['Weekly research run', 9.15], ['Assistant chat', 0.43], ['Lead agent', 0.16],
    ])
  })
})

describe('helpers', () => {
  it('projects the month at the current daily rate', () => {
    expect(projectedMonth(18, NOW)).toBe(31)
  })
  it('labels unknown surfaces readably', () => {
    expect(surfaceLabel('some_new_job')).toBe('some new job')
  })
  it('month starts are UTC firsts', () => {
    expect(monthStarts(NOW)).toEqual({ thisMonth: '2026-10-01T00:00:00.000Z', lastMonth: '2026-09-01T00:00:00.000Z' })
    expect(monthStarts(new Date('2026-01-10T00:00:00Z')).lastMonth).toBe('2025-12-01T00:00:00.000Z')
  })
})
