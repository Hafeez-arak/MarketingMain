import { describe, it, expect } from 'vitest'
import {
  big, avg, changeLabel, stateWord, periodLabel, channelRows,
  strongestChannel, headline, summaryStats, caveats, pageInsightRows,
} from './performanceReport'

// The rule every one of these guards: null is not zero. The route below this
// module is careful to distinguish "we did not measure" from "it scored 0",
// and one careless formatter undoes all of it.

const platform = (over = {}) => ({
  platform: 'instagram',
  label: 'Instagram',
  connected: true,
  username: 'arak',
  followers: 1200,
  needs_reconnection: false,
  posts: 4,
  measured: 4,
  total_engagement: 40,
  avg_engagement: 10,
  best_post: null,
  page_insights: null,
  undated: 0,
  weak: false,
  change: null,
  state: 'measured',
  note: '',
  ...over,
})

const payload = (over = {}) => ({
  ok: true,
  period: { start: '2026-08-16T00:00:00.000Z', end: '2026-09-15T00:00:00.000Z', days: 30 },
  own: { platforms: [platform()], connected_count: 1, measured_count: 1, note: '' },
  totals: {
    posts: 4, measured: 4, total_engagement: 40, avg_engagement: 10,
    followers: 1200, connected_count: 1, measured_count: 1,
  },
  best_posts: [],
  zernio_note: '',
  ...over,
})

describe('big', () => {
  it('prints a dash for a missing number rather than a zero', () => {
    expect(big(null)).toBe('—')
    expect(big(undefined)).toBe('—')
    expect(big('')).toBe('—')
  })

  it('keeps a real zero as a zero', () => {
    expect(big(0)).toBe('0')
  })

  it('abbreviates only once the digits stop being readable', () => {
    expect(big(950)).toBe('950')
    expect(big(9_999)).toBe('9,999')
    expect(big(41_200)).toBe('41.2k')
    expect(big(2_400_000)).toBe('2.4m')
  })
})

describe('avg', () => {
  it('keeps one decimal in the range Arak actually lives in', () => {
    // The whole reason this is not `big`: 3.5 and 4.4 both round to 4, and a
    // channel table where every row reads 4 has stopped saying anything.
    expect(avg(3.5)).toBe('3.5')
    expect(avg(4.4)).toBe('4.4')
  })

  it('drops the decimal once it is noise', () => {
    expect(avg(1234.6)).toBe('1,235')
  })

  it('is a dash when nothing was measured', () => {
    expect(avg(null)).toBe('—')
  })
})

describe('changeLabel', () => {
  it('is a dash when no change could be computed', () => {
    expect(changeLabel(null)).toBe('—')
  })

  it('carries direction as a glyph, not only a colour', () => {
    expect(changeLabel({ direction: 'up', change_pct: 42.4 })).toBe('▲ 42%')
    expect(changeLabel({ direction: 'down', change_pct: 18 })).toBe('▼ 18%')
  })
})

describe('stateWord', () => {
  it('separates the three ways a channel can have no numbers', () => {
    expect(stateWord('measured')).toBe('Measured')
    expect(stateWord('unmeasured')).toBe('No analytics yet')
    expect(stateWord('silent')).toBe('Nothing published')
    expect(stateWord('not_connected')).toBe('Not connected')
  })
})

describe('periodLabel', () => {
  it('reads as a window a person can check against a calendar', () => {
    // Asserted by shape, not by exact spelling: en-GB renders September as
    // "Sep" or "Sept" depending on the ICU data the Node build ships with,
    // and pinning one of them fails the suite on a different machine for a
    // reason that has nothing to do with this code.
    const label = periodLabel({ start: '2026-08-16T00:00:00Z', end: '2026-09-15T00:00:00Z' })
    expect(label).toMatch(/^16 Aug – 15 Sept? 2026$/)
  })

  it('is empty rather than "Invalid Date" when the period is missing', () => {
    expect(periodLabel(null)).toBe('')
    expect(periodLabel({})).toBe('')
  })
})

describe('channelRows', () => {
  it('puts the channels carrying a conclusion first and keeps the dark ones', () => {
    const rows = channelRows(payload({
      own: {
        platforms: [
          platform({ platform: 'tiktok', label: 'TikTok', state: 'not_connected', connected: false }),
          platform({ platform: 'linkedin', label: 'LinkedIn', state: 'silent' }),
          platform({ platform: 'instagram', label: 'Instagram', state: 'measured' }),
        ],
        connected_count: 2,
      },
    }))
    expect(rows.map(r => r.platform)).toEqual(['instagram', 'linkedin', 'tiktok'])
  })

  it('orders two measured channels by engagement', () => {
    const rows = channelRows(payload({
      own: {
        platforms: [
          platform({ platform: 'instagram', avg_engagement: 3 }),
          platform({ platform: 'linkedin', label: 'LinkedIn', avg_engagement: 31 }),
        ],
      },
    }))
    expect(rows[0].platform).toBe('linkedin')
  })
})

describe('strongestChannel', () => {
  it('is null when nothing was measured, rather than the first row', () => {
    expect(strongestChannel(payload({
      own: { platforms: [platform({ state: 'silent', avg_engagement: null })] },
    }))).toBeNull()
  })

  it('ignores an unmeasured channel even if it somehow carries a number', () => {
    const best = strongestChannel(payload({
      own: {
        platforms: [
          platform({ platform: 'linkedin', state: 'unmeasured', avg_engagement: 99 }),
          platform({ platform: 'instagram', state: 'measured', avg_engagement: 10 }),
        ],
      },
    }))
    expect(best.platform).toBe('instagram')
  })
})

describe('headline', () => {
  it('says nothing is connected before it says nothing was measured', () => {
    const line = headline(payload({
      totals: { posts: 0, measured: 0, connected_count: 0 },
      own: { platforms: [], connected_count: 0 },
    }))
    expect(line).toMatch(/No social account is connected/)
  })

  it('distinguishes a silent period from an unmeasured one', () => {
    expect(headline(payload({ totals: { posts: 0, measured: 0, connected_count: 2 } })))
      .toMatch(/Nothing was published/)
    expect(headline(payload({ totals: { posts: 3, measured: 0, connected_count: 2 } })))
      .toMatch(/none has analytics synced yet/)
  })

  it('never claims more posts were measured than were published', () => {
    const line = headline(payload({
      totals: {
        posts: 6, measured: 2, avg_engagement: 3.5,
        connected_count: 1, measured_count: 1,
      },
    }))
    expect(line).toContain('6 posts went out')
    expect(line).toContain('2 of 6 could be measured')
    expect(line).toContain('3.5 interactions each')
  })

  it('names the strongest channel when there is one', () => {
    const line = headline(payload({
      own: {
        connected_count: 2,
        platforms: [
          platform({ platform: 'instagram', label: 'Instagram', avg_engagement: 4 }),
          platform({ platform: 'linkedin', label: 'LinkedIn', avg_engagement: 28 }),
        ],
      },
    }))
    expect(line).toContain('LinkedIn is the strongest channel at 28 per post')
  })
})

describe('summaryStats', () => {
  it('shows a dash, not a zero, for an average over nothing', () => {
    const stats = summaryStats(payload({
      totals: { posts: 3, measured: 0, avg_engagement: null, total_engagement: null, followers: 900, connected_count: 1 },
    }))
    const byLabel = Object.fromEntries(stats.map(s => [s.label, s]))
    expect(byLabel['Average per post'].value).toBe('—')
    expect(byLabel['Total interactions'].value).toBe('—')
    expect(byLabel['Posts published'].value).toBe('3')
  })
})

describe('pageInsightRows', () => {
  const withPage = (insights) => payload({
    own: {
      connected_count: 1,
      platforms: [platform({
        platform: 'linkedin', label: 'LinkedIn', posts: 1, measured: 1,
        avg_engagement: 17, page_insights: insights,
      })],
    },
  })

  it('is empty when no channel reports page totals', () => {
    expect(pageInsightRows(payload())).toEqual([])
  })

  it('skips a page whose read failed rather than printing zeros for it', () => {
    expect(pageInsightRows(withPage({ ok: false, error: 'token expired' }))).toEqual([])
  })

  it('carries the whole-page numbers, which are not the per-post ones', () => {
    // The real 15 Sep 2026 shape: one post and 17 interactions in the channel
    // table, 2,433 impressions and 52 new followers on the page. Both true;
    // collapsing them would report Arak's strongest channel as idle.
    const [row] = pageInsightRows(withPage({
      ok: true, name: 'ARAK Lighting', impressions: 2433, members_reached: 673,
      clicks: 233, reactions: 58, comments: 0, engagement_rate_pct: 7.22,
      followers_gained_organic: 52, page_views: { total: 46 },
    }))
    const byLabel = Object.fromEntries(row.stats.map(s => [s.label, s.value]))
    expect(row.label).toBe('LinkedIn')
    expect(row.name).toBe('ARAK Lighting')
    expect(byLabel.Impressions).toBe('2,433')
    expect(byLabel['People reached']).toBe('673')
    expect(byLabel['New followers']).toBe('52')
    expect(byLabel['Engagement rate']).toBe('7.2%')
    expect(byLabel.Comments).toBe('0')
  })

  it('dashes a metric the platform did not return', () => {
    const [row] = pageInsightRows(withPage({ ok: true, impressions: 100 }))
    const byLabel = Object.fromEntries(row.stats.map(s => [s.label, s.value]))
    expect(byLabel.Clicks).toBe('—')
    expect(byLabel['Engagement rate']).toBe('—')
  })
})

describe('caveats', () => {
  it('flags a thin sample even though the average itself is exact', () => {
    const out = caveats(payload({
      own: { platforms: [platform({ measured: 2, posts: 2 })], connected_count: 1, note: '' },
    }))
    expect(out.join(' ')).toMatch(/fewer than 5 measured posts/)
  })

  it('names an unmeasured channel and a channel needing reconnection separately', () => {
    const out = caveats(payload({
      own: {
        platforms: [
          platform({ platform: 'linkedin', label: 'LinkedIn', state: 'unmeasured', measured: 0 }),
          platform({ platform: 'tiktok', label: 'TikTok', needs_reconnection: true }),
        ],
        connected_count: 2,
        note: '',
      },
    }))
    const text = out.join(' ')
    expect(text).toMatch(/LinkedIn: posts went out but no analytics/)
    expect(text).toMatch(/TikTok needs reconnecting/)
  })

  it('reports mid-publish posts as counted nowhere rather than as zero', () => {
    const out = caveats(payload({
      own: { platforms: [platform({ undated: 2 })], connected_count: 1, note: '' },
    }))
    expect(out.join(' ')).toMatch(/2 posts are mid-publish/)
  })

  it('carries the Zernio note through, so a missing key is not silence', () => {
    const out = caveats(payload({ zernio_note: 'ZERNIO_API_KEY is not set.' }))
    expect(out).toContain('ZERNIO_API_KEY is not set.')
  })

  it('caps the list rather than printing eight near-identical lines', () => {
    const many = Array.from({ length: 4 }, (_, i) => platform({
      platform: `p${i}`, label: `P${i}`, measured: 1, undated: 1, needs_reconnection: true, state: 'measured',
    }))
    const out = caveats(payload({ own: { platforms: many, connected_count: 4, note: 'note' } }))
    expect(out.length).toBeLessThanOrEqual(6)
  })
})
