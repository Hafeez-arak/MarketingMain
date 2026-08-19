import { describe, it, expect } from 'vitest'
import {
  loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE, formBody,
} from './workflowHarness'

// ─── Meta Graph API workflows ──────────────────────────────────────────────
// Exercises the real generated Code nodes with Instagram stubbed, so these run
// anywhere and stay deterministic. They were written against the live API
// first (test account @lightingaaa, 2026-08-19) and the stub reproduces what it
// actually returned — including the behaviour that motivates half this code:
// `POST /media` hands back an id for media Meta will later refuse, so the id
// is an acknowledgement and only `status_code` is an answer.

const IG_USER = '17841436113014751'
const ENV = {
  META_IG_TOKEN: 'stub-token',
  META_IG_USER_ID: IG_USER,
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const PUBLISH = loadCodeNode('Arak Lighting – Publish Post (Meta)', 'Meta: Publish')
const SYNC    = loadCodeNode('Arak Lighting – Meta Insights Sync', 'Meta: Sync Insights')
const DASH    = loadCodeNode('Arak Lighting – Meta Dashboard', 'Meta: Dashboard')

const IMG = 'https://cdn.test/photo.jpg'

// A cooperative Instagram. `containerStatus` lets a test make Meta refuse the
// media at the status check, which is the only place a refusal shows up.
function instagram({ containerStatus = 'FINISHED', quotaUsage = 1, quotaTotal = 100 } = {}) {
  const created = []
  const published = []
  const routes = [
    ['/content_publishing_limit', async () => ({
      statusCode: 200,
      body: { data: [{ config: { quota_total: quotaTotal, quota_duration: 86400 }, quota_usage: quotaUsage }] },
    })],
    ['/media_publish', async ({ body }) => {
      published.push(formBody(body))
      return { statusCode: 200, body: { id: 'media_777' } }
    }],
    [`${IG_USER}/media`, async ({ body }) => {
      const form = formBody(body)
      created.push(form)
      return { statusCode: 200, body: { id: `container_${created.length}` } }
    }],
    ['container_', async () => ({
      statusCode: 200,
      body: { status_code: containerStatus, status: `stub says ${containerStatus}` },
    })],
    ['media_777', async () => ({
      statusCode: 200,
      body: { id: 'media_777', permalink: 'https://www.instagram.com/p/STUB/', timestamp: '2026-08-19T08:47:38+0000' },
    })],
  ]
  return { routes, created, published }
}

const postRow = (over = {}) => ({
  id: 'p1', workspace_id: 'ws1', platform: 'instagram',
  publish_status: 'not_published', publish_error: '',
  zernio_post_id: '', zernio_account_id: '', publish_provider: 'zernio',
  scheduled_publish_at: null, publish_started_at: null, meta_container_id: '',
  caption: '', hashtags: '', image_url: IMG, image_urls: null,
  video_url: '', cover_image_url: '', alt_text: '',
  ...over,
})
const webhook = body => ({ body, headers: {} })

describe('Publish Post (Meta) — publishing', () => {
  it('runs the two-step container flow and records the media id', async () => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG, caption: 'hello' }),
    })

    expect(out.ok).toBe(true)
    expect(ig.created).toHaveLength(1)
    expect(ig.published[0].creation_id).toBe('container_1')

    const row = db.tables.generated_posts[0]
    expect(row.publish_status).toBe('published')
    // The Instagram media id lands in the column Zernio's id used to occupy.
    expect(row.zernio_post_id).toBe('media_777')
    expect(row.publish_provider).toBe('meta')
    expect(row.zernio_account_id).toBe(IG_USER)
    expect(row.platform_post_url).toBe('https://www.instagram.com/p/STUB/')
  })

  it('persists the container id before publishing, and clears it after', async () => {
    // The gap between "container ready" and "media_publish returned" is the
    // one window where a crash leaves real ambiguity, so the id has to be on
    // the row while that call is in flight — not merely at the end.
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    let idDuringPublish = null
    const routes = [
      ['/media_publish', async () => {
        idDuringPublish = db.tables.generated_posts[0].meta_container_id
        return { statusCode: 200, body: { id: 'media_777' } }
      }],
      ...ig.routes,
    ]
    await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG }),
    })
    expect(idDuringPublish).toBe('container_1')
    expect(db.tables.generated_posts[0].meta_container_id).toBe('')
  })

  it('never publishes a container Instagram refused', async () => {
    // The regression this pins: `POST /media` returns an id even for media
    // Meta will reject, so publishing off the id alone posts broken media.
    const ig = instagram({ containerStatus: 'ERROR' })
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG }),
    })
    expect(ig.published).toHaveLength(0)
    expect(out.ok).toBe(false)
    expect(db.tables.generated_posts[0].publish_status).toBe('failed')
    expect(db.tables.generated_posts[0].publish_error).toMatch(/could not process the media/i)
  })

  it('builds a carousel from child containers under one parent', async () => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({
        post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', caption: 'three up',
        image_urls: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg', 'https://cdn.test/c.jpg'],
      }),
    })
    expect(ig.created).toHaveLength(4)                       // 3 children + 1 parent
    expect(ig.created.slice(0, 3).every(c => c.is_carousel_item === 'true')).toBe(true)
    // Children carry no caption; only the parent does.
    expect(ig.created.slice(0, 3).every(c => c.caption === undefined)).toBe(true)
    expect(ig.created[3].media_type).toBe('CAROUSEL')
    expect(ig.created[3].children).toBe('container_1,container_2,container_3')
    expect(ig.created[3].caption).toBe('three up')
  })

  it('posts video as a Reel that also lands on the grid', async () => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({
        post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1',
        video_url: 'https://cdn.test/clip.mp4', cover_image_url: 'https://cdn.test/cover.jpg',
      }),
    })
    expect(ig.created[0].media_type).toBe('REELS')
    expect(ig.created[0].share_to_feed).toBe('true')
    expect(ig.created[0].cover_url).toBe('https://cdn.test/cover.jpg')
  })

  it('converts WEBP away before handing the url to Meta', async () => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: 'https://cdn.test/pic.webp' }),
    })
    expect(ig.created[0].image_url).toContain('images.weserv.nl')
    expect(ig.created[0].image_url).toContain('output=jpg')
  })

  it('isolates each language block of a bilingual caption', async () => {
    // Without the isolates, Instagram resolves the whole string at RTL level
    // and neutral characters in the English half jump to the wrong side.
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({
        post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG,
        caption: 'مصابيح أنيقة.\n\n—\n\nElegant lighting.',
      }),
    })
    const caption = ig.created[0].caption
    expect(caption).toContain('⁧مصابيح')   // RLI before the Arabic block
    expect(caption).toContain('⁦Elegant')  // LRI before the English block
    expect(caption).toContain('⁩')         // PDI closing them
  })

  it('fails an over-long caption with a usable reason, and publishes nothing', async () => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG, caption: 'x'.repeat(2300) }),
    })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/2200/)
    expect(ig.created).toHaveLength(0)
    // Marked failed rather than left scheduled: a caption that cannot publish
    // must leave the queue, or the cron retries it every five minutes forever
    // and never says why.
    expect(db.tables.generated_posts[0].publish_status).toBe('failed')
    expect(db.tables.generated_posts[0].publish_error).toMatch(/2200/)
  })

  it('does not let one bad post abort the rest of the sweep', async () => {
    // Regression: the caption check used to throw before the claim, which
    // escaped the per-post handler and killed the whole tick — one over-long
    // caption stopped every other due post from going out.
    const past = new Date(Date.now() - 60_000).toISOString()
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [
      postRow({ id: 'bad',  publish_status: 'scheduled', scheduled_publish_at: past, caption: 'x'.repeat(2300) }),
      postRow({ id: 'good', publish_status: 'scheduled', scheduled_publish_at: past, caption: 'fine' }),
    ] })
    const { out } = await runCodeNode(PUBLISH, { env: ENV, postgrest: db, routes: ig.routes, input: {} })
    const byId = Object.fromEntries(db.tables.generated_posts.map(r => [r.id, r]))
    expect(out.mode).toBe('sweep')
    expect(byId.bad.publish_status).toBe('failed')
    expect(byId.good.publish_status).toBe('published')
  })

  it('leaves a quota-blocked post scheduled rather than failing it', async () => {
    const ig = instagram({ quotaUsage: 100, quotaTotal: 100 })
    const db = new StubPostgrest({ generated_posts: [postRow({ publish_status: 'scheduled' })] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG }),
    })
    expect(out.quota).toBe(true)
    expect(ig.created).toHaveLength(0)
    expect(db.tables.generated_posts[0].publish_status).toBe('scheduled')
  })
})

describe('Publish Post (Meta) — the claim guard', () => {
  it.each([
    ['published',  'media_old'],
    ['publishing', ''],
  ])('refuses a post already %s, without overwriting its state', async (status, mediaId) => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow({ publish_status: status, zernio_post_id: mediaId })] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG }),
    })
    expect(out.skipped).toBe(true)
    expect(ig.published).toHaveLength(0)
    // Returning rather than throwing is the point: the catch would stamp
    // 'failed' onto a post that is in fact live.
    expect(db.tables.generated_posts[0].publish_status).toBe(status)
  })

  it('lets force:true through', async () => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow({ publish_status: 'published' })] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG, force: true }),
    })
    expect(out.ok).toBe(true)
  })

  it('rejects an unknown post table instead of interpolating it into a URL', async () => {
    const ig = instagram()
    const db = new StubPostgrest({})
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({ post_id: 'p1', post_table: 'users; drop', workspace_id: 'ws1', image_url: IMG }),
    })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/Unknown post_table/)
  })
})

describe('Publish Post (Meta) — scheduling', () => {
  it('books the slot locally and calls Instagram not at all', async () => {
    const ig = instagram()
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    const { out, calls } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: ig.routes,
      input: webhook({
        post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG,
        scheduled_for: '2026-08-20T19:00', timezone: 'Asia/Riyadh',
      }),
    })
    expect(out.publish_status).toBe('scheduled')
    expect(calls.filter(c => !c.url.startsWith(STUB_SUPABASE))).toHaveLength(0)
    expect(db.tables.generated_posts[0].publish_status).toBe('scheduled')
  })

  it('stores the wall clock as a real instant in the brand zone', async () => {
    // 7 PM Riyadh is 16:00Z. Writing the naive string would have Postgres read
    // it as UTC and schedule the post three hours late.
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: instagram().routes,
      input: webhook({
        post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG,
        scheduled_for: '2026-08-20T19:00', timezone: 'Asia/Riyadh',
      }),
    })
    expect(db.tables.generated_posts[0].scheduled_publish_at).toBe('2026-08-20T16:00:00.000Z')
  })

  it('refuses a schedule it cannot resolve to an instant', async () => {
    const db = new StubPostgrest({ generated_posts: [postRow()] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: instagram().routes,
      input: webhook({
        post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', image_url: IMG,
        scheduled_for: 'next tuesday-ish',
      }),
    })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/Unparseable scheduled_for/)
  })

  it('clears the slot on cancel_only without calling Instagram', async () => {
    const db = new StubPostgrest({ generated_posts: [postRow({ publish_status: 'scheduled', scheduled_publish_at: '2026-09-01T10:00:00Z' })] })
    const { out, calls } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: instagram().routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', reschedule: true, cancel_only: true }),
    })
    expect(out.ok).toBe(true)
    expect(calls.filter(c => !c.url.startsWith(STUB_SUPABASE))).toHaveLength(0)
    const row = db.tables.generated_posts[0]
    expect(row.publish_status).toBe('not_published')
    expect(row.scheduled_publish_at).toBeNull()
  })

  it('refuses to unschedule a post already in flight', async () => {
    const db = new StubPostgrest({ generated_posts: [postRow({ publish_status: 'publishing' })] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: instagram().routes,
      input: webhook({ post_id: 'p1', post_table: 'generated_posts', workspace_id: 'ws1', reschedule: true, cancel_only: true }),
    })
    expect(out.ok).toBe(false)
    expect(db.tables.generated_posts[0].publish_status).toBe('publishing')
  })
})

describe('Publish Post (Meta) — the 5-minute sweep', () => {
  const cron = {}   // no `body` key: that absence is what selects the sweep

  it('publishes what is due and leaves everything else alone', async () => {
    const past   = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const db = new StubPostgrest({ generated_posts: [
      postRow({ id: 'due',   publish_status: 'scheduled',     scheduled_publish_at: past }),
      postRow({ id: 'later', publish_status: 'scheduled',     scheduled_publish_at: future }),
      postRow({ id: 'draft', publish_status: 'not_published' }),
    ] })
    const { out } = await runCodeNode(PUBLISH, { env: ENV, postgrest: db, routes: instagram().routes, input: cron })

    expect(out.mode).toBe('sweep')
    expect(out.published).toBe(1)
    const byId = Object.fromEntries(db.tables.generated_posts.map(r => [r.id, r]))
    expect(byId.due.publish_status).toBe('published')
    expect(byId.later.publish_status).toBe('scheduled')
    expect(byId.draft.publish_status).toBe('not_published')
  })

  it('stops sweeping once the account quota bites', async () => {
    // Quota is account-wide, so grinding through the rest of the queue would
    // just burn every remaining post on the same wall.
    const past = new Date(Date.now() - 60_000).toISOString()
    const db = new StubPostgrest({ generated_posts: [
      postRow({ id: 'a', publish_status: 'scheduled', scheduled_publish_at: past }),
      postRow({ id: 'b', publish_status: 'scheduled', scheduled_publish_at: past }),
    ] })
    const { out } = await runCodeNode(PUBLISH, {
      env: ENV, postgrest: db, routes: instagram({ quotaUsage: 100, quotaTotal: 100 }).routes, input: cron,
    })
    expect(out.published).toBe(0)
    expect(out.due).toBe(1)   // gave up after the first refusal
    expect(db.tables.generated_posts.every(r => r.publish_status === 'scheduled')).toBe(true)
  })

  it('unwedges a row stuck publishing, but only once it is genuinely old', async () => {
    const db = new StubPostgrest({ generated_posts: [
      postRow({ id: 'wedged', publish_status: 'publishing', publish_started_at: new Date(Date.now() - 45 * 60_000).toISOString() }),
      postRow({ id: 'fresh',  publish_status: 'publishing', publish_started_at: new Date(Date.now() - 60_000).toISOString() }),
    ] })
    const { out } = await runCodeNode(PUBLISH, { env: ENV, postgrest: db, routes: instagram().routes, input: cron })
    const byId = Object.fromEntries(db.tables.generated_posts.map(r => [r.id, r]))
    expect(out.unwedged).toBe(1)
    expect(byId.wedged.publish_status).toBe('failed')
    // Never auto-retried: its container may already have been published.
    expect(byId.wedged.publish_error).toMatch(/interrupted/i)
    expect(byId.fresh.publish_status).toBe('publishing')
  })
})

// ─── Insights ──────────────────────────────────────────────────────────────

function insightRows(pairs) {
  return { data: Object.entries(pairs).map(([name, value]) => ({ name, period: 'lifetime', values: [{ value }] })) }
}

const PROFILE = {
  id: IG_USER, username: 'lightingaaa', name: 'Elegant Lighting',
  profile_picture_url: 'https://cdn.test/pfp.jpg',
  followers_count: 412, follows_count: 7, media_count: 5,
}

describe('Meta Insights Sync', () => {
  const routes = [
    [`${IG_USER}/insights`, async () => ({
      statusCode: 200,
      body: { data: [
        { name: 'reach', total_value: { value: 900 } },
        { name: 'profile_views', total_value: { value: 30 } },
        { name: 'website_clicks', total_value: { value: 4 } },
      ] },
    })],
    ['media_1/insights', async () => ({
      statusCode: 200,
      body: insightRows({ reach: 500, likes: 40, comments: 3, saved: 9, shares: 2, views: 1200, total_interactions: 54 }),
    })],
    ['media_1', async () => ({
      statusCode: 200,
      body: {
        id: 'media_1', media_type: 'IMAGE', media_product_type: 'FEED',
        timestamp: '2026-08-18T09:00:00+0000', permalink: 'https://www.instagram.com/p/AAA/',
        like_count: 40, comments_count: 3,
      },
    })],
    [IG_USER, async () => ({ statusCode: 200, body: PROFILE })],
  ]

  const seeded = () => new StubPostgrest({
    generated_posts: [postRow({
      id: 'p1', zernio_post_id: 'media_1', publish_provider: 'meta',
      publish_status: 'published', platform_post_url: '',
    })],
    social_accounts: [], account_analytics: [], post_analytics: [],
  })

  it('records the account snapshot and the per-post metrics', async () => {
    const db = seeded()
    const { out } = await runCodeNode(SYNC, { env: ENV, postgrest: db, routes, input: webhook({ workspace_id: 'ws1' }) })
    expect(out.ok).toBe(true)
    expect(out.account).toBe('lightingaaa')

    const acct = db.tables.account_analytics[0]
    // From the profile field, not the follower_count insight — that one
    // returns an empty series on small accounts.
    expect(acct.followers_count).toBe(412)
    expect(acct.profile_views).toBe(30)
    expect(acct.clicks).toBe(4)

    const pa = db.tables.post_analytics[0]
    expect(pa.reach).toBe(500)
    expect(pa.saves).toBe(9)     // Instagram calls it `saved`
    expect(pa.views).toBe(1200)
    expect(pa.publish_provider).toBe('meta')
  })

  it('does not claim metrics Instagram never reported', async () => {
    // The distinction metrics_present exists to preserve: `impressions` was
    // removed in Graph v22 and there is no per-media click metric, so both
    // must read as absent rather than as a measured zero.
    const db = seeded()
    await runCodeNode(SYNC, { env: ENV, postgrest: db, routes, input: webhook({ workspace_id: 'ws1' }) })
    const pa = db.tables.post_analytics[0]
    expect(pa.metrics_present).toContain('reach')
    expect(pa.metrics_present).toContain('views')
    expect(pa.metrics_present).not.toContain('impressions')
    expect(pa.metrics_present).not.toContain('clicks')
    expect(pa.impressions).toBe(0)
  })

  it('backfills a permalink that publishing failed to record', async () => {
    const db = seeded()
    await runCodeNode(SYNC, { env: ENV, postgrest: db, routes, input: webhook({ workspace_id: 'ws1' }) })
    expect(db.tables.generated_posts[0].platform_post_url).toBe('https://www.instagram.com/p/AAA/')
  })

  it('still records a row when the insights call degrades to the core set', async () => {
    const degraded = [
      ['media_1/insights', async ({ url }) => (url.includes('profile_visits')
        ? { statusCode: 200, body: { error: { code: 100, message: 'metric not supported for this media type' } } }
        : { statusCode: 200, body: insightRows({ reach: 5, likes: 1, comments: 0, saved: 0, shares: 0 }) })],
      ...routes,
    ]
    const db = seeded()
    const { out } = await runCodeNode(SYNC, { env: ENV, postgrest: db, routes: degraded, input: webhook({ workspace_id: 'ws1' }) })
    expect(out.rows_written).toBe(1)
    expect(db.tables.post_analytics[0].reach).toBe(5)
  })
})

describe('Meta Dashboard', () => {
  const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
  const iso = n => new Date(Date.now() - n * 86400000).toISOString().replace(/\.\d+Z$/, '+0000')

  const routes = [
    [`${IG_USER}/media`, async () => ({
      statusCode: 200,
      body: {
        data: [{
          id: 'media_1', timestamp: iso(2), permalink: 'https://www.instagram.com/p/AAA/',
          media_type: 'IMAGE', media_product_type: 'FEED',
          media_url: 'https://cdn.test/a.jpg', caption: 'hi', like_count: 40, comments_count: 3,
          insights: insightRows({ reach: 500, likes: 40, comments: 3, saved: 9, shares: 2, views: 1200 }),
        }],
        paging: {},
      },
    })],
    [IG_USER, async () => ({ statusCode: 200, body: PROFILE })],
  ]

  const db = () => new StubPostgrest({
    account_analytics: [0, 1, 2].map(n => ({
      workspace_id: 'ws1', account_id: IG_USER, metric_date: day(n),
      followers_count: 400 + (2 - n), reach: 100, views: 300, likes: 10,
      comments: 2, saves: 1, shares: 0, clicks: 0,
    })),
    post_analytics: [
      { workspace_id: 'ws1', publish_provider: 'meta', zernio_post_id: 'media_1', metric_date: day(2), likes: 10, comments: 0, shares: 0, saves: 0 },
      { workspace_id: 'ws1', publish_provider: 'meta', zernio_post_id: 'media_1', metric_date: day(0), likes: 40, comments: 3, shares: 2, saves: 9 },
    ],
  })

  it('returns every section the Analytics page reads', async () => {
    const { out } = await runCodeNode(DASH, { env: ENV, postgrest: db(), routes, input: webhook({ days: 30, workspace_id: 'ws1' }) })
    expect(out.ok).toBe(true)
    for (const key of ['overview', 'daily', 'bestTime', 'frequency', 'decay', 'followers']) {
      expect(out[key], `missing section: ${key}`).toBeTruthy()
      expect(out[key]._error).toBeUndefined()
    }
    const post = out.overview.posts[0]
    expect(post.analytics.likes).toBe(40)
    expect(post.analytics.saves).toBe(9)
    // No thumbnail_url on a still — media_url is the thumbnail.
    expect(post.thumbnailUrl).toBe('https://cdn.test/a.jpg')
    expect(out.overview.accounts[0].followersCount).toBe(412)
  })

  it('advertises only the metrics Instagram can fill', async () => {
    const { out } = await runCodeNode(DASH, { env: ENV, postgrest: db(), routes, input: webhook({ days: 30, workspace_id: 'ws1' }) })
    expect(out.metricsSupported).toContain('views')
    expect(out.metricsSupported).toContain('reach')
    expect(out.metricsSupported).not.toContain('impressions')
    expect(out.metricsSupported).not.toContain('clicks')
  })

  it('uses the field names the charts bind to', async () => {
    const { out } = await runCodeNode(DASH, { env: ENV, postgrest: db(), routes, input: webhook({ days: 30, workspace_id: 'ws1' }) })
    expect(out.bestTime.slots[0]).toEqual(expect.objectContaining({
      day_of_week: expect.any(Number), hour: expect.any(Number), avg_engagement: expect.any(Number),
    }))
    // BestTimeHeatmap indexes rows Monday-first.
    expect(out.bestTime.slots.every(s => s.day_of_week >= 0 && s.day_of_week <= 6)).toBe(true)
    expect(out.frequency.frequency[0]).toEqual(expect.objectContaining({
      platform: 'instagram', posts_per_week: expect.any(Number), avg_engagement_rate: expect.any(Number),
    }))
    expect(out.decay.buckets[0]).toEqual(expect.objectContaining({
      bucket_order: expect.any(Number), bucket_label: expect.any(String), avg_pct_of_final: expect.any(Number),
    }))
    expect(out.followers.stats[IG_USER][0]).toEqual(expect.objectContaining({
      date: expect.any(String), followers: expect.any(Number),
    }))
  })

  it('reads follower history oldest-first', async () => {
    const { out } = await runCodeNode(DASH, { env: ENV, postgrest: db(), routes, input: webhook({ days: 30, workspace_id: 'ws1' }) })
    const series = out.followers.stats[IG_USER]
    expect(series[0].date < series[series.length - 1].date).toBe(true)
    expect(series[series.length - 1].followers).toBe(402)
  })

  it('builds the decay curve up to 100% of final engagement', async () => {
    const { out } = await runCodeNode(DASH, { env: ENV, postgrest: db(), routes, input: webhook({ days: 30, workspace_id: 'ws1' }) })
    const last = out.decay.buckets[out.decay.buckets.length - 1]
    expect(Math.round(last.avg_pct_of_final)).toBe(100)
  })

  it('empties only the workspace-scoped sections when no workspace is given', async () => {
    // Live Graph data still resolves; the derived sections come from our own
    // tables and have nothing to read. Blank, not wrong.
    const { out } = await runCodeNode(DASH, { env: ENV, postgrest: db(), routes, input: webhook({ days: 30 }) })
    expect(out.overview.posts).toHaveLength(1)
    expect(out.daily.dailyData).toHaveLength(0)
    expect(out.followers.stats).toEqual({})
    expect(out.decay.buckets).toHaveLength(0)
  })
})
