import { describe, it, expect } from 'vitest'
import {
  engagementIn, postsIn, undatedIn, analyticsByPost, windowStats, stateOf,
  changeFor, ownChannels, ownChannelFindings, priorPeriod, externalRows, plainTopic, lastPostAt,
  WEAK_SAMPLE, MIN_FOR_CHANGE, CHANGE_FLOOR,
} from './ownChannels.js'

// A fixed week, so nothing here depends on when the suite runs.
const PERIOD = { start: '2026-09-06T00:00:00.000Z', end: '2026-09-13T00:00:00.000Z', days: 7 }
const PRIOR = { start: '2026-08-30T00:00:00.000Z', end: '2026-09-06T00:00:00.000Z', days: 7 }

const post = (id, platform, published_at, extra = {}) =>
  ({ id, platform, published_at, ...extra })

const metric = (post_id, likes, rest = {}) =>
  ({ post_id, likes, comments: 0, shares: 0, saves: 0, ...rest })

describe('engagementIn', () => {
  it('is null with no rows at all — not zero', () => {
    // The distinction the whole module rests on: "unsynced" must not average
    // in as "nobody cared".
    expect(engagementIn([])).toBeNull()
    expect(engagementIn(undefined)).toBeNull()
  })

  it('is zero when a row exists and every metric is genuinely zero', () => {
    expect(engagementIn([metric('p', 0)])).toBe(0)
  })

  it('sums interactions, not reach', () => {
    expect(engagementIn([metric('p', 10, { comments: 3, shares: 2, saves: 1, reach: 9999 })]))
      .toBe(16)
  })

  it('takes the newest snapshot rather than summing the daily rows', () => {
    // THE BUG THIS TEST EXISTS FOR. post_analytics re-syncs daily and each row
    // is a CUMULATIVE total, not that day's delta. Summing counted the same
    // like once per sync: Arak's one published post (2 likes, 1 comment) read
    // as 42 interactions across fourteen identical snapshots.
    const rows = [
      metric('p', 7, { metric_date: '2026-09-03' }),
      metric('p', 7, { metric_date: '2026-09-02' }),
      metric('p', 5, { metric_date: '2026-09-01' }),
    ]
    expect(engagementIn(rows)).toBe(7)
  })

  it('is null when a row exists but every metric is still unset', () => {
    // The sync inserts the row before the platform returns figures. That is
    // not a post that scored zero, and counting it as measured would drag the
    // channel average down with a number nobody reported.
    expect(engagementIn([{ post_id: 'p', metric_date: '2026-09-01' }])).toBeNull()
  })
})

describe('postsIn', () => {
  it('keeps only what went out inside the window', () => {
    const posts = [
      post('a', 'instagram', '2026-09-07T10:00:00Z'),
      post('b', 'instagram', '2026-09-01T10:00:00Z'),
      post('c', 'instagram', '2026-09-20T10:00:00Z'),
    ]
    expect(postsIn(posts, PERIOD).map(p => p.id)).toEqual(['a'])
  })

  it('falls back to scheduled_date only when there is no published_at', () => {
    const posts = [{ id: 'a', platform: 'tiktok', scheduled_date: '2026-09-08T00:00:00Z' }]
    expect(postsIn(posts, PERIOD)).toHaveLength(1)
  })

  it('uses published_at over scheduled_date, so a slipped post lands in the week it ran', () => {
    const posts = [post('a', 'tiktok', '2026-09-07T00:00:00Z', { scheduled_date: '2026-08-31T00:00:00Z' })]
    expect(postsIn(posts, PERIOD)).toHaveLength(1)
    expect(postsIn(posts, PRIOR)).toHaveLength(0)
  })

  it('drops a post with no usable date rather than guessing', () => {
    expect(postsIn([{ id: 'a', platform: 'tiktok' }], PERIOD)).toHaveLength(0)
  })

  it('returns nothing for a malformed period instead of everything', () => {
    expect(postsIn([post('a', 'tiktok', '2026-09-07T00:00:00Z')], { start: 'x', end: 'y' })).toEqual([])
  })
})

describe('windowStats', () => {
  it('counts published and measured separately', () => {
    const posts = [post('a', 'tiktok', '2026-09-07T00:00:00Z'), post('b', 'tiktok', '2026-09-08T00:00:00Z')]
    const by = analyticsByPost([metric('a', 10)])
    const s = windowStats(posts, by)
    expect(s.posts).toBe(2)
    expect(s.measured).toBe(1)
  })

  it('averages over measured posts only, never over published ones', () => {
    // Six posts, two measured at 10 and 20 → 15. Dividing by six would report
    // 5 and understate the channel by two thirds.
    const posts = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      post(id, 'linkedin', `2026-09-0${7 + (i % 3)}T00:00:00Z`))
    const by = analyticsByPost([metric('a', 10), metric('b', 20)])
    expect(windowStats(posts, by).avg_engagement).toBe(15)
  })

  it('has a null average, not zero, when nothing is measured', () => {
    const s = windowStats([post('a', 'tiktok', '2026-09-07T00:00:00Z')], {})
    expect(s.avg_engagement).toBeNull()
    expect(s.total_engagement).toBeNull()
  })

  it('names the best post by engagement', () => {
    const posts = [post('a', 'tiktok', '2026-09-07T00:00:00Z', { topic: 'low' }),
                   post('b', 'tiktok', '2026-09-08T00:00:00Z', { topic: 'high' })]
    const by = analyticsByPost([metric('a', 5), metric('b', 50)])
    expect(windowStats(posts, by).best_post.topic).toBe('high')
  })
})

describe('stateOf', () => {
  it('separates the four situations a dark channel can be in', () => {
    expect(stateOf({ connected: false, posts: 0, measured: 0 })).toBe('not_connected')
    expect(stateOf({ connected: true, posts: 0, measured: 0 })).toBe('silent')
    expect(stateOf({ connected: true, posts: 3, measured: 0 })).toBe('unmeasured')
    expect(stateOf({ connected: true, posts: 3, measured: 2 })).toBe('measured')
  })
})

describe('changeFor', () => {
  const stat = (avg, measured) => ({ avg_engagement: avg, measured })

  it('refuses a change when either side is below the sample floor', () => {
    expect(changeFor(stat(100, 1), stat(10, 5))).toBeNull()
    expect(changeFor(stat(100, 5), stat(10, 1))).toBeNull()
    expect(MIN_FOR_CHANGE).toBe(2)
  })

  it('reports a real rise once both sides clear the floor', () => {
    const c = changeFor(stat(20, 3), stat(10, 3))
    expect(c.direction).toBe('up')
    expect(c.change_pct).toBe(100)
    expect(c.significance).toBe('high')
  })

  it('swallows a wobble below the noise floor', () => {
    expect(changeFor(stat(10.5, 4), stat(10, 4))).toBeNull()
    expect(CHANGE_FLOOR).toBe(0.15)
  })

  it('is null — not a collapse — when this period has no measurement', () => {
    // The failure this mirrors: treating an unknown as zero and announcing a
    // crash that never happened.
    expect(changeFor(stat(null, 0), stat(40, 6))).toBeNull()
  })

  it('grades significance', () => {
    // Bands are 15–25% low, 25–50% medium, 50%+ high — the same thresholds
    // the competitor movements already use, so one reader learns one scale.
    expect(changeFor(stat(12, 3), stat(10, 3)).significance).toBe('low')
    expect(changeFor(stat(13, 3), stat(10, 3)).significance).toBe('medium')
    expect(changeFor(stat(16, 3), stat(10, 3)).significance).toBe('high')
  })
})

describe('priorPeriod', () => {
  it('is the same length as the period it precedes', () => {
    const p = priorPeriod(PERIOD)
    expect(p.start).toBe(PRIOR.start)
    expect(p.end).toBe(PRIOR.end)
    // Same span, or a rise in days reads as a rise in posting.
    expect(Date.parse(p.end) - Date.parse(p.start)).toBe(Date.parse(PERIOD.end) - Date.parse(PERIOD.start))
  })

  it('is null for a nonsense period rather than a negative window', () => {
    expect(priorPeriod({ start: '2026-09-13T00:00:00Z', end: '2026-09-06T00:00:00Z' })).toBeNull()
    expect(priorPeriod(null)).toBeNull()
  })
})

describe('ownChannels', () => {
  const accounts = [
    { platform: 'instagram', username: 'arak', is_active: true, followers_count: 1200 },
    { platform: 'tiktok', username: 'arak_tt', is_active: true, followers_count: 800 },
  ]

  it('reports every live platform, including the ones with no account', () => {
    // A dark channel is a marketing fact. Omitting LinkedIn here would make
    // "we never post there" look identical to "LinkedIn went fine".
    const out = ownChannels({ accounts, posts: [], analytics: [], period: PERIOD, prior: PRIOR })
    expect(out.platforms.map(p => p.platform)).toEqual(['instagram', 'tiktok', 'linkedin'])
    const li = out.platforms.find(p => p.platform === 'linkedin')
    expect(li.state).toBe('not_connected')
    expect(li.note).toContain('LinkedIn')
  })

  it('does not include a beta platform nobody can publish to', () => {
    const out = ownChannels({ accounts, posts: [], period: PERIOD })
    expect(out.platforms.map(p => p.platform)).not.toContain('snapchat')
  })

  it('measures TikTok and LinkedIn exactly as it measures Instagram', () => {
    // The whole point of the change: no platform gets special treatment.
    const withLi = [...accounts, { platform: 'linkedin', username: 'arak-li', is_active: true }]
    const posts = [
      post('i1', 'instagram', '2026-09-07T00:00:00Z'),
      post('t1', 'tiktok', '2026-09-07T00:00:00Z'),
      post('l1', 'linkedin', '2026-09-07T00:00:00Z'),
    ]
    const analytics = [metric('i1', 30), metric('t1', 60), metric('l1', 90)]
    const out = ownChannels({ accounts: withLi, posts, analytics, period: PERIOD, prior: PRIOR })
    const by = Object.fromEntries(out.platforms.map(p => [p.platform, p]))
    expect(by.instagram.avg_engagement).toBe(30)
    expect(by.tiktok.avg_engagement).toBe(60)
    expect(by.linkedin.avg_engagement).toBe(90)
    expect(out.measured_count).toBe(3)
  })

  it('keeps each platform\'s posts out of the others\' averages', () => {
    const posts = [
      post('i1', 'instagram', '2026-09-07T00:00:00Z'),
      post('t1', 'tiktok', '2026-09-07T00:00:00Z'),
    ]
    const analytics = [metric('i1', 100), metric('t1', 2)]
    const out = ownChannels({ accounts, posts, analytics, period: PERIOD })
    const by = Object.fromEntries(out.platforms.map(p => [p.platform, p]))
    expect(by.instagram.avg_engagement).toBe(100)
    expect(by.tiktok.avg_engagement).toBe(2)
  })

  it('computes week over week per platform', () => {
    const posts = [
      post('t1', 'tiktok', '2026-09-07T00:00:00Z'),
      post('t2', 'tiktok', '2026-09-08T00:00:00Z'),
      post('t3', 'tiktok', '2026-08-31T00:00:00Z'),
      post('t4', 'tiktok', '2026-09-01T00:00:00Z'),
    ]
    const analytics = [metric('t1', 20), metric('t2', 20), metric('t3', 10), metric('t4', 10)]
    const out = ownChannels({ accounts, posts, analytics, period: PERIOD, prior: PRIOR })
    const tt = out.platforms.find(p => p.platform === 'tiktok')
    expect(tt.avg_engagement).toBe(20)
    expect(tt.avg_engagement_prev).toBe(10)
    expect(tt.change.direction).toBe('up')
    expect(tt.change.change_pct).toBe(100)
  })

  it('flags a thin sample rather than hiding it', () => {
    const posts = [post('t1', 'tiktok', '2026-09-07T00:00:00Z')]
    const out = ownChannels({ accounts, posts, analytics: [metric('t1', 10)], period: PERIOD })
    const tt = out.platforms.find(p => p.platform === 'tiktok')
    expect(tt.weak).toBe(true)
    expect(tt.avg_engagement).toBe(10)
    expect(WEAK_SAMPLE).toBe(5)
  })

  it('tells a connected-but-silent channel apart from a posted-but-unsynced one', () => {
    const posts = [post('t1', 'tiktok', '2026-09-07T00:00:00Z')]
    const out = ownChannels({ accounts, posts, analytics: [], period: PERIOD })
    const by = Object.fromEntries(out.platforms.map(p => [p.platform, p]))
    expect(by.instagram.state).toBe('silent')
    expect(by.tiktok.state).toBe('unmeasured')
    expect(by.tiktok.note).toContain('analytics')
  })

  it('ignores a deactivated account', () => {
    const out = ownChannels({
      accounts: [{ platform: 'tiktok', username: 'old', is_active: false }],
      period: PERIOD,
    })
    expect(out.platforms.find(p => p.platform === 'tiktok').connected).toBe(false)
    expect(out.connected_count).toBe(0)
  })

  it('carries the reconnection flag through, because a stale account explains a zero', () => {
    const out = ownChannels({
      accounts: [{ platform: 'linkedin', username: 'x', is_active: true, needs_reconnection: true }],
      period: PERIOD,
    })
    expect(out.platforms.find(p => p.platform === 'linkedin').needs_reconnection).toBe(true)
  })

  it('says plainly when nothing is connected at all', () => {
    const out = ownChannels({ accounts: [], period: PERIOD })
    expect(out.connected_count).toBe(0)
    expect(out.note).toContain('No social account is connected')
  })

  it('says plainly when accounts exist but nothing is synced', () => {
    const out = ownChannels({ accounts, posts: [], period: PERIOD })
    expect(out.note).toContain('no post in this period has analytics synced')
  })

  it('survives being called with nothing', () => {
    // Stage 0 must never take a run down; an empty workspace is the common case.
    expect(() => ownChannels()).not.toThrow()
    expect(ownChannels().platforms).toHaveLength(3)
  })
})

// ─── The post that is neither published nor not ────────────────────────────
//
// Live on 2026-09-14: this workspace's one published Instagram post carries
// status "published", publish_status "publishing", and NULL for both
// published_at and scheduled_date. It belongs to no week, so every window
// misses it and the channel reported `silent` — "nothing went out on Instagram
// this period", said about a post that was going out at that moment.

describe('undatedIn', () => {
  const inFlight = { id: 'p1', platform: 'instagram', published_at: null, scheduled_date: null }

  it('finds a post carrying no usable date at all', () => {
    expect(undatedIn([inFlight])).toHaveLength(1)
  })

  it('ignores a post that has either date', () => {
    expect(undatedIn([post('a', 'instagram', '2026-09-07T00:00:00Z')])).toHaveLength(0)
    expect(undatedIn([{ id: 'b', scheduled_date: '2026-09-07' }])).toHaveLength(0)
  })

  it('treats an unparseable date as no date, not as a date', () => {
    expect(undatedIn([{ id: 'c', published_at: 'soon', scheduled_date: '' }])).toHaveLength(1)
  })
})

describe('ownChannels with a post mid-publish', () => {
  const accounts = [{ platform: 'instagram', username: 'lightingaaa', is_active: true, followers_count: 0 }]
  const inFlight = [{
    id: '30ee4311', platform: 'instagram', status: 'published',
    publish_status: 'publishing', published_at: null, scheduled_date: null,
    zernio_post_id: '6aa7ac79064b3c3b3395d4ce',
  }]

  it('counts it as undated rather than losing it', () => {
    const out = ownChannels({ accounts, posts: inFlight, analytics: [], period: PERIOD, prior: PRIOR })
    const ig = out.platforms.find(p => p.platform === 'instagram')
    expect(ig.posts).toBe(0)
    expect(ig.undated).toBe(1)
  })

  it('does NOT claim nothing went out', () => {
    const out = ownChannels({ accounts, posts: inFlight, analytics: [], period: PERIOD, prior: PRIOR })
    const ig = out.platforms.find(p => p.platform === 'instagram')
    expect(ig.note).toContain('mid-publish')
    expect(ig.note).not.toContain('published no posts')
  })

  it('still says nothing went out when nothing did', () => {
    const out = ownChannels({ accounts, posts: [], analytics: [], period: PERIOD, prior: PRIOR })
    const ig = out.platforms.find(p => p.platform === 'instagram')
    expect(ig.undated).toBe(0)
    expect(ig.note).toContain('nothing was published')
  })

  it('reports it as in-flight rather than as a quiet week', () => {
    const out = ownChannels({ accounts, posts: inFlight, analytics: [], period: PERIOD, prior: PRIOR })
    const findings = ownChannelFindings(out)
    const ig = findings.filter(f => f.evidence?.platform === 'instagram')
    expect(ig).toHaveLength(1)
    expect(ig[0].headline).toContain('mid-publish')
    expect(ig[0].evidence.undated).toBe(1)
  })
})

// ─── Posts made directly on the platform ───────────────────────────────────
//
// Live on 2026-09-14: ARAK Lighting's LinkedIn page had two posts Zernio
// measured, neither made through this app. The run read only our own tables,
// so it saw a connected page with nothing on it.

describe('externalRows', () => {
  const direct = {
    zernio_post_id: '', origin: 'posted_directly_on_platform', platform: 'linkedin',
    platform_post_id: 'urn:li:ugcPost:7501272770023120896',
    platform_post_url: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:7501272770023120896',
    published_at: '2026-09-08T13:39:55.522Z', content: 'We signed an MoU with TAWAL\nSecond line',
    likes: 15, comments: 0, shares: 2, saves: null, reach: 516, impressions: 1027, views: null, clicks: 186,
    last_updated: '2026-09-14 13:13:07', media_type: 'image',
  }
  const viaApp = { ...direct, zernio_post_id: '6aa7d0ce504dd4a6f4bea726', origin: 'published_by_this_app', platform_post_id: 'x' }

  it('turns a directly-made post into a post row and one analytics row', () => {
    const { posts, analytics } = externalRows([direct])
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ platform: 'linkedin', origin: 'external', topic: 'We signed an MoU with TAWAL', format: 'image' })
    expect(analytics[0]).toMatchObject({ post_id: posts[0].id, likes: 15, shares: 2, saves: null, clicks: 186, metric_date: '2026-09-14' })
  })

  it('skips a post the app published, which our own tables already count', () => {
    expect(externalRows([viaApp]).posts).toHaveLength(0)
  })

  it('takes the same platform post once', () => {
    expect(externalRows([direct, direct]).posts).toHaveLength(1)
  })
})

describe('ownChannels with posts made directly on LinkedIn', () => {
  const accounts = [{ platform: 'linkedin', username: 'ARAK Lighting', is_active: true, followers_count: 4779 }]
  const direct = (id, published_at, likes) => ({
    zernio_post_id: '', origin: 'posted_directly_on_platform', platform: 'linkedin',
    platform_post_id: id, published_at, content: `Post ${id}`, likes, comments: 0, shares: 0, saves: null,
    last_updated: '2026-09-14',
  })

  it('measures them, so a page that posted is not reported as silent', () => {
    const out = ownChannels({ accounts, period: PERIOD, prior: PRIOR, external: [direct('a', '2026-09-08T10:00:00Z', 20)] })
    const li = out.platforms.find(p => p.platform === 'linkedin')
    expect(li.state).toBe('measured')
    expect(li.posts).toBe(1)
    expect(li.posted_directly).toBe(1)
    expect(li.avg_engagement).toBe(20)
  })

  it('ignores a null save instead of counting it as zero', () => {
    const out = ownChannels({ accounts, period: PERIOD, external: [direct('a', '2026-09-08T10:00:00Z', 20)] })
    expect(out.platforms.find(p => p.platform === 'linkedin').avg_engagement).toBe(20)
  })

  it('says when the last post went out on a quiet week', () => {
    const out = ownChannels({ accounts, period: PERIOD, prior: PRIOR, external: [direct('old', '2026-06-24T08:46:39Z', 21)] })
    const li = out.platforms.find(p => p.platform === 'linkedin')
    expect(li.state).toBe('silent')
    expect(li.last_post_at).toBe('2026-06-24T08:46:39.000Z')
    expect(li.note).toContain('nothing was published')
    expect(li.note).toContain('2026-06-24')
    const silent = ownChannelFindings(out).find(f => f.evidence?.platform === 'linkedin' && f.evidence?.state === 'silent')
    expect(silent.detail).toContain('2026-06-24')
  })

  it('does not count posts from a platform with no connected account', () => {
    const out = ownChannels({ accounts: [], period: PERIOD, external: [direct('a', '2026-09-08T10:00:00Z', 20)] })
    const li = out.platforms.find(p => p.platform === 'linkedin')
    expect(li.state).toBe('not_connected')
    expect(li.posts).toBe(0)
  })

  it('adds up app posts and directly-made posts together', () => {
    const posts = [post('app1', 'linkedin', '2026-09-07T00:00:00Z')]
    const analytics = [metric('app1', 10)]
    const out = ownChannels({ accounts, posts, analytics, period: PERIOD, external: [direct('a', '2026-09-08T10:00:00Z', 30)] })
    const li = out.platforms.find(p => p.platform === 'linkedin')
    expect(li.posts).toBe(2)
    expect(li.posted_directly).toBe(1)
    expect(li.avg_engagement).toBe(20)
  })
})

describe('ownChannelFindings with LinkedIn page totals', () => {
  const accounts = [{ platform: 'linkedin', username: 'ARAK Lighting', is_active: true }]
  const page = {
    ok: true, window: { since: '2026-09-07', until: '2026-09-14', days: 7 },
    impressions: 2351, members_reached: 662, clicks: 229, reactions: 58, comments: 0, reposts: 0,
    engagement_rate_pct: 7.3, followers_gained_organic: 54, page_views: { total: 46 },
    data_delay: 'LinkedIn organization stats may be delayed up to 48 hours.',
  }

  it('reports the page totals, even in a week with no post', () => {
    const out = ownChannels({ accounts, period: PERIOD, pageInsights: { linkedin: page } })
    const li = out.platforms.find(p => p.platform === 'linkedin')
    expect(li.page_insights).toBe(page)
    const f = ownChannelFindings(out).find(x => x.evidence?.kind === 'page_insights')
    expect(f.headline).toBe('Our LinkedIn page: 2,351 impressions, 229 clicks and 54 new followers over the last 7 days.')
    expect(f.detail).toContain('662 members reached')
    expect(f.detail).toContain('48 hours')
  })

  it('says nothing about page totals it could not read', () => {
    const out = ownChannels({ accounts, period: PERIOD, pageInsights: { linkedin: { ok: false, error: '412' } } })
    expect(ownChannelFindings(out).some(x => x.evidence?.kind === 'page_insights')).toBe(false)
  })

  it('never reports page totals for a platform that is not connected', () => {
    const out = ownChannels({ accounts: [], period: PERIOD, pageInsights: { linkedin: page } })
    expect(ownChannelFindings(out).some(x => x.evidence?.kind === 'page_insights')).toBe(false)
  })
})

describe('plainTopic', () => {
  it('reads LinkedIn mentions and escapes as plain words', () => {
    const raw = 'We are pleased to announce an MoU \\(MoU\\) with @[TAWAL](urn:li:organization:14784924) today.\nMore'
    expect(plainTopic(raw)).toBe('We are pleased to announce an MoU (MoU) with TAWAL today.')
  })
})

describe('lastPostAt', () => {
  it('ignores a post scheduled after the period, which has not gone out', () => {
    const posts = [
      { published_at: '2026-09-03T13:39:55Z' },
      { published_at: null, scheduled_date: '2026-10-16' },
    ]
    expect(lastPostAt(posts, '2026-09-14T00:00:00Z')).toBe('2026-09-03T13:39:55.000Z')
  })
  it('is null with nothing dated', () => {
    expect(lastPostAt([{ published_at: null }], '2026-09-14T00:00:00Z')).toBeNull()
  })
})

describe('best post on a channel made directly on the platform', () => {
  it('says so in the right number', () => {
    const accounts = [{ platform: 'linkedin', username: 'ARAK Lighting', is_active: true }]
    const external = [{
      zernio_post_id: '', platform: 'linkedin', platform_post_id: 'a', published_at: '2026-09-08T10:00:00Z',
      content: 'Post a', likes: 20, comments: 0, shares: 0, saves: null, last_updated: '2026-09-14',
    }]
    const out = ownChannels({ accounts, period: PERIOD, external })
    const best = ownChannelFindings(out).find(f => f.headline.startsWith('Best LinkedIn post'))
    expect(best.detail).toContain('1 of this period\'s 1 LinkedIn post was made directly on LinkedIn')
  })
})
