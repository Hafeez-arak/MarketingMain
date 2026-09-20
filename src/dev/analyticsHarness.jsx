import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AccountAnalytics } from '../components/social/AccountAnalytics'
import '../index.css'

// ─── Dev-only Analytics-tab harness ────────────────────────────────────────
// The platform page's Analytics tab — account insights strip, KPI strip,
// charts and tables — against stubbed answers, so it can be looked at without
// signing in and without waiting on Zernio.
//
// ── THE NUMBERS ARE THE REAL ONES ──
//
// Every figure below is copied from the two screenshots that prompted this
// work, so the confusion is reproducible rather than described:
//
//   Instagram  reach 10 · views 44 · engaged 1 · interactions 3 · taps 0
//              and, one strip lower, a post reach of 16.
//   LinkedIn   page engagement rate 6.3%, and one strip lower, 3.2%.
//
// Both pairs looked like bugs and neither is. 10 is ten distinct accounts;
// 16 is eight posts' reach ADDED TOGETHER, which counts a person once per post
// they saw. 6.3% is LinkedIn's own figure by LinkedIn's own formula over every
// post the page carries; 3.2% is interactions ÷ reach over the posts in the
// chosen window. Fixtures that rounded these off into tidy, agreeing numbers
// would verify a page that never had the problem.
//
// Served by Vite at /dev-analytics.html. Vite only builds index.html, so this
// never reaches a production bundle.

const FROM = '2026-08-21'
const TO = '2026-09-19'

const IG_ACCOUNT = {
  platform: 'instagram', zernio_account_id: 'ig-1', username: 'lightingaaa',
  display_name: 'Elegant Lighting', is_active: true, account_type: null, followers_count: 1,
}

const LI_ACCOUNT = {
  platform: 'linkedin', zernio_account_id: 'li-1', username: 'arak-lighting',
  display_name: 'ARAK Lighting', is_active: true, account_type: 'organization', followers_count: 4800,
}

// Inline SVG rather than a remote URL: the harness must draw the same with no
// network, and a real CDN link would expire and quietly turn every fixture
// into the broken-image placeholder.
const swatch = (label, bg) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">` +
    `<rect width="1080" height="1080" fill="${bg}"/>` +
    `<text x="540" y="560" font-family="sans-serif" font-size="96" fill="#fff" ` +
    `text-anchor="middle">${label}</text></svg>`,
  )}`

// Every third post is a carousel, so the lightbox's slide count and arrows
// are reachable in the harness rather than only against a live account.
const post = (platform, i, analytics, dayOffset) => {
  const slides = i % 3 === 0 ? 3 : 1
  return {
    _id: `${platform}-post-${i}`,
    platform,
    publishedAt: new Date(Date.parse(`${FROM}T00:00:00Z`) + dayOffset * 86_400_000).toISOString(),
    content: `${platform} post ${i}`,
    platformPostUrl: `https://example.com/${platform}/${i}`,
    mediaType: slides > 1 ? 'carousel' : 'image',
    thumbnailUrl: swatch(`${i}`, '#4c5e61'),
    mediaItems: Array.from({ length: slides }, (_, n) => ({
      type: 'image',
      url: swatch(`${i}.${n + 1}`, ['#4c5e61', '#325130', '#c2415c'][n % 3]),
    })),
    analytics,
  }
}

// Eight posts whose reach adds to 16 and whose interactions add to 3 — the
// screenshot's 18.8% (3 ÷ 16) falls out of the arithmetic rather than being
// written in.
const IG_POSTS = [
  post('instagram', 1, { likes: 1, comments: 0, shares: 0, saves: 0, reach: 4, views: 9 }, 2),
  post('instagram', 2, { likes: 1, comments: 0, shares: 0, saves: 0, reach: 3, views: 7 }, 5),
  post('instagram', 3, { likes: 0, comments: 1, shares: 0, saves: 0, reach: 3, views: 6 }, 9),
  post('instagram', 4, { likes: 0, comments: 0, shares: 0, saves: 0, reach: 2, views: 5 }, 12),
  post('instagram', 5, { likes: 0, comments: 0, shares: 0, saves: 0, reach: 2, views: 5 }, 16),
  post('instagram', 6, { likes: 0, comments: 0, shares: 0, saves: 0, reach: 1, views: 4 }, 20),
  post('instagram', 7, { likes: 0, comments: 0, shares: 0, saves: 0, reach: 1, views: 4 }, 24),
  post('instagram', 8, { likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, views: 4 }, 27),
]

// One post, reaching 530, with 17 interactions — 3.2%, against the page's own
// 6.3% in the strip above it.
const LI_POSTS = [
  post('linkedin', 1, { likes: 14, comments: 0, shares: 3, impressions: 1027, reach: 530, clicks: 186 }, 13),
]

function dailyRows(posts, keys) {
  const byDate = new Map()
  for (const p of posts) {
    const date = p.publishedAt.slice(0, 10)
    const row = byDate.get(date) || { date, metrics: Object.fromEntries(keys.map(k => [k, 0])) }
    for (const k of keys) row.metrics[k] += p.analytics[k] || 0
    byDate.set(date, row)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// LinkedIn's daily series, shaped like the screenshot's chart: flat, one sharp
// spike around Sep 3, quiet after.
function linkedinSeries() {
  const out = { impressions: [], unique_impressions: [], clicks: [] }
  const start = Date.parse(`${FROM}T00:00:00Z`)
  for (let i = 0; i < 29; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    const spike = i === 13 ? 670 : i === 12 ? 180 : i === 14 ? 240 : 0
    const base = 20 + Math.round(Math.abs(Math.sin(i / 2.2)) * 60)
    const impressions = base + spike
    out.impressions.push({ date, value: impressions })
    out.unique_impressions.push({ date, value: Math.round(impressions * 0.4) })
    out.clicks.push({ date, value: Math.round(impressions * 0.09) })
  }
  return { metrics: Object.fromEntries(Object.entries(out).map(([k, values]) => [k, { values }])) }
}

// `hour` and `avg_engagement`, which is what BestTimeHeatmap reads — not the
// `hour_of_day`/`avg_engagement_rate` the posting-frequency rows use. Getting
// this wrong renders the whole tab blank, since `best.avg_engagement.toFixed`
// throws on undefined.
const BEST_TIME = [
  { day_of_week: 0, hour: 9, avg_engagement: 4.1, post_count: 3 },
  { day_of_week: 0, hour: 18, avg_engagement: 6.8, post_count: 2 },
  { day_of_week: 2, hour: 12, avg_engagement: 9.2, post_count: 4 },
  { day_of_week: 3, hour: 21, avg_engagement: 3.3, post_count: 1 },
  { day_of_week: 5, hour: 15, avg_engagement: 7.5, post_count: 2 },
]

const FREQUENCY = [
  { platform: 'instagram', posts_per_week: 1, avg_engagement_rate: 4.2 },
  { platform: 'instagram', posts_per_week: 2, avg_engagement_rate: 7.9 },
  { platform: 'instagram', posts_per_week: 4, avg_engagement_rate: 5.1 },
]

const DECAY = [
  { bucket_order: 1, bucket_label: '1h', avg_pct_of_final: 18 },
  { bucket_order: 2, bucket_label: '6h', avg_pct_of_final: 47 },
  { bucket_order: 3, bucket_label: '24h', avg_pct_of_final: 78 },
  { bucket_order: 4, bucket_label: '3d', avg_pct_of_final: 94 },
  { bucket_order: 5, bucket_label: '7d', avg_pct_of_final: 100 },
]

function analyticsFor(platform) {
  if (platform === 'linkedin') {
    return {
      account: { zernio_account_id: 'li-1', platform: 'linkedin' },
      platform: 'linkedin', days: 30, fromDate: FROM, toDate: TO, insightsFrom: '2026-08-20',
      metricsSupported: ['impressions', 'reach', 'likes', 'comments', 'shares', 'clicks'],
      overview: {
        overview: { lastSync: '2026-09-19T09:10:00Z', totalPosts: 1 },
        accounts: [{ _id: 'li-1', followersCount: 4800 }],
        posts: LI_POSTS,
      },
      daily: { dailyData: dailyRows(LI_POSTS, ['impressions', 'reach', 'likes', 'comments', 'shares', 'clicks']) },
      bestTime: { slots: BEST_TIME },
      frequency: { frequency: [] },
      decay: { buckets: DECAY },
      followers: {
        stats: { 'li-1': [{ date: FROM, followers: 4740 }, { date: TO, followers: 4800 }] },
        accounts: [{ _id: 'li-1', currentFollowers: 4800, dataPoints: 30 }],
      },
      // engagement_rate arrives as a 0..1 fraction — 0.063 renders as 6.3%.
      linkedinPage: {
        metrics: {
          impressions: { total: 2400 }, unique_impressions: { total: 673 }, clicks: { total: 217 },
          engagement_rate: { total: 0.063 },
          organic_followers_gained: { total: 58 }, paid_followers_gained: { total: 2 },
          page_views_total: { total: 12 }, page_views_overview: { total: 4 },
          page_views_careers: { total: 2 }, page_views_jobs: { total: 2 }, page_views_life: { total: 0 },
          likes: { total: 58 }, comments: { total: 0 }, shares: { total: 0 },
        },
      },
      linkedinSeries: linkedinSeries(),
    }
  }
  return {
    account: { zernio_account_id: 'ig-1', platform: 'instagram' },
    platform: 'instagram', days: 30, fromDate: FROM, toDate: TO, insightsFrom: FROM,
    metricsSupported: ['likes', 'comments', 'shares', 'saves', 'views', 'reach'],
    overview: {
      overview: { lastSync: '2026-09-19T09:10:00Z', totalPosts: 8 },
      accounts: [{ _id: 'ig-1', followersCount: 1 }],
      posts: IG_POSTS,
    },
    daily: { dailyData: dailyRows(IG_POSTS, ['reach', 'views', 'likes', 'comments', 'shares', 'saves']) },
    bestTime: { slots: BEST_TIME },
    frequency: { frequency: FREQUENCY },
    decay: { buckets: DECAY },
    followers: {
      stats: { 'ig-1': [{ date: FROM, followers: 1 }, { date: TO, followers: 1 }] },
      accounts: [{ _id: 'ig-1', currentFollowers: 1, dataPoints: 30 }],
    },
    insights: {
      metrics: {
        reach: { total: 10 }, views: { total: 44 },
        accounts_engaged: { total: 1 }, total_interactions: { total: 3 },
        profile_links_taps: { total: 0 },
      },
    },
  }
}

// ── The stub ──
// Anything unmatched answers 404 loudly: a stub that quietly resolves an
// unexpected call is how a harness comes to prove something the app does not do.
function installFetch(platform) {
  const json = body => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)),
  })

  window.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.includes('/api/zernio/analytics')) {
      await new Promise(r => setTimeout(r, 300))
      return json({ ok: true, ...analyticsFor(platform) })
    }
    // The Follower history card's own range picker reads this route rather
    // than the nine-read analytics one. A longer window gets a longer series,
    // so the card's picker visibly does something in the harness.
    if (url.includes('/api/zernio/followers')) {
      await new Promise(r => setTimeout(r, 250))
      const body = JSON.parse(init.body || '{}')
      const span = body.from && body.to
        ? Math.round((Date.parse(body.to) - Date.parse(body.from)) / 86400000) + 1
        : Number(body.days) || 30
      const points = Math.min(span, 40)
      const rows = Array.from({ length: points }, (_, i) => ({
        date: new Date(Date.now() - (points - 1 - i) * 86400000).toISOString().slice(0, 10),
        followers: 1800 + i * 2,
      }))
      return json({ ok: true, followers: { stats: { [body.account_id]: rows }, accounts: [] } })
    }
    if (url.includes('/api/zernio/sync')) {
      await new Promise(r => setTimeout(r, 600))
      return json({ ok: true, accounts: [IG_ACCOUNT, LI_ACCOUNT], synced: [], synced_at: new Date().toISOString() })
    }
    if (url.includes('/api/zernio/accounts')) {
      return json({ ok: true, accounts: [IG_ACCOUNT, LI_ACCOUNT], profile_id: 'profile-1' })
    }
    if (url.includes('/auth/v1/')) return json({ data: { session: null } })
    console.warn('[harness] unstubbed fetch', url)
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not stubbed' }) })
  }
}

const SCENARIOS = [
  { key: 'instagram', label: 'Instagram account', accounts: [IG_ACCOUNT] },
  { key: 'linkedin', label: 'LinkedIn company page', accounts: [LI_ACCOUNT] },
]

// Exported so Fast Refresh can swap it: a file with no exports at all falls
// back to a full page reload on every edit, which loses the scenario.
export function AnalyticsHarness() {
  const [platform, setPlatform] = useState('instagram')
  const scenario = SCENARIOS.find(s => s.key === platform)

  installFetch(platform)

  const auth = {
    activeWorkspaceId: `00000000-0000-0000-0000-00000000000${SCENARIOS.indexOf(scenario) + 1}`,
    accessToken: 'harness-token',
    user: { id: 'dev', email: 'dev@example.com' },
    session: { access_token: 'harness-token' },
    workspaces: [],
    loading: false,
  }

  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <div className="min-h-screen bg-surface-muted">
          <div className="border-b border-border bg-white px-6 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="eyebrow">Analytics harness</span>
            {SCENARIOS.map(s => (
              <button key={s.key} onClick={() => setPlatform(s.key)}
                className={`text-xs px-2.5 py-1.5 border transition-colors
                  ${platform === s.key ? 'border-stone-400 bg-surface-subtle text-text font-semibold' : 'border-border text-text-tertiary hover:text-text'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="p-6">
            {/* Keyed on the platform so every hook remounts and refetches. */}
            <AccountAnalytics key={platform} platform={platform} accounts={scenario.accounts} />
          </div>
        </div>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<AnalyticsHarness />)
