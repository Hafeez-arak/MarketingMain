import { describe, it, expect } from 'vitest'
import { ownChannelRows, setupGaps, emptiness } from './researchBrief'

// ─── Our own channels on the page ──────────────────────────────────────────
// Kept in its own file rather than appended to researchBrief.test.js: these
// all concern the multi-platform half, which arrived long after the rest and
// has its own failure modes.

describe('ownChannelRows', () => {
  const report = {
    own_performance: {
      platforms: [
        { platform: 'linkedin', label: 'LinkedIn', state: 'not_connected' },
        { platform: 'instagram', label: 'Instagram', state: 'measured', avg_engagement: 10 },
        { platform: 'tiktok', label: 'TikTok', state: 'unmeasured', posts: 3 },
      ],
    },
  }

  it('reads measured first, then what is actionable, then the dark channels', () => {
    expect(ownChannelRows(report).map(p => p.platform))
      .toEqual(['instagram', 'tiktok', 'linkedin'])
  })

  it('puts the stronger channel first when two are measured', () => {
    const out = ownChannelRows({
      own_performance: {
        platforms: [
          { platform: 'instagram', state: 'measured', avg_engagement: 4 },
          { platform: 'tiktok', state: 'measured', avg_engagement: 40 },
        ],
      },
    })
    expect(out.map(p => p.platform)).toEqual(['tiktok', 'instagram'])
  })

  it('is empty rather than throwing on a run that predates the field', () => {
    // Every run already stored has no own_performance. The page must render
    // those unchanged rather than crashing on history.
    expect(ownChannelRows({})).toEqual([])
    expect(ownChannelRows()).toEqual([])
  })
})

describe('setupGaps names per-platform gaps', () => {
  it('flags a channel that published without analytics', () => {
    const gaps = setupGaps({
      own_performance: {
        platforms: [{ platform: 'tiktok', label: 'TikTok', state: 'unmeasured', posts: 4 }],
      },
    })
    const gap = gaps.find(g => g.key === 'analytics_tiktok')
    expect(gap).toBeTruthy()
    expect(gap.what).toContain('TikTok')
  })

  it('flags an account needing reconnection, which is what explains a zero', () => {
    const gaps = setupGaps({
      own_performance: {
        platforms: [{
          platform: 'linkedin', label: 'LinkedIn', state: 'silent',
          connected: true, needs_reconnection: true,
        }],
      },
    })
    expect(gaps.find(g => g.key === 'reconnect_linkedin')).toBeTruthy()
  })

  it('does not nag about a platform that is simply fine', () => {
    const gaps = setupGaps({
      own_performance: {
        platforms: [{ platform: 'tiktok', label: 'TikTok', state: 'measured', connected: true }],
      },
    })
    expect(gaps.filter(g => g.key.includes('tiktok'))).toHaveLength(0)
  })
})

describe('emptiness counts our own measured week as content', () => {
  it('does not call a run empty when our own numbers came back', () => {
    // Otherwise a brand with real TikTok numbers and no market news is told
    // the run produced nothing, on a page displaying its numbers.
    expect(emptiness({ own_performance: { measured_count: 2 } }).empty).toBe(false)
  })

  it('still calls a genuinely empty run empty', () => {
    expect(emptiness({ own_performance: { measured_count: 0 } }).empty).toBe(true)
  })
})
