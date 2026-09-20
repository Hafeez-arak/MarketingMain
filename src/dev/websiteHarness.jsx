import { useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { WebsiteAnalytics } from '../pages/analytics/Website'
import { seoRecommendations } from '../lib/seoAdvice'
import {
  websiteSummary, dailySeries, searchTypes, positionBands, pageRows, hostSplit,
  queryRows, countryRows, deviceRows, appearanceRows, sitemapHealth, queryCoverage,
} from '../lib/analytics/websiteAnalytics'
import { ga4Summary, platformArrivals, arrivalsSummary } from '../lib/agent/ga4'
import fixture from './websiteFixture.json'
import '../index.css'

// ─── Dev-only Website-tab harness ──────────────────────────────────────────
// The Analytics page's Website tab against a RECORDED REAL payload, so it can
// be looked at without signing in, without a workspace, and without spending
// twenty-eight Google requests on every reload.
//
// ── WHY A RECORDING AND NOT INVENTED NUMBERS ──
//
// Because every awkward shape on this page is one the real property actually
// has, and a tidy fixture would verify a page that never had the problem:
//
//   · the previous window is completely EMPTY — the property holds nothing
//     before 2026-08-25 — so every delta must be absent rather than −100%;
//   · the query rows account for 1,310 of 3,312 impressions, because Google
//     withholds the rare ones;
//   · the homepage arrives as four separate URLs across two hosts;
//   · queries are Arabic and English mixed, in one table, next to numbers;
//   · image search is a fifth of all visibility and ranks at 39.9;
//   · the sitemap was last read in February 2025.
//
// Every one of those is a way the page can look wrong while the arithmetic is
// right, and none of them is visible in a unit test.
//
// The states switcher covers what a recording cannot: nobody can un-configure
// a live property to see what the setup steps look like.
//
// Served by Vite at /dev-website.html. Vite only builds index.html, so this
// never reaches a production bundle.

const GA4_LIVE = {
  ok: true,
  configured: true,
  property: 'properties/123456789',
  windows: fixture.search.windows,
  warnings: [],
  // Deliberately NOT reconcilable with Search Console's 147 clicks. The two
  // never agree, the page says so, and a fixture where they matched would hide
  // the one thing this panel most needs to communicate.
  totals: {
    sessions: 118, totalUsers: 94, newUsers: 81, screenPageViews: 274,
    engagedSessions: 71, engagementRate: 0.6016, bounceRate: 0.3983, averageSessionDuration: 74.31,
  },
  previousTotals: { sessions: 0, totalUsers: 0, screenPageViews: 0 },
  daily: dailyGa4(),
  channels: [
    { sessionDefaultChannelGroup: 'Organic Search', sessions: 61, totalUsers: 52, engagedSessions: 40 },
    { sessionDefaultChannelGroup: 'Direct', sessions: 38, totalUsers: 29, engagedSessions: 21 },
    { sessionDefaultChannelGroup: 'Referral', sessions: 12, totalUsers: 9, engagedSessions: 7 },
    { sessionDefaultChannelGroup: 'Organic Social', sessions: 7, totalUsers: 4, engagedSessions: 3 },
  ],
  sources: [
    { sessionSourceMedium: 'google / organic', sessions: 61, totalUsers: 52 },
    { sessionSourceMedium: '(direct) / (none)', sessions: 38, totalUsers: 29 },
    { sessionSourceMedium: 'instagram.com / referral', sessions: 7, totalUsers: 4 },
  ],
  // The state the real property is in today: social traffic arrives, none of
  // it tagged, and the 38 Direct sessions above are hiding an unknown number
  // of bio-link visits Instagram's in-app browser stripped the referrer from.
  social: [
    { sessionSource: 'google', sessionMedium: 'organic', sessionCampaignName: '(organic)', sessions: 61, totalUsers: 52, engagedSessions: 40 },
    { sessionSource: '(direct)', sessionMedium: '(none)', sessionCampaignName: '(direct)', sessions: 38, totalUsers: 29, engagedSessions: 21 },
    { sessionSource: 'l.instagram.com', sessionMedium: 'referral', sessionCampaignName: '(not set)', sessions: 5, totalUsers: 3, engagedSessions: 2 },
    { sessionSource: 'instagram.com', sessionMedium: 'referral', sessionCampaignName: '(not set)', sessions: 2, totalUsers: 1, engagedSessions: 1 },
  ],
  socialAvailable: true,
  pages: [
    { pagePath: '/', screenPageViews: 121, sessions: 96, averageSessionDuration: 61 },
    { pagePath: '/services/smart-poles', screenPageViews: 44, sessions: 31, averageSessionDuration: 88 },
    { pagePath: '/ar', screenPageViews: 39, sessions: 28, averageSessionDuration: 52 },
    { pagePath: '/contact', screenPageViews: 22, sessions: 19, averageSessionDuration: 40 },
  ],
  landings: [
    { landingPage: '/', sessions: 78, bounceRate: 0.41, engagementRate: 0.59 },
    { landingPage: '/services/smart-poles', sessions: 21, bounceRate: 0.28, engagementRate: 0.72 },
  ],
  countries: [
    { country: 'Saudi Arabia', sessions: 84, totalUsers: 67 },
    { country: 'United Arab Emirates', sessions: 11, totalUsers: 9 },
    { country: 'Egypt', sessions: 8, totalUsers: 7 },
  ],
  devices: [
    { deviceCategory: 'desktop', sessions: 69, totalUsers: 55, engagementRate: 0.62 },
    { deviceCategory: 'mobile', sessions: 47, totalUsers: 37, engagementRate: 0.58 },
    { deviceCategory: 'tablet', sessions: 2, totalUsers: 2, engagementRate: 0.5 },
  ],
  events: [
    { eventName: 'page_view', eventCount: 274, totalUsers: 94 },
    { eventName: 'scroll', eventCount: 96, totalUsers: 61 },
    { eventName: 'form_submit', eventCount: 4, totalUsers: 4 },
  ],
  keyEvents: [
    { sessionDefaultChannelGroup: 'Organic Search', keyEvents: 3 },
    { sessionDefaultChannelGroup: 'Direct', keyEvents: 1 },
  ],
  keyEventsAvailable: true,
}

// The same property a fortnight after the tagged link went into the bio: the
// bio campaign is now visible, and the old untagged referrals have not
// vanished — people keep arriving on links shared before the change.
const GA4_TAGGED = {
  ...GA4_LIVE,
  social: [
    { sessionSource: 'google', sessionMedium: 'organic', sessionCampaignName: '(organic)', sessions: 61, totalUsers: 52, engagedSessions: 40 },
    { sessionSource: 'instagram', sessionMedium: 'social', sessionCampaignName: 'bio', sessions: 22, totalUsers: 19, engagedSessions: 14 },
    { sessionSource: 'l.instagram.com', sessionMedium: 'referral', sessionCampaignName: '(not set)', sessions: 4, totalUsers: 3, engagedSessions: 2 },
    { sessionSource: 'linkedin', sessionMedium: 'social', sessionCampaignName: 'bio', sessions: 6, totalUsers: 6, engagedSessions: 4 },
    { sessionSource: 'lnkd.in', sessionMedium: 'referral', sessionCampaignName: '(not set)', sessions: 3, totalUsers: 2, engagedSessions: 1 },
  ],
}

// Instagram's own tap count, and the two ways it is absent. 61 taps against
// 26 tagged arrivals is deliberate: that gap is the point of the panel, and a
// fixture where they agreed would hide the one thing it must communicate.
const TAPS_OK = {
  ok: true, taps: 61, window: { since: '2026-08-23', until: '2026-09-20', days: 28 }, dataDelay: '',
}
const TAPS_CAPPED = {
  ok: false, capped: true, maxDays: 29,
  error: 'Instagram will not report link taps over a window longer than 29 days, so there is no tap count ' +
    'for this one. Choose a shorter window to see it.',
}
const TAPS_NO_ACCOUNT = {
  ok: false, error: 'No Instagram account is connected, so there are no bio-link taps to count.',
}

const BIO = {
  site: 'https://arak-sa.com',
  links: [
    { id: 'instagram', label: 'Instagram', url: 'https://arak-sa.com/?utm_source=instagram&utm_medium=social&utm_campaign=bio' },
    { id: 'linkedin', label: 'LinkedIn', url: 'https://arak-sa.com/?utm_source=linkedin&utm_medium=social&utm_campaign=bio' },
  ],
  taps: TAPS_OK,
}

function dailyGa4() {
  const { start, end } = fixture.search.windows.current
  const out = []
  let t = Date.parse(`${start}T00:00:00Z`)
  const last = Date.parse(`${end}T00:00:00Z`)
  let i = 0
  while (t <= last) {
    const date = new Date(t).toISOString().slice(0, 10)
    const sessions = [0, 0, 2, 5, 3, 6, 4, 8, 5, 3, 7, 6, 4, 9, 5, 2, 6, 4, 3, 8, 5, 4, 7, 3, 2, 5, 6, 4][i] ?? 0
    out.push({ date, sessions, totalUsers: Math.round(sessions * 0.8), screenPageViews: sessions * 2 })
    t += 86_400_000
    i += 1
  }
  return out
}

const STATES = {
  'Live — Search Console, GA4 not connected': { search: fixture.search, ga4: fixture.ga4 },
  'Live — both connected': { search: fixture.search, ga4: GA4_LIVE, bio: BIO },
  'Bio link — tagged, both platforms': { search: fixture.search, ga4: GA4_TAGGED, bio: BIO },
  'Bio link — 90-day window, no taps': {
    search: fixture.search, ga4: GA4_TAGGED, bio: { ...BIO, taps: TAPS_CAPPED },
  },
  'Bio link — no Instagram connected': {
    search: fixture.search, ga4: GA4_TAGGED, bio: { ...BIO, taps: TAPS_NO_ACCOUNT },
  },
  'Bio link — GA4 rejected the social report': {
    search: fixture.search,
    ga4: { ...GA4_LIVE, social: [], socialAvailable: false },
    bio: BIO,
  },
  'Search Console not connected': {
    search: {
      ok: true, configured: false, site: '', error: 'GOOGLE_SA_KEY is not set.',
      setup: [
        'Create a Google Cloud service account and download its JSON key.',
        "In Search Console, add that service account's client_email as a Full user on the property.",
        'Put the JSON in GOOGLE_SA_KEY on this deployment (raw or base64).',
        'Set customFields.website on the Brand Brain to the verified property, e.g. sc-domain:example.com.',
      ],
    },
    ga4: fixture.ga4,
  },
  'Search Console failing': {
    search: {
      ok: false, configured: true, site: 'sc-domain:arak-sa.com',
      error: "User does not have sufficient permission for site 'sc-domain:arak-sa.com' — check that the service " +
        "account's client_email is added as a user in Search Console > Settings > Users and permissions.",
    },
    ga4: fixture.ga4,
  },
  'Configured, but a quiet window': {
    search: {
      ...fixture.search,
      queries: [], previous: [], pages: [], pageTotals: [], previousPageTotals: [],
      countries: [], devices: [], appearance: [], daily: [],
      types: { web: { clicks: 0, impressions: 0, ctr: 0, position: 0, previous: { impressions: 0 } } },
    },
    ga4: fixture.ga4,
  },
  'A panel of the pull failed': {
    search: { ...fixture.search, warnings: [{ part: 'countries', error: 'HTTP 429' }] },
    ga4: fixture.ga4,
  },
  'GA4 misconfigured (measurement id pasted)': {
    search: fixture.search,
    ga4: {
      ...fixture.ga4,
      configError: '"G-ABC123XYZ" is a Measurement ID, not a Property ID. The Data API needs the numeric ' +
        'property id — find it in GA4 under Admin → Property settings, or in the GA4 URL as p123456789.',
    },
  },
  Loading: { loading: true },
}

export function WebsiteHarness() {
  const [name, setName] = useState(Object.keys(STATES)[0])
  const [days, setDays] = useState(28)
  const state = STATES[name]
  const search = state.search
  const ga4 = state.ga4
  // The route returns `bio` on every answer, whatever GA4's state — Instagram
  // counts bio taps on a site carrying no tag at all — so the harness does
  // too. A state that overrides it is testing a specific tap failure.
  const bio = state.loading ? null : (state.bio || BIO)
  const arrivals = platformArrivals(ga4?.social || [])
  const usable = !!search?.ok && !!search?.configured

  // The same derivations useWebsiteAnalytics does, over the same rows. Kept in
  // step by rendering the SAME component the page renders — the tab is a pure
  // function of its props precisely so this is possible.
  const allQueries = useMemo(
    () => (usable ? queryRows(search.queries, search.pages, search.brandTerms, { limit: 10_000 }) : []),
    [usable, search],
  )

  const props = {
    days, setDays, loading: !!state.loading, refreshing: false, refresh: () => {}, error: '',
    search, ga4, bio, usable, arrivals, arrivalsSummary: arrivalsSummary(arrivals),
    summary: usable ? websiteSummary(search) : null,
    daily: usable ? dailySeries(search.daily, search.windows) : [],
    types: usable ? searchTypes(search.types) : [],
    bands: usable ? positionBands(allQueries) : [],
    coverage: usable ? queryCoverage(search.queries, search.types) : null,
    queries: allQueries.slice(0, 25),
    pages: usable ? pageRows(search.pageTotals, search.previousPageTotals, { limit: 15 }) : [],
    hosts: usable ? hostSplit(search.pageTotals, search.site) : [],
    countries: usable ? countryRows(search.countries, { limit: 10 }) : [],
    devices: usable ? deviceRows(search.devices, search.previousDevices) : [],
    appearance: usable ? appearanceRows(search.appearance) : [],
    sitemaps: search?.sitemaps ? sitemapHealth(search.sitemaps, { site: search.site }) : [],
    recommendations: usable ? seoRecommendations({ ...search, limit: 10 }) : [],
    ga4Summary: ga4?.ok && ga4?.configured ? ga4Summary(ga4) : null,
  }

  return (
    <MemoryRouter>
      <div className="min-h-screen bg-surface p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">State</span>
            <select value={name} onChange={e => setName(e.target.value)}
              className="text-xs border border-border bg-white px-2 py-1.5">
              {Object.keys(STATES).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <WebsiteAnalytics {...props} />
        </div>
      </div>
    </MemoryRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<WebsiteHarness />)
