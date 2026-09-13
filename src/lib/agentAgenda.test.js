import { describe, it, expect } from 'vitest'
import { watchlistReadiness } from './agentAgenda'

// ─── The two gates ─────────────────────────────────────────────────────────
// A competitor is measured only when BOTH are open: a person accepted
// watching the company (status), and we have an account we are willing to
// attribute to them (ig_status). The summary line on the watchlist has to
// agree with what gather will actually do, or it promises numbers that never
// arrive.

const c = (status, ig_status, extra = {}) =>
  ({ subject: 'X', status, ig_status, ig_handle: ig_status === 'not_found' ? '' : 'x', ...extra })

describe('watchlistReadiness', () => {
  it('counts an accepted, resolved rival as measurable', () => {
    const r = watchlistReadiness([c('active', 'resolved')])
    expect(r.measurable).toBe(1)
    expect(r.note).toContain('1 of 1')
  })

  it('does NOT count a proposed rival as measurable, even with a resolved handle', () => {
    // The bug this test exists for. gather requires status=active, so calling
    // this one measurable would leave the board a company short of the claim.
    const r = watchlistReadiness([c('proposed', 'resolved')])
    expect(r.measurable).toBe(0)
    expect(r.pending).toBe(1)
    expect(r.note).toContain('awaiting your accept')
  })

  it('treats a hand-set handle as measurable, like the pipeline does', () => {
    expect(watchlistReadiness([c('active', 'human_set')]).measurable).toBe(1)
  })

  it('ignores retired rows entirely', () => {
    const r = watchlistReadiness([c('retired', 'resolved'), c('active', 'resolved')])
    expect(r.total).toBe(1)
    expect(r.measurable).toBe(1)
  })

  it('separates "nothing accepted" from "nothing resolved"', () => {
    // Two different problems with two different fixes: click accept, versus
    // go and find a handle.
    expect(watchlistReadiness([c('proposed', 'resolved')]).note)
      .toContain('No competitor has been accepted')
    expect(watchlistReadiness([c('active', 'not_found')]).note)
      .toContain('has a usable handle')
  })

  it('mentions pending rivals alongside a healthy count, not instead of it', () => {
    const r = watchlistReadiness([c('active', 'resolved'), c('proposed', 'unresolved')])
    expect(r.note).toContain('1 of 1')
    expect(r.note).toContain('awaiting your accept')
  })

  it('says plainly when the watchlist is empty', () => {
    expect(watchlistReadiness([]).note).toContain('No competitors are being watched')
    expect(watchlistReadiness(null).total).toBe(0)
  })
})
