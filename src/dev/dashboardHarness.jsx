import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import Dashboard from '../pages/Dashboard'
import '../index.css'

// ─── Dev-only dashboard harness ────────────────────────────────────────────
// Mounts the real Dashboard against stubbed network answers, so every state it
// can be in is reachable in a browser without signing in — "/" is behind auth,
// and the states worth looking at (a platform that failed, a Search Console
// credential nobody has created, an account nobody has counted yet) cannot be
// produced on demand against the live stack at all.
//
// Nothing here is a mock of the COMPONENTS: the page, the aggregation and the
// SEO rules are the real ones. Only `fetch` is replaced, and only with the
// shapes the real routes return — see api/zernio/_zernio.js analyticsPlan and
// api/agent/search.js.
//
// Served by Vite at /dev-dashboard.html. Vite only builds index.html, so this
// never reaches a production bundle.

const FROM = '2026-08-18'
const TO = '2026-09-16'

const account = (platform, id, username, followers) => ({
  platform, zernio_account_id: id, username, display_name: username,
  is_active: true, account_type: platform === 'linkedin' ? 'organization' : null,
  followers_count: followers,
})

const ACCOUNTS = [
  account('instagram', 'ig-1', 'arak.lighting', 1840),
  account('linkedin', 'li-1', 'arak-lighting', 612),
  account('tiktok', 'tt-1', 'araklighting', 94),
]

// A month of daily rows with a plausible shape — a slow start, a spike where a
// post landed, and quiet days in between. Flat fixtures hide exactly the bug
// the zero-filling in platformSeries exists to prevent.
function dailyRows(seed, scale) {
  const out = []
  const start = Date.parse(`${FROM}T00:00:00Z`)
  for (let i = 0; i < 30; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    const wave = Math.sin((i + seed) / 3) + 1.2
    const spike = i === 9 + seed || i === 21 + seed ? 3 : 1
    const views = Math.round(wave * scale * spike)
    out.push({
      date,
      metrics: {
        views,
        reach: Math.round(views * 0.8),
        impressions: Math.round(views * 1.1),
        likes: Math.round(views * 0.04),
        comments: Math.round(views * 0.006),
        shares: Math.round(views * 0.003),
        saves: Math.round(views * 0.005),
        clicks: Math.round(views * 0.002),
      },
    })
  }
  return out
}

const CAPTIONS = [
  'Diriyah Gate lobby, 2700K throughout — the mock-up the client signed off on.',
  'Behind the spec: why we run DALI over 0-10V on every hospitality job.',
  'Qiddiya stadium concourse. Forty-eight metres of continuous run, no visible joint.',
  'Three questions to ask before you approve a lighting schedule.',
  'Riyadh showroom, open Sunday to Thursday.',
]

const post = (platform, i, analytics) => ({
  _id: `${platform}-post-${i}`,
  platform,
  publishedAt: new Date(Date.parse(`${FROM}T00:00:00Z`) + (i * 3 + 2) * 86_400_000).toISOString(),
  // `content` is the field the pages read; `caption` is kept beside it because
  // the two names have both been in play and the top-posts card reads either.
  content: CAPTIONS[i % CAPTIONS.length],
  caption: CAPTIONS[i % CAPTIONS.length],
  thumbnailUrl: '',
  platformPostUrl: `https://example.com/${platform}/${i}`,
  analytics,
})

function analyticsFor(platform) {
  if (platform === 'instagram') {
    return {
      account: { zernio_account_id: 'ig-1', platform: 'instagram' },
      platform: 'instagram', days: 30, fromDate: FROM, toDate: TO, insightsFrom: FROM,
      metricsSupported: ['likes', 'comments', 'shares', 'saves', 'views', 'reach'],
      overview: {
        overview: { lastSync: '2026-09-16T22:10:00Z' },
        accounts: [{ _id: 'ig-1', followersCount: 1840 }],
        posts: [
          post('instagram', 1, { likes: 214, comments: 18, shares: 9, saves: 31, reach: 5400, views: 7100 }),
          post('instagram', 2, { likes: 98, comments: 4, shares: 2, saves: 11, reach: 2600, views: 3050 }),
          post('instagram', 3, { likes: 402, comments: 41, shares: 27, saves: 64, reach: 9800, views: 15200 }),
          post('instagram', 4, { likes: 121, comments: 7, shares: 3, saves: 9, reach: 3100, views: 4400 }),
        ],
      },
      daily: { dailyData: dailyRows(0, 700) },
      followers: {
        stats: { 'ig-1': [{ date: FROM, followers: 1795 }, { date: TO, followers: 1840 }] },
        accounts: [{ _id: 'ig-1', currentFollowers: 1840, dataPoints: 30 }],
      },
      // Account-wide: every surface, the profile included. Deliberately much
      // larger than the post views, which is what makes the two tiles worth
      // having as two tiles.
      insights: {
        metrics: {
          reach: { total: 18400 }, views: { total: 42600 },
          accounts_engaged: { total: 1320 }, total_interactions: { total: 1261 },
          profile_links_taps: { total: 87 },
        },
      },
    }
  }
  if (platform === 'linkedin') {
    return {
      account: { zernio_account_id: 'li-1', platform: 'linkedin' },
      platform: 'linkedin', days: 30, fromDate: FROM, toDate: TO, insightsFrom: FROM,
      metricsSupported: ['impressions', 'reach', 'likes', 'comments', 'shares', 'clicks'],
      overview: {
        overview: { lastSync: '2026-09-16T22:10:00Z' },
        accounts: [{ _id: 'li-1', followersCount: 612 }],
        posts: [
          post('linkedin', 1, { likes: 31, comments: 5, shares: 4, impressions: 2400, clicks: 61 }),
          post('linkedin', 2, { likes: 12, comments: 1, shares: 0, impressions: 900, clicks: 14 }),
        ],
      },
      daily: { dailyData: dailyRows(2, 180) },
      followers: {
        stats: { 'li-1': [{ date: FROM, followers: 598 }, { date: TO, followers: 612 }] },
        accounts: [{ _id: 'li-1', currentFollowers: 612, dataPoints: 30 }],
      },
      linkedinPage: {
        metrics: {
          impressions: { total: 3300 }, unique_impressions: { total: 2410 },
          page_views_total: { total: 288 }, clicks: { total: 75 },
        },
      },
    }
  }
  // TikTok comes back as a failure on purpose: an account silently missing
  // from a total reads as a platform that had a quiet month, and the banner
  // that prevents that is worth being able to look at.
  return { error: 'This account needs reconnecting before it can report.' }
}

// ── Research runs, shaped after Arak's real ones ──
// The newest is a CAPPED run: complete in every column, a strong headline, 33
// findings, and every synthesis section empty because it spent $15.06 of a
// $15.00 monthly cap before it could analyse. That state is the whole reason
// the card steps over a run rather than trusting `status`.
const RESEARCH_RUNS = [
  { id: 'run-4', status: 'running', stage: 'gather', report: null, started_at: new Date().toISOString() },
  {
    id: 'run-3', status: 'complete', started_at: '2026-09-17T07:52:09Z', finished_at: '2026-09-17T07:55:07Z',
    report: {
      headline: 'Two landmark Riyadh projects named their design teams this week with lighting scope still open.',
      stage_reached: 'synthesise',
      findings: Array.from({ length: 33 }, (_, i) => ({ ref: `F${i}` })),
      top_three: [], market_direction: [], competitor_moves: [], gaps: [], proposed_ideas: [],
      competitor_board: [{ name: 'Huda' }],
      unanswered: [
        'The investigation did not complete, so this brief is the measured numbers only. ' +
        'This workspace has used its $15.00 agent budget for the month ($15.06 spent).',
      ],
    },
  },
  {
    id: 'run-2', status: 'complete', started_at: '2026-09-15T12:47:52Z', finished_at: '2026-09-15T12:55:14Z',
    report: {
      headline: 'The sales pipeline moved this week, not the board: Diriyah is running ten Riyadh hotels at once ' +
        'and Qiddiya\'s stadium is in live tender preparation, while we put our extra output on Instagram ' +
        'instead of the LinkedIn page that is still earning without us.',
      findings: Array.from({ length: 19 }, (_, i) => ({ ref: `F${i}` })),
      top_three: [
        { finding: 'Qiddiya\'s stadium is in live tender preparation.',
          action: 'Confirm whether we are pre-qualified before the portal closes.', team: 'sales', refs: ['F1'] },
        { finding: 'Our extra output went to Instagram, not the LinkedIn page that is still earning without us.',
          action: 'Move two of next week\'s posts to LinkedIn.', team: 'marketing', refs: ['F2'] },
        { finding: 'Three non-traditional rivals surfaced.', action: 'Add them to the watchlist.', team: 'technical', refs: ['F3'] },
      ],
      market_direction: [
        { movement: 'Rivals are buying physical presence rather than specifier reach.',
          basis: 'web', so_what: 'Specifier content is uncontested ground for us.' },
      ],
      competitor_moves: [
        { competitor: 'Huda', what_changed: 'Swapped specifier language for consumer showroom reels.',
          picture: 'Three signals in a month.', effect_on_us: 'The specifier audience is open.',
          relevance: 'high', refs: ['F4'] },
        { competitor: 'Technolight', what_changed: 'Hiring KNX engineers.',
          picture: 'Two adverts and a new page.', effect_on_us: 'They are entering controls.',
          relevance: 'medium', refs: ['F5'] },
      ],
      gaps: [
        { id: 'G1', gap: 'Nothing published on energy management for buildings',
          our_position: 'Sold on the homepage, no page of its own.',
          suggested_response: 'Publish a short technical brief.', basis: 'our_analytics' },
      ],
      proposed_ideas: [
        { title: 'Energy management in three numbers', angle: 'A one-page technical brief', answers: 'G1' },
        { title: 'What a GRMS retrofit actually costs', angle: 'From the 240-key job', answers: '' },
      ],
      new_competitors: [{ name: 'An IT integrator with a GRMS line', why: 'Overlaps on controls', source_url: '' }],
      competitor_board: [{ name: 'Huda' }, { name: 'Technolight' }],
      unanswered: ['Connect ARAK\'s own Instagram account to the board — still not done.'],
    },
  },
]

const SEARCH_OK = {
  ok: true, configured: true, site: 'sc-domain:arak-sa.com',
  windows: { days: 28, current: { start: '2026-08-18', end: '2026-09-14' }, previous: { start: '2026-07-21', end: '2026-08-17' } },
  brandTerms: ['arak', 'arak lighting'],
  lines: [],
  queries: [
    { query: 'guest room management system saudi', impressions: 412, clicks: 0, ctr: 0, position: 22.4 },
    { query: 'facade lighting riyadh', impressions: 233, clicks: 0, ctr: 0, position: 12.1 },
    { query: 'smart pole manufacturer saudi arabia', impressions: 151, clicks: 2, ctr: 0.01, position: 20.3 },
    { query: 'dali lighting control', impressions: 77, clicks: 0, ctr: 0, position: 9.4 },
    { query: 'arak lighting', impressions: 340, clicks: 41, ctr: 0.12, position: 1.4 },
    { query: 'energy management system buildings', impressions: 64, clicks: 0, ctr: 0, position: 26.8 },
  ],
  previous: [
    { query: 'guest room management system saudi', impressions: 300, clicks: 0, ctr: 0, position: 24.1 },
    { query: 'facade lighting riyadh', impressions: 240, clicks: 0, ctr: 0, position: 13.0 },
    { query: 'arak lighting', impressions: 330, clicks: 38, ctr: 0.11, position: 1.5 },
    { query: 'led floodlight jeddah', impressions: 90, clicks: 1, ctr: 0.01, position: 18.0 },
  ],
  pages: [
    { query: 'guest room management system saudi', page: 'https://arak-sa.com/', impressions: 412, clicks: 0, ctr: 0, position: 22.4 },
    { query: 'facade lighting riyadh', page: 'https://arak-sa.com/services/facade', impressions: 233, clicks: 0, ctr: 0, position: 12.1 },
    { query: 'smart pole manufacturer saudi arabia', page: 'https://arak-sa.com/products/smart-poles', impressions: 151, clicks: 2, ctr: 0.01, position: 20.3 },
    { query: 'dali lighting control', page: 'https://arak-sa.com/ar/services/lighting-controls', impressions: 77, clicks: 0, ctr: 0, position: 9.4 },
    { query: 'energy management system buildings', page: 'https://arak-sa.com/', impressions: 64, clicks: 0, ctr: 0, position: 26.8 },
    { query: 'arak lighting', page: 'https://arak-sa.com/', impressions: 340, clicks: 41, ctr: 0.12, position: 1.4 },
  ],
}

const SEARCH_UNCONFIGURED = {
  ok: true, configured: false, site: '', error: 'GOOGLE_SA_KEY is not set.',
  setup: [
    'Create a Google Cloud service account and download its JSON key.',
    'In Search Console, add that service account\'s client_email as a Full user on the property.',
    'Put the JSON in GOOGLE_SA_KEY on this deployment (raw or base64).',
    'Set customFields.website on the Brand Brain to the verified property, e.g. sc-domain:example.com.',
  ],
}

const SEARCH_BROKEN = {
  ok: false, configured: true, site: 'sc-domain:arak-sa.com',
  error: 'Google returned 403: the service account is not a user on this property.',
}

const scheduledPost = (id, platform, dayOffset, caption, publish_status = 'scheduled') => ({
  id, platform, caption, publish_status, post_table: 'generated_posts',
  scheduled_publish_at: dayOffset === null ? null
    : new Date(Date.now() + dayOffset * 86_400_000).toISOString(),
  image_url: '', image_urls: [],
})

const UPCOMING = [
  scheduledPost('u1', 'instagram', 1, 'Villa facade — the warm wash shot from the Diriyah job'),
  scheduledPost('u2', 'linkedin', 2, 'Case study: GRMS retrofit across 240 hotel keys'),
  scheduledPost('u3', 'instagram', 4, 'Smart pole install timelapse'),
  scheduledPost('u4', 'tiktok', 6, 'Before/after: the mosque courtyard relight'),
  scheduledPost('u5', 'instagram', 8, 'Product close-up — the new IP66 linear range'),
  scheduledPost('u6', 'linkedin', 11, 'We are hiring: lighting design engineer, Riyadh'),
  scheduledPost('u7', 'instagram', 13, 'Behind the scenes at the photometric lab'),
]

const TRAY = [
  scheduledPost('t1', 'instagram', null, 'Draft — no slot booked yet', 'not_published'),
  scheduledPost('t2', 'linkedin', null, 'Failed to publish: the token expired mid-send', 'failed'),
]

// ─── The stub ──────────────────────────────────────────────────────────────
// Matched on the URL, exactly as the real routes are addressed. Anything not
// matched answers 404 loudly rather than silently resolving to {} — a stub
// that quietly satisfies an unexpected call is how a harness comes to prove
// something the real app does not do.
function installFetch(scenario) {
  const json = body => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)),
  })

  window.fetch = async (input, init = {}) => {
    const url = String(input)
    const body = init.body ? JSON.parse(init.body) : {}

    if (url.includes('/api/zernio/accounts')) {
      return json({ ok: true, accounts: scenario === 'empty' ? [] : ACCOUNTS, profile_id: 'profile-1' })
    }
    if (url.includes('/api/zernio/analytics')) {
      const acct = ACCOUNTS.find(a => a.zernio_account_id === body.account_id)
      const res = analyticsFor(acct?.platform || 'instagram')
      // A real network answer is never instant, and the per-platform staggering
      // is what makes the partial-render path visible.
      await new Promise(r => setTimeout(r, acct?.platform === 'linkedin' ? 900 : 300))
      return json(res.error ? { ok: false, error: res.error } : { ok: true, ...res })
    }
    if (url.includes('/api/zernio/sync')) {
      await new Promise(r => setTimeout(r, 600))
      return json({ ok: true, accounts: ACCOUNTS, synced: [], synced_at: new Date().toISOString() })
    }
    if (url.includes('/api/agent/search')) {
      await new Promise(r => setTimeout(r, 500))
      return json(scenario === 'no-gsc' ? SEARCH_UNCONFIGURED
        : scenario === 'broken-gsc' ? SEARCH_BROKEN
        : SEARCH_OK)
    }
    if (url.includes('/rest/v1/scheduled_posts')) {
      await new Promise(r => setTimeout(r, 400))
      if (scenario === 'empty') return json([])
      return json(url.includes('scheduled_publish_at=is.null') ? TRAY : UPCOMING)
    }
    if (url.includes('/rest/v1/research_runs')) {
      await new Promise(r => setTimeout(r, 350))
      return json(
        scenario === 'no-research' || scenario === 'empty' ? []
          : scenario === 'capped' ? RESEARCH_RUNS.slice(0, 2)
          : RESEARCH_RUNS)
    }
    if (url.includes('/rest/v1/social_accounts')) {
      return json(scenario === 'empty' ? [] : ACCOUNTS)
    }
    // Supabase auth, which useConnectedAccounts asks for a session from.
    if (url.includes('/auth/v1/')) return json({ data: { session: null } })

    console.warn('[harness] unstubbed fetch', url)
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not stubbed' }) })
  }
}

const SCENARIOS = [
  { key: 'full', label: 'Everything connected' },
  { key: 'no-gsc', label: 'Search Console not set up' },
  { key: 'broken-gsc', label: 'Search Console failing' },
  { key: 'capped', label: 'Run hit the budget cap' },
  { key: 'no-research', label: 'Research never run' },
  { key: 'empty', label: 'Nothing connected' },
]

// Exported so Fast Refresh can swap it: a file with no exports at all
// falls back to a full page reload on every edit, which loses the scenario.
export function DashboardHarness() {
  const [scenario, setScenario] = useState('full')

  installFetch(scenario)

  const auth = {
    // A distinct workspace id per scenario, so the accounts store (which
    // caches per workspace and answers from memory first) cannot serve the
    // previous scenario's list into the next one.
    activeWorkspaceId: `00000000-0000-0000-0000-00000000000${SCENARIOS.findIndex(s => s.key === scenario) + 1}`,
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
            <span className="eyebrow">Dashboard harness</span>
            {SCENARIOS.map(s => (
              <button key={s.key} onClick={() => setScenario(s.key)}
                className={`text-xs px-2.5 py-1.5 border transition-colors
                  ${scenario === s.key ? 'border-stone-400 bg-surface-subtle text-text font-semibold' : 'border-border text-text-tertiary hover:text-text'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="p-6">
            {/* Keyed on the scenario so every hook remounts and refetches. */}
            <Dashboard key={scenario} />
          </div>
        </div>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<DashboardHarness />)
