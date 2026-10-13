// ─── The website, read by the agent ────────────────────────────────────────
// The Research page's website section used to be rows: a query, its
// impressions, its position. The owner asked (2026-10-13) for the agent to
// study the site and say what matters: the few numbers worth knowing, what
// they mean, and what to do. Not every number; the Website tab has those.
//
// This file turns Search Console and GA4 into a small fact sheet the model
// can read in one pass, and fixes the shape it answers in. Pure: no network.
// The calling is api/agent/_websiteRead.js, once per run, after the brief.

import { isBrandQuery } from './searchConsole.js'

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const round = (v, places = 1) => Math.round(n(v) * 10 ** places) / 10 ** places
const pct = v => round(n(v) * 100, 1)
const pathOf = url => { try { return new URL(url).pathname || '/' } catch { return String(url || '') } }

function totalsOf(rows = []) {
  const clicks = rows.reduce((t, r) => t + n(r.clicks), 0)
  const impressions = rows.reduce((t, r) => t + n(r.impressions), 0)
  const weighted = rows.reduce((t, r) => t + n(r.position) * n(r.impressions), 0)
  return {
    clicks, impressions,
    ctr_pct: impressions ? pct(clicks / impressions) : 0,
    position: impressions ? round(weighted / impressions) : null,
  }
}

/**
 * The Search Console half. Brand and non-brand are split because "160
 * clicks" means little when most of them typed our name.
 */
export function searchFacts(search = {}, brandTerms = []) {
  if (!search?.ok) return null
  const web = search.types?.web || null
  const queries = search.queries || []
  const brand = queries.filter(r => isBrandQuery(r.query, brandTerms))
  const other = queries.filter(r => !isBrandQuery(r.query, brandTerms))
  const landing = new Map()
  for (const r of search.pages || []) {
    const cur = landing.get(r.query)
    if (!cur || n(r.impressions) > n(cur.impressions)) landing.set(r.query, r)
  }
  return {
    window: search.windows?.current || null,
    previous_window: search.windows?.previous || null,
    web: web ? {
      clicks: n(web.clicks), impressions: n(web.impressions),
      ctr_pct: pct(web.ctr), position: round(web.position),
      previous: web.previous ? {
        clicks: n(web.previous.clicks), impressions: n(web.previous.impressions),
        ctr_pct: pct(web.previous.ctr), position: round(web.previous.position),
      } : null,
    } : totalsOf(queries),
    image_search: search.types?.image ? {
      clicks: n(search.types.image.clicks), impressions: n(search.types.image.impressions),
    } : null,
    searching_our_name: totalsOf(brand),
    not_searching_our_name: totalsOf(other),
    top_other_queries: [...other]
      .sort((a, b) => n(b.impressions) - n(a.impressions))
      .slice(0, 8)
      .map(r => ({
        query: r.query, impressions: n(r.impressions), clicks: n(r.clicks),
        position: round(r.position), lands_on: pathOf(landing.get(r.query)?.page || ''),
      })),
    top_pages: [...(search.pageTotals || [])]
      .sort((a, b) => n(b.impressions) - n(a.impressions))
      .slice(0, 6)
      .map(r => ({ page: pathOf(r.page), impressions: n(r.impressions), clicks: n(r.clicks), position: round(r.position) })),
    devices: (search.devices || []).map(r => ({ device: String(r.device || '').toLowerCase(), clicks: n(r.clicks), impressions: n(r.impressions) })),
  }
}

/**
 * The GA4 half. A previous window that is all zeros before tracking began is
 * "no comparison", never "visits fell to zero" (#138).
 */
export function ga4Facts(ga4 = {}) {
  if (!ga4?.ok) return null
  const t = ga4.totals || {}
  const prev = ga4.previousTotals || {}
  const started = (ga4.collected || []).map(r => r.date).filter(Boolean).sort()[0] || null
  const keyEvents = new Map()
  for (const r of ga4.keyEvents || []) keyEvents.set(r.eventName, (keyEvents.get(r.eventName) || 0) + n(r.keyEvents))
  return {
    window: ga4.windows?.current || null,
    tracking_started: started,
    visits: n(t.sessions),
    visitors: n(t.totalUsers),
    page_views: n(t.screenPageViews),
    engaged_pct: pct(t.engagementRate),
    avg_visit_seconds: Math.round(n(t.averageSessionDuration)),
    previous: n(prev.sessions) > 0 ? { visits: n(prev.sessions), visitors: n(prev.totalUsers) } : null,
    enquiries: [...keyEvents].map(([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count),
    channels: (ga4.channels || []).map(r => ({ channel: r.sessionDefaultChannelGroup, visits: n(r.sessions) })),
    top_sources: (ga4.sources || []).slice(0, 6).map(r => ({ source: r.sessionSourceMedium, visits: n(r.sessions) })),
    top_landing_pages: (ga4.landings || []).slice(0, 6).map(r => ({
      page: r.landingPage, visits: n(r.sessions), bounce_pct: pct(r.bounceRate),
    })),
    countries: (ga4.countries || []).slice(0, 5).map(r => ({ country: r.country, visits: n(r.sessions) })),
  }
}

export function websiteFacts({ search, ga4, brandTerms = [], site = '' } = {}) {
  const s = searchFacts(search, brandTerms)
  const g = ga4Facts(ga4)
  if (!s && !g) return null
  return { site, google_search: s, visits: g }
}

/** What the model answers in. Every field required (structured-output-schema-limits). */
export const WEBSITE_READ_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string', description: 'Two or three sentences: how the website is doing and the one thing that matters most.' },
      numbers: {
        type: 'array',
        description: 'Three to five numbers worth knowing, each taken from the facts.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', description: 'What it is, in a few plain words.' },
            value: { type: 'string', description: 'The number as it should be shown, e.g. "458" or "4.8%".' },
            meaning: { type: 'string', description: 'One short sentence: why it matters or how it moved.' },
          },
          required: ['label', 'value', 'meaning'],
        },
      },
      suggestions: {
        type: 'array',
        description: 'Two or three specific things to do on the website, each tied to a number above.',
        items: { type: 'string' },
      },
    },
    required: ['summary', 'numbers', 'suggestions'],
  },
}

export const WEBSITE_READ_PROMPT = [
  'Below are this brand\'s website facts for the last 28 days: Google Search (what people searched',
  'and where they landed) and site visits (Google Analytics). Read them as a marketer would and',
  'answer in the required shape.',
  '',
  'Rules:',
  '- Every number you give must be in the facts. Do not estimate or invent one.',
  '- Pick the few numbers that matter, not every number. Prefer people who did not search our name',
  '  over people who did, and enquiries over page views.',
  '- When a comparison is null, there is no earlier period to compare with. Do not call it a rise or a fall.',
  '- Suggestions are specific website actions (a page to build, a page to fix, a query to target),',
  '  each pointing at a number. Not general advice.',
  '- Plain words. No jargon like CTR or SERP; say "share of people who clicked".',
].join('\n')

/** The stored read, whatever the model sent back. */
export function normaliseWebsiteRead(raw = {}) {
  const str = v => String(v ?? '').trim()
  return {
    summary: str(raw?.summary),
    numbers: (Array.isArray(raw?.numbers) ? raw.numbers : [])
      .map(x => ({ label: str(x?.label), value: str(x?.value), meaning: str(x?.meaning) }))
      .filter(x => x.label && x.value)
      .slice(0, 6),
    suggestions: (Array.isArray(raw?.suggestions) ? raw.suggestions : []).map(str).filter(Boolean).slice(0, 4),
  }
}
