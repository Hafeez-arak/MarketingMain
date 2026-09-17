import { describe, it, expect } from 'vitest'
import {
  accountSummary, combineOverview, platformSeries, bucketsInRange,
  bucketModeFor, weekOf, followerChange, engagementRate,
  supportsMetric,
} from './dashboardOverview'

const account = (platform, id = `${platform}-1`) => ({
  platform, zernio_account_id: id, username: `${platform}_acct`,
})

const post = (platform, analytics, publishedAt = '2026-09-10T10:00:00Z') => ({
  platform, publishedAt, analytics,
})

const dash = (over = {}) => ({
  fromDate: '2026-08-18', toDate: '2026-09-16',
  overview: { posts: [], accounts: [] },
  daily: { dailyData: [] },
  followers: { stats: {}, accounts: [] },
  ...over,
})

describe('accountSummary', () => {
  it('keeps a failed account rather than dropping it', () => {
    // A dropped account turns "LinkedIn is down" into "LinkedIn did nothing".
    const s = accountSummary(account('linkedin'), { error: 'Zernio timed out.' })
    expect(s.error).toBe('Zernio timed out.')
    expect(s.platform).toBe('linkedin')
    expect(s.posts).toBe(0)
  })

  it('sums post metrics and derives the engagement rate', () => {
    const s = accountSummary(account('instagram'), dash({
      overview: {
        posts: [
          post('instagram', { likes: 40, comments: 10, shares: 0, saves: 0, reach: 1000, views: 500 }),
          post('instagram', { likes: 60, comments: 10, shares: 5, saves: 5, reach: 1000, views: 700 }),
        ],
        accounts: [],
      },
    }))
    expect(s.posts).toBe(2)
    expect(s.metrics.likes).toBe(100)
    expect(s.metrics.views).toBe(1200)
    expect(s.interactions).toBe(130)
    expect(s.engagementRate).toBeCloseTo(6.5, 5)
  })

  it('reads followers as null when no source has counted, not as zero', () => {
    const s = accountSummary(account('instagram'), dash({
      overview: { posts: [], accounts: [{ _id: 'instagram-1', followersCount: null }] },
      followers: { stats: {}, accounts: [{ _id: 'instagram-1', currentFollowers: 0, dataPoints: 0 }] },
    }))
    expect(s.followers).toBe(null)
  })

  it('reads a genuine zero as zero', () => {
    const s = accountSummary(account('instagram'), dash({
      followers: { stats: {}, accounts: [{ _id: 'instagram-1', currentFollowers: 0, dataPoints: 12 }] },
    }))
    expect(s.followers).toBe(0)
  })

  it('takes account-wide views from Instagram insights, not from the posts', () => {
    const s = accountSummary(account('instagram'), dash({
      overview: { posts: [post('instagram', { views: 500, reach: 400 })], accounts: [] },
      insights: { metrics: { views: { total: 9000 }, reach: { total: 7000 }, profile_links_taps: { total: 12 } } },
    }))
    expect(s.metrics.views).toBe(500)   // post views
    expect(s.accountViews).toBe(9000)   // every surface, profile included
    expect(s.accountReach).toBe(7000)
    expect(s.profileTaps).toBe(12)
  })

  it('takes LinkedIn page views from the page totals', () => {
    const s = accountSummary(account('linkedin'), dash({
      linkedinPage: { metrics: { page_views_total: { total: 340 }, unique_impressions: { total: 2100 } } },
    }))
    expect(s.accountViews).toBe(340)
    expect(s.accountReach).toBe(2100)
  })

  it('ignores an insights block that failed instead of reading zeros out of it', () => {
    const s = accountSummary(account('instagram'), dash({ insights: { _error: 'rate limited' } }))
    expect(s.accountViews).toBe(null)
  })
})

describe('combineOverview', () => {
  const ig = accountSummary(account('instagram'), dash({
    overview: {
      posts: [post('instagram', { likes: 100, comments: 20, reach: 2000, views: 3000 })],
      accounts: [{ _id: 'instagram-1', followersCount: 1200 }],
    },
    insights: { metrics: { views: { total: 9000 }, reach: { total: 5000 } } },
  }))
  const li = accountSummary(account('linkedin'), dash({
    overview: {
      posts: [
        post('linkedin', { likes: 5, comments: 1, impressions: 800 }),
        post('linkedin', { likes: 4, comments: 0, impressions: 700 }),
      ],
      accounts: [{ _id: 'linkedin-1', followersCount: 300 }],
    },
    linkedinPage: { metrics: { page_views_total: { total: 120 }, unique_impressions: { total: 900 } } },
  }))

  it('adds followers across platforms', () => {
    expect(combineOverview([ig, li]).followers).toBe(1500)
  })

  it('keeps post views and account-wide views apart', () => {
    const c = combineOverview([ig, li])
    expect(c.postViews).toBe(3000)
    expect(c.accountViews).toBe(9120)
  })

  it('names the most active platform by audience, not by posting volume', () => {
    // LinkedIn posted twice as often; Instagram is where anything happened.
    const c = combineOverview([ig, li])
    expect(c.mostActive.platform).toBe('instagram')
    expect(c.mostActive.posts).toBe(1)
  })

  it('folds two accounts on one platform into one row', () => {
    const second = accountSummary(account('instagram', 'instagram-2'), dash({
      overview: { posts: [post('instagram', { likes: 10, reach: 100 })], accounts: [{ _id: 'instagram-2', followersCount: 50 }] },
    }))
    const c = combineOverview([ig, second])
    expect(c.byPlatform).toHaveLength(1)
    expect(c.byPlatform[0].accounts).toBe(2)
    expect(c.byPlatform[0].posts).toBe(2)
    expect(c.byPlatform[0].followers).toBe(1250)
  })

  it('reports a failed account separately instead of counting it as quiet', () => {
    const broken = accountSummary(account('tiktok'), { error: 'Needs reconnecting.' })
    const c = combineOverview([ig, broken])
    expect(c.errors).toEqual([{ platform: 'tiktok', username: 'tiktok_acct', error: 'Needs reconnecting.' }])
    expect(c.byPlatform.map(p => p.platform)).toEqual(['instagram'])
  })

  it('stays null on followers when nobody has been counted', () => {
    const uncounted = accountSummary(account('tiktok'), dash())
    expect(combineOverview([uncounted]).followers).toBe(null)
  })
})

describe('bucketing', () => {
  it('finds the Monday of a week', () => {
    expect(weekOf('2026-09-17')).toBe('2026-09-14') // a Thursday → its Monday
    expect(weekOf('2026-09-14')).toBe('2026-09-14')
  })

  it('switches to weeks only past the threshold', () => {
    expect(bucketModeFor('2026-08-18', '2026-09-16')).toBe('day')   // 29 days
    expect(bucketModeFor('2026-06-18', '2026-09-16')).toBe('week')  // 90 days
  })

  it('zero-fills every bucket in the range', () => {
    expect(bucketsInRange('2026-09-14', '2026-09-17', 'day'))
      .toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'])
    expect(bucketsInRange('2026-09-01', '2026-09-20', 'week'))
      .toEqual(['2026-08-31', '2026-09-07', '2026-09-14'])
  })
})

describe('platformSeries', () => {
  const daily = (date, metrics) => ({ date, metrics })
  const igS = {
    platform: 'instagram', error: '', metrics: {}, daily: [
      daily('2026-09-14', { views: 100, likes: 10, comments: 0, shares: 0, saves: 0 }),
      daily('2026-09-15', { views: 200, likes: 20, comments: 5, shares: 0, saves: 0 }),
    ],
  }
  const liS = {
    platform: 'linkedin', error: '', metrics: {}, daily: [
      daily('2026-09-15', { views: 50, likes: 1, comments: 1, shares: 1, saves: 0 }),
    ],
  }

  it('gives a column per platform alongside the combined total', () => {
    const { rows } = platformSeries([igS, liS], {
      metric: 'views', fromDate: '2026-09-14', toDate: '2026-09-16',
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ bucket: '2026-09-14', instagram: 100, linkedin: 0, total: 100 })
    expect(rows[1]).toMatchObject({ bucket: '2026-09-15', instagram: 200, linkedin: 50, total: 250 })
    // The zero-filled day is the measurement, not a gap to skip.
    expect(rows[2]).toMatchObject({ bucket: '2026-09-16', total: 0 })
  })

  it('computes interactions, which no platform reports but every platform shares', () => {
    const { rows } = platformSeries([igS, liS], {
      metric: 'interactions', fromDate: '2026-09-14', toDate: '2026-09-15',
    })
    expect(rows[0].total).toBe(10)
    expect(rows[1].total).toBe(25 + 3)
  })

  it('keeps rows that fall outside the scaffold rather than losing them', () => {
    const { rows } = platformSeries([igS], {
      metric: 'views', fromDate: '2026-09-15', toDate: '2026-09-15',
    })
    expect(rows.map(r => r.bucket)).toEqual(['2026-09-14', '2026-09-15'])
  })

  it('leaves a failed account out of the chart', () => {
    const { platforms } = platformSeries([igS, { platform: 'tiktok', error: 'down', daily: [] }], {
      fromDate: '2026-09-14', toDate: '2026-09-15',
    })
    expect(platforms).toEqual(['instagram'])
  })
})

describe('followerChange', () => {
  it('needs two points before it will call anything a change', () => {
    expect(followerChange([{ followerSeries: [{ date: '2026-09-16', followers: 1200 }] }])).toBe(null)
    expect(followerChange([{ followerSeries: [] }])).toBe(null)
  })

  it('adds the movement across accounts', () => {
    const change = followerChange([
      { followerSeries: [{ followers: 1000 }, { followers: 1200 }] },
      { followerSeries: [{ followers: 300 }, { followers: 290 }] },
    ])
    expect(change).toEqual({ from: 1300, to: 1490, delta: 190 })
  })
})

describe('engagementRate', () => {
  it('falls back to impressions where a platform has no reach', () => {
    expect(engagementRate({ likes: 10, impressions: 1000 })).toBeCloseTo(1, 5)
  })
  it('is null rather than zero with nothing to divide by', () => {
    expect(engagementRate({ likes: 10 })).toBe(null)
  })
})

describe('metric support', () => {
  const liOnly = accountSummary(account('linkedin'), dash({
    metricsSupported: ['impressions', 'reach', 'likes', 'comments', 'shares', 'clicks'],
    overview: { posts: [post('linkedin', { likes: 5, impressions: 900 })], accounts: [] },
  }))
  const ig = accountSummary(account('instagram'), dash({
    metricsSupported: ['likes', 'comments', 'shares', 'saves', 'views', 'reach'],
    overview: { posts: [post('instagram', { likes: 10, views: 2000, reach: 1500 })], accounts: [] },
  }))

  it('refuses to report a metric the platform never takes', () => {
    // LinkedIn has no view count on an ordinary post. "0" would read as a
    // quiet month rather than as a measurement nobody made.
    const c = combineOverview([liOnly])
    expect(c.postViews).toBe(null)
    expect(c.postViewPlatforms).toEqual([])
  })

  it('sums only the platforms that do report it, and names them', () => {
    const c = combineOverview([ig, liOnly])
    expect(c.postViews).toBe(2000)
    expect(c.postViewPlatforms).toEqual(['instagram'])
  })

  it('assumes support when the server did not say', () => {
    const unknown = accountSummary(account('tiktok'), dash({
      overview: { posts: [post('tiktok', { views: 400 })], accounts: [] },
    }))
    expect(supportsMetric(unknown, 'views')).toBe(true)
    expect(combineOverview([unknown]).postViews).toBe(400)
  })
})
