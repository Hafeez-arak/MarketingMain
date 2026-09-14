import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Zernio Sync: the analytics half ───────────────────────────────────────
// zernioSync.test.js covers the account mirror and stops at
// hasAnalyticsAccess:false. These cover what happens after it, against the
// shapes Zernio returned live on 2026-09-14 for @lightingaaa's posts.
//
// Three failures, all found in production data rather than in review:
//   • Two posts Zernio had published hours earlier still read "Publishing…",
//     because the status was only reconciled on the no-timeline path — and a
//     live post is precisely the one that has a timeline.
//   • A post Zernio was still fetching (202, syncStatus 'pending') was stored
//     as a metrics row with a BLANK platform. Platform is part of the unique
//     key, so no later sync could overwrite it.
//   • Every refresh wrote followers_count 0 and profile_url '' whenever Zernio
//     sent null for them, which it does until its first daily snapshot.

const ENV = {
  ZERNIO_API_KEY: 'stub-zernio-key',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const SYNC = loadCodeNode('Arak Lighting – Zernio Sync', 'Zernio: Sync')

const WS = '00000000-0000-0000-0000-000000000001'
const PROFILE = '6a93f477bd1e9a40e2928cbc'
const ACCOUNT = '6aa7a97e726ebfe037e8f4ef'

const LIVE_POST = '6aa7ac79064b3c3b3395d4ce'     // published 08:13, has a timeline
const PENDING_POST = '6aa7d0ce504dd4a6f4bea726'  // published minutes ago, still syncing

const ZEROS = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0 }

const LIVE_TIMELINE = [{ date: '2026-09-14', platform: 'instagram', platformPostId: '18078117533415701', ...ZEROS, follows: 0 }]

const LIVE_SINGLE = {
  postId: LIVE_POST, status: 'published', publishedAt: '2026-09-14T08:13:04.488Z',
  platformPostUrl: 'https://www.instagram.com/p/DdQrdjPlStO/', syncStatus: 'synced',
  analytics: ZEROS,
  platformAnalytics: [{ platform: 'instagram', status: 'published', platformPostId: '18078117533415701',
                        accountId: ACCOUNT, analytics: ZEROS, syncStatus: 'synced' }],
}

// Answered with HTTP 202.
const PENDING_SINGLE = {
  postId: PENDING_POST, status: 'published', publishedAt: '2026-09-14T10:50:37.697Z',
  platformPostUrl: null, syncStatus: 'pending',
  message: 'Analytics are being synced from the platform. Please try again in a few moments.',
  analytics: { ...ZEROS, engagementRate: 0, lastUpdated: null },
  platformAnalytics: [{ platform: 'instagram', status: 'published', platformPostId: '18166631029462585',
                        accountId: ACCOUNT, analytics: null, syncStatus: 'pending', platformPostUrl: null }],
}

const post = (over = {}) => ({
  id: 'p1', workspace_id: WS, platform: 'instagram', zernio_post_id: LIVE_POST,
  zernio_account_id: ACCOUNT, publish_status: 'published', ...over,
})

const db = ({ posts = [], accounts = [] } = {}) => new StubPostgrest({
  workspaces: [{ id: WS, name: 'Arak Lighting', zernio_profile_id: PROFILE }],
  social_accounts: accounts,
  generated_posts: posts,
  instagram_generated_posts: [],
  post_analytics: [],
})

// Route order matters: needles are substrings, and the timeline URL must be
// claimed before the single-post one.
function zernio({ accounts = [], timeline = {}, single = {} } = {}) {
  const asked = []
  const idOf = url => new URL(url).searchParams.get('postId')
  const routes = [
    ['/api/v1/analytics/post-timeline', async ({ url }) => {
      asked.push(['timeline', idOf(url)])
      return { statusCode: 200, body: { postId: idOf(url), timeline: timeline[idOf(url)] || [] } }
    }],
    ['/api/v1/analytics?', async ({ url }) => {
      asked.push(['single', idOf(url)])
      const s = single[idOf(url)]
      if (!s) return { statusCode: 404, body: { error: 'Post not found' } }
      return { statusCode: s.syncStatus === 'pending' ? 202 : 200, body: s }
    }],
    ['/api/v1/accounts', async () => ({ statusCode: 200, body: { accounts, hasAnalyticsAccess: true } })],
  ]
  return { routes, asked }
}

const run = (pg, routes) =>
  runCodeNode(SYNC, { env: ENV, input: { body: { workspace_id: WS } }, postgrest: pg, routes })

describe('publish status', () => {
  it('marks a publishing post published even when it already has a timeline', async () => {
    const pg = db({ posts: [post({ publish_status: 'publishing' })] })
    const { routes } = zernio({ timeline: { [LIVE_POST]: LIVE_TIMELINE }, single: { [LIVE_POST]: LIVE_SINGLE } })
    await run(pg, routes)

    const row = pg.tables.generated_posts[0]
    expect(row.publish_status).toBe('published')
    expect(row.published_at).toBe('2026-09-14T08:13:04.488Z')
    expect(row.platform_post_url).toBe('https://www.instagram.com/p/DdQrdjPlStO/')
    expect(pg.tables.post_analytics).toHaveLength(1)
  })

  it('does not ask about a post that is already published', async () => {
    const pg = db({ posts: [post()] })
    const { routes, asked } = zernio({ timeline: { [LIVE_POST]: LIVE_TIMELINE }, single: { [LIVE_POST]: LIVE_SINGLE } })
    await run(pg, routes)
    expect(asked.filter(([kind]) => kind === 'single')).toEqual([])
  })

  it('leaves a post alone while Zernio still has it scheduled', async () => {
    const pg = db({ posts: [post({ publish_status: 'scheduled' })] })
    const { routes } = zernio({ single: { [LIVE_POST]: { ...LIVE_SINGLE, status: 'scheduled', platformAnalytics: [], analytics: {} } } })
    await run(pg, routes)
    expect(pg.tables.generated_posts[0].publish_status).toBe('scheduled')
  })
})

describe('metric rows', () => {
  it('writes nothing for a post Zernio is still syncing', async () => {
    const pg = db({ posts: [post({ zernio_post_id: PENDING_POST, publish_status: 'publishing' })] })
    const { routes } = zernio({ single: { [PENDING_POST]: PENDING_SINGLE } })
    await run(pg, routes)

    expect(pg.tables.post_analytics).toEqual([])
    // It IS live, though, and that part is known.
    expect(pg.tables.generated_posts[0].publish_status).toBe('published')
  })

  it('never stores a blank platform, even from a pending roll-up with no breakdown', async () => {
    const pg = db({ posts: [post({ zernio_post_id: PENDING_POST })] })
    const { routes } = zernio({ single: { [PENDING_POST]: { ...PENDING_SINGLE, platformAnalytics: [] } } })
    await run(pg, routes)
    expect(pg.tables.post_analytics).toEqual([])
  })

  it('takes the platform from the post when a synced roll-up does not name one', async () => {
    const pg = db({ posts: [post({ zernio_post_id: PENDING_POST })] })
    const { routes } = zernio({ single: { [PENDING_POST]: {
      ...LIVE_SINGLE, postId: PENDING_POST, platformAnalytics: [], analytics: { ...ZEROS, likes: 3 },
    } } })
    await run(pg, routes)

    expect(pg.tables.post_analytics).toHaveLength(1)
    expect(pg.tables.post_analytics[0]).toMatchObject({ platform: 'instagram', likes: 3 })
  })

  it('takes the platform from the post when a timeline day does not name one', async () => {
    const pg = db({ posts: [post()] })
    const day = { ...LIVE_TIMELINE[0], likes: 2 }
    delete day.platform
    const { routes } = zernio({ timeline: { [LIVE_POST]: [day] } })
    await run(pg, routes)
    expect(pg.tables.post_analytics[0]).toMatchObject({ platform: 'instagram', metric_date: '2026-09-14', likes: 2 })
  })
})

describe('account mirror fields Zernio leaves null', () => {
  const existing = () => [{
    workspace_id: WS, zernio_account_id: ACCOUNT, platform: 'instagram', username: 'lightingaaa',
    followers_count: 848, profile_url: 'https://www.instagram.com/lightingaaa/',
  }]
  const zAccount = over => ({
    _id: ACCOUNT, platform: 'instagram', username: 'lightingaaa', displayName: 'Lighting Arak',
    isActive: true, profileId: { _id: PROFILE, name: `arak_ws_${WS}` }, ...over,
  })

  it('keeps the stored follower count and profile URL when Zernio sends null', async () => {
    const pg = db({ accounts: existing() })
    const { routes } = zernio({ accounts: [zAccount({ followersCount: null, profileUrl: null })] })
    await run(pg, routes)
    expect(pg.tables.social_accounts[0]).toMatchObject({
      followers_count: 848, profile_url: 'https://www.instagram.com/lightingaaa/',
    })
  })

  it('writes a follower count Zernio did report, zero included', async () => {
    const pg = db({ accounts: existing() })
    const { routes } = zernio({ accounts: [zAccount({ followersCount: 0 })] })
    await run(pg, routes)
    expect(pg.tables.social_accounts[0].followers_count).toBe(0)
  })
})
