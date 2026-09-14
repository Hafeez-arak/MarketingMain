import { describe, it, expect } from 'vitest'
import { accountInsights, followerStats, postAnalytics, linkedinPageInsights } from './_zernioLive.js'

// ─── Shapes pinned from the live API, 2026-09-14 ───────────────────────────
//
// A fake `z` rather than a network call: these tests are about how Zernio's
// answers are INTERPRETED, and every interpretation here was wrong once.

const zOf = handler => ({ request: async (path, opts) => handler(path, opts) })

describe('followerStats', () => {
  it('reports null and measured:false when no snapshot has been taken', () => {
    // The live shape the day the account was connected. `currentFollowers: 0`
    // next to `dataPoints: 0` is a default over an empty series — reporting it
    // as "0 followers" is the exact lie this flag exists to prevent.
    const z = zOf(async () => ({
      accounts: [{ _id: 'a1', platform: 'instagram', username: 'lightingaaa',
        currentFollowers: 0, growth: 0, growthPercentage: 0, dataPoints: 0 }],
    }))
    return followerStats(z, 'p1').then(out => {
      expect(out.ok).toBe(true)
      expect(out.accounts[0].followers).toBeNull()
      expect(out.accounts[0].measured).toBe(false)
      expect(out.accounts[0].note).toMatch(/No follower snapshot has been captured/i)
    })
  })

  it('reports a real zero once something HAS been observed', async () => {
    // An account genuinely at zero followers, with snapshots behind it, is
    // measured — and must not be confused with the case above.
    const z = zOf(async () => ({
      accounts: [{ _id: 'a1', currentFollowers: 0, growth: 0, dataPoints: 12 }],
    }))
    const out = await followerStats(z, 'p1')
    expect(out.accounts[0].followers).toBe(0)
    expect(out.accounts[0].measured).toBe(true)
    expect(out.accounts[0].note).toBe('')
  })

  it('passes a real count through', async () => {
    const z = zOf(async () => ({
      accounts: [{ _id: 'a1', currentFollowers: 17233, growth: 40, growthPercentage: 0.2, dataPoints: 30 }],
    }))
    const out = await followerStats(z, 'p1')
    expect(out.accounts[0].followers).toBe(17233)
    expect(out.accounts[0].growth).toBe(40)
  })

  it('returns an error rather than throwing', async () => {
    const z = zOf(async () => { throw new Error('upstream exploded') })
    const out = await followerStats(z, 'p1')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/exploded/)
  })
})

describe('accountInsights', () => {
  it('never asks for a window wider than 29 days', async () => {
    // 30 is the documented limit but fails in practice: `until` is a date, so
    // it expands to the END of that day and a nominal 30 becomes 30d 23:59:59.
    // Meta rejects the WHOLE request, so one day too many returns nothing.
    let seen = null
    const z = zOf(async (_p, opts) => { seen = opts.query; return { metrics: {} } })
    await accountInsights(z, 'acct', 365)
    const span = (Date.parse(seen.until) - Date.parse(seen.since)) / 86_400_000
    expect(span).toBeLessThanOrEqual(29)
  })

  it('does not request follower_count, which this endpoint rejects', async () => {
    // Zernio's own error lists the valid metrics; follower_count is not one.
    // Followers come from follower-stats, a different pipeline.
    let seen = null
    const z = zOf(async (_p, opts) => { seen = opts.query; return { metrics: {} } })
    await accountInsights(z, 'acct')
    expect(JSON.stringify(seen)).not.toMatch(/follower_count/)
  })

  it('unwraps the total out of each metric', async () => {
    const z = zOf(async () => ({
      metrics: { reach: { total: 2 }, views: { total: 10 }, total_interactions: { total: 1 } },
      dataDelay: 'Data may be delayed up to 48 hours',
    }))
    const out = await accountInsights(z, 'acct')
    expect(out.reach).toBe(2)
    expect(out.views).toBe(10)
    expect(out.data_delay).toMatch(/48 hours/)
  })

  it('returns null for a metric the platform did not send', async () => {
    const z = zOf(async () => ({ metrics: { reach: { total: 2 } } }))
    const out = await accountInsights(z, 'acct')
    expect(out.views).toBeNull()
  })
})

describe('postAnalytics', () => {
  const live = {
    overview: { totalPosts: 9, publishedPosts: 9, lastSync: '2026-09-14T10:34:08.157Z' },
    posts: [
      { latePostId: '6aa7c6bd51e2d6e255e6df60', content: 'bvvv', publishedAt: '2026-09-14T10:05:21.000Z',
        status: 'published', analytics: { likes: 0, reach: 0, impressions: 0 },
        platforms: [{ platform: 'instagram', platformPostId: '18477101215117064' }] },
      { latePostId: null, content: 'قطعة جديدة', publishedAt: '2026-08-09T08:58:00.000Z',
        status: 'published', analytics: { likes: 2, reach: 1, impressions: 7 },
        platforms: [{ platform: 'instagram', platformPostId: '17870840466632904' }] },
    ],
  }

  it('labels a post with no latePostId as posted directly on the platform', async () => {
    // The seven posts our sync has never written down. They are real history,
    // not missing data, and the label is what stops them being reported as a
    // gap.
    const out = await postAnalytics(zOf(async () => live), 'p1')
    expect(out.posts[1].origin).toBe('posted_directly_on_platform')
    expect(out.posts[1].likes).toBe(2)
  })

  it('carries the post link and media type, so a best post can be opened', async () => {
    const z = zOf(async () => ({ posts: [{
      latePostId: null, platform: 'linkedin', mediaType: 'text',
      platformPostUrl: 'https://www.linkedin.com/feed/update/urn:li:share:7475469427937947649',
      analytics: { likes: 17 },
    }] }))
    const { posts } = await postAnalytics(z, 'p1')
    expect(posts[0].platform_post_url).toBe('https://www.linkedin.com/feed/update/urn:li:share:7475469427937947649')
    expect(posts[0].media_type).toBe('text')
  })

  it('labels a post we published through the app', async () => {
    const out = await postAnalytics(zOf(async () => live), 'p1')
    expect(out.posts[0].origin).toBe('published_by_this_app')
    expect(out.posts[0].zernio_post_id).toBe('6aa7c6bd51e2d6e255e6df60')
  })

  it('carries the overview totals through', async () => {
    const out = await postAnalytics(zOf(async () => live), 'p1')
    expect(out.total).toBe(9)
    expect(out.published).toBe(9)
  })

  it('survives an empty answer', async () => {
    const out = await postAnalytics(zOf(async () => ({})), 'p1')
    expect(out.ok).toBe(true)
    expect(out.posts).toEqual([])
  })
})

// ─── LinkedIn, measured live on the ARAK Lighting page, 2026-09-14 ─────────
const LIVE_PAGE_TOTALS = {
  success: true, accountId: '6aa7f2b1726ebfe037ea7013', platform: 'linkedin', metricType: 'total_value',
  metrics: {
    impressions: { total: 2353 }, unique_impressions: { total: 664 }, clicks: { total: 229 },
    likes: { total: 58 }, comments: { total: 0 }, shares: { total: 0 },
    engagement_rate: { total: 0.07058338717516317 },
    organic_followers_gained: { total: 56 }, paid_followers_gained: { total: 0 },
    page_views_total: { total: 2 }, page_views_overview: { total: 1 }, page_views_careers: { total: 1 },
    page_views_jobs: { total: 1 }, page_views_life: { total: 0 },
  },
  dataDelay: 'LinkedIn organization stats may be delayed up to 48 hours.',
}
const ARAK_PAGE = {
  zernio_account_id: '6aa7f2b1726ebfe037ea7013', platform: 'linkedin',
  display_name: 'ARAK Lighting', account_type: 'organization',
}

describe('linkedinPageInsights', () => {
  it('reads the page totals, with engagement as a percentage', async () => {
    let asked = null
    const z = zOf(async (path, opts) => { asked = { path, query: opts.query }; return LIVE_PAGE_TOTALS })
    const out = await linkedinPageInsights(z, ARAK_PAGE, 30)
    expect(asked.path).toBe('analytics/linkedin/org-aggregate-analytics')
    expect(asked.query).toMatchObject({ accountId: '6aa7f2b1726ebfe037ea7013', metricType: 'total_value' })
    expect(out).toMatchObject({
      ok: true, name: 'ARAK Lighting', impressions: 2353, members_reached: 664, clicks: 229,
      reactions: 58, engagement_rate_pct: 7.06, followers_gained_organic: 56,
    })
    expect(out.page_views.total).toBe(2)
    expect(out.data_delay).toMatch(/48 hours/)
  })

  it('never asks for more than 88 days', async () => {
    let query = null
    const z = zOf(async (path, opts) => { query = opts.query; return LIVE_PAGE_TOTALS })
    const out = await linkedinPageInsights(z, ARAK_PAGE, 365)
    const span = (Date.parse(query.until) - Date.parse(query.since)) / 86_400_000
    expect(span).toBe(88)
    expect(out.window.days).toBe(88)
  })

  it('does not ask about a personal profile', async () => {
    let called = false
    const z = zOf(async () => { called = true; return LIVE_PAGE_TOTALS })
    const out = await linkedinPageInsights(z, { ...ARAK_PAGE, account_type: 'personal' }, 30)
    expect(called).toBe(false)
    expect(out.ok).toBe(false)
  })

  it('returns an error rather than throwing', async () => {
    const z = zOf(async () => { throw new Error('upstream exploded') })
    const out = await linkedinPageInsights(z, ARAK_PAGE, 30)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/exploded/)
  })
})

describe('postAnalytics on a LinkedIn post', () => {
  it('passes views and saves on as null, and carries clicks', async () => {
    const z = zOf(async () => ({
      overview: { totalPosts: 1 },
      posts: [{
        latePostId: null, publishedAt: '2026-09-03T13:39:55.522Z', status: 'published',
        platforms: [{ platform: 'linkedin', platformPostId: 'urn:li:ugcPost:7501272770023120896' }],
        analytics: { impressions: 1027, reach: 516, likes: 15, comments: 0, shares: 2, saves: 0, clicks: 186, views: 0 },
      }],
    }))
    const { posts } = await postAnalytics(z, 'p1')
    expect(posts[0]).toMatchObject({ platform: 'linkedin', impressions: 1027, clicks: 186, comments: 0, views: null, saves: null })
  })
})
