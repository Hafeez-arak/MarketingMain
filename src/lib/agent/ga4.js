// ─── GA4: the half of the website Search Console cannot see ────────────────
//
// Search Console stops at the click. It knows what someone searched, where we
// ranked and whether they chose us — and then the story ends, because the next
// thing that happens happens on our site, which is not Google's to report.
// GA4 starts exactly there: how many people arrived, by which route, what they
// read, how long they stayed and whether they did the thing the page exists to
// make them do.
//
// Neither is a substitute for the other and neither should be quoted as the
// other. Search Console clicks and GA4 sessions will NEVER agree — a click is
// Google's count of a result being chosen, a session is our tag's count of a
// visit, and the gap between them is ad blockers, consent refusals, bots,
// redirects, people who leave before the tag fires, and one person clicking
// twice. Putting the two numbers side by side without saying so invites a
// reader to treat the difference as a bug, which is the same failure the two
// engagement rates on the social page already cost this project.
//
// This module is PURE. It builds request bodies, normalises rows and does the
// arithmetic. The signed JWT and the fetch live in api/agent/_ga4.js, the same
// split as searchConsole.js, for the same reason.

const str = v => String(v ?? '').trim()
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Read-only. We report on the property; we never write to it. */
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
export const GA4_API = 'https://analyticsdata.googleapis.com/v1beta'

/**
 * The property path the Data API wants, which is a NUMBER — not the G- tag.
 *
 * This is the single most common way a GA4 integration fails on the first try,
 * and it fails confusingly: `G-ABC123XYZ` is the MEASUREMENT ID, the thing
 * that appears in the snippet on the website and the only GA4 identifier most
 * people have ever seen. The Data API has never accepted it. Handed one, the
 * API answers 400 with a message about an invalid resource name, which reads
 * like a bug in this code rather than the wrong number pasted in a settings
 * field.
 *
 * So a measurement ID is detected and named, rather than passed through to
 * produce a mystery. The property id is the 9-ish digit number in GA4 under
 * Admin → Property settings, and it is also in the URL as `p123456789`.
 *
 * @returns {{path: string, error: string}}
 */
export function propertyPath(id) {
  const s = str(id)
  if (!s) return { path: '', error: '' }
  if (/^G-/i.test(s)) {
    return {
      path: '',
      error: `"${s}" is a Measurement ID, not a Property ID. The Data API needs the numeric property id — ` +
        'find it in GA4 under Admin → Property settings, or in the GA4 URL as p123456789.',
    }
  }
  const digits = s.replace(/^properties\//i, '').replace(/^p/i, '')
  if (!/^\d+$/.test(digits)) {
    return { path: '', error: `"${s}" is not a GA4 property id. It should be digits only, e.g. 123456789.` }
  }
  return { path: `properties/${digits}`, error: '' }
}

/**
 * One runReport body.
 *
 * `keepEmptyRows` is deliberately false everywhere except the date series. A
 * channel that sent nobody is not a row worth drawing; a DAY that sent nobody
 * very much is, because a line chart that skips empty days draws a rise that
 * did not happen.
 */
export function reportBody({
  start, end, dimensions = [], metrics = [], limit = 25, orderBy = '', desc = true, keepEmptyRows = false,
} = {}) {
  const body = {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: dimensions.map(name => ({ name })),
    metrics: metrics.map(name => ({ name })),
    limit: Math.min(Math.max(1, num(limit) || 25), 100_000),
    keepEmptyRows,
  }
  if (orderBy) {
    body.orderBys = [dimensions.includes(orderBy)
      ? { dimension: { dimensionName: orderBy }, desc }
      : { metric: { metricName: orderBy }, desc }]
  }
  return body
}

/**
 * GA4's `date` dimension has no dashes in it.
 *
 * It arrives as `20260917`. Everything else in this app — Search Console rows,
 * the chart axes, `windowLabel` — speaks `2026-09-17`, and a series keyed one
 * way plotted against an axis keyed the other silently draws nothing at all
 * rather than throwing. Converted once, here, at the boundary.
 */
export function isoDate(value) {
  const s = str(value)
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}

/**
 * Turn a runReport response into plain named rows.
 *
 * Dimension and metric values arrive in two parallel arrays with their names
 * in the headers, so nothing can be read positionally without the headers in
 * hand. Metrics come back as STRINGS, including the floats — `engagementRate`
 * is `"0.6341463414634146"` — and a string that looks like a number survives
 * every arithmetic operation in JavaScript except the one that matters
 * (`+`), so they are all cast here rather than at each call site.
 */
export function normalizeReport(res = {}) {
  const dims = (res.dimensionHeaders || []).map(h => str(h.name))
  const mets = (res.metricHeaders || []).map(h => str(h.name))
  return (res.rows || []).map(r => {
    const out = {}
    dims.forEach((d, i) => {
      const v = str(r.dimensionValues?.[i]?.value)
      out[d] = d === 'date' ? isoDate(v) : v
    })
    mets.forEach((m, i) => { out[m] = num(r.metricValues?.[i]?.value) })
    return out
  })
}

/** The single totals row a no-dimension report returns, or zeroes. */
export function totalsOf(rows = [], metrics = []) {
  const row = rows[0] || {}
  const out = {}
  for (const m of metrics) out[m] = num(row[m])
  return out
}

// ─── What the page asks for ────────────────────────────────────────────────
//
// Named here rather than inline in the route so the metric list is one thing
// to read, and so a test can assert that every report asks for metrics that
// exist. GA4 renamed `conversions` to `keyEvents` in 2025 and left the old
// name erroring rather than aliased, which is the kind of change that turns a
// working panel into an empty one with no message anywhere.

export const TOTAL_METRICS = [
  'sessions', 'totalUsers', 'newUsers', 'screenPageViews',
  'engagedSessions', 'engagementRate', 'bounceRate', 'averageSessionDuration',
]

/**
 * Every report the Analytics page's GA4 half draws.
 *
 * `optional: true` marks a report whose failure is expected on some properties
 * and must not be treated as a broken connection — `keyEvents` is the case
 * this exists for: a property with no key events configured is a normal,
 * common state, and the panel should say "nothing is marked as a key event"
 * rather than "GA4 did not answer".
 */
export function reportPlan({ current, previous } = {}) {
  return [
    { id: 'totals', body: reportBody({ ...current, metrics: TOTAL_METRICS }) },
    { id: 'previousTotals', body: reportBody({ ...previous, metrics: TOTAL_METRICS }) },
    {
      id: 'daily',
      body: reportBody({
        ...current, dimensions: ['date'], metrics: ['sessions', 'totalUsers', 'screenPageViews'],
        orderBy: 'date', desc: false, limit: 400,
        // The one report that keeps its empty rows — see reportBody.
        keepEmptyRows: true,
      }),
    },
    {
      id: 'channels',
      body: reportBody({
        ...current, dimensions: ['sessionDefaultChannelGroup'],
        metrics: ['sessions', 'totalUsers', 'engagedSessions'], orderBy: 'sessions', limit: 15,
      }),
    },
    {
      id: 'sources',
      body: reportBody({
        ...current, dimensions: ['sessionSourceMedium'],
        metrics: ['sessions', 'totalUsers'], orderBy: 'sessions', limit: 15,
      }),
    },
    {
      // ── The bio link's half of the page ──
      // Source, medium and campaign kept as three dimensions rather than the
      // combined `sessionSourceMedium` above, because the campaign is the only
      // thing that proves a session came from the link in a bio rather than
      // from somebody sharing a post — and `sessionSourceMedium` cannot carry
      // it. Marked optional: a property that has never seen a campaign still
      // answers, but if this one report is rejected the rest of the page must
      // not go with it.
      id: 'social',
      optional: true,
      body: reportBody({
        ...current, dimensions: ['sessionSource', 'sessionMedium', 'sessionCampaignName'],
        metrics: ['sessions', 'totalUsers', 'engagedSessions'], orderBy: 'sessions', limit: 200,
      }),
    },
    {
      id: 'pages',
      body: reportBody({
        ...current, dimensions: ['pagePath'],
        metrics: ['screenPageViews', 'sessions', 'averageSessionDuration'], orderBy: 'screenPageViews', limit: 20,
      }),
    },
    {
      id: 'landings',
      body: reportBody({
        ...current, dimensions: ['landingPage'],
        metrics: ['sessions', 'bounceRate', 'engagementRate'], orderBy: 'sessions', limit: 15,
      }),
    },
    {
      id: 'countries',
      body: reportBody({
        ...current, dimensions: ['country'], metrics: ['sessions', 'totalUsers'], orderBy: 'sessions', limit: 20,
      }),
    },
    {
      id: 'devices',
      body: reportBody({
        ...current, dimensions: ['deviceCategory'], metrics: ['sessions', 'totalUsers', 'engagementRate'],
        orderBy: 'sessions', limit: 10,
      }),
    },
    {
      id: 'events',
      optional: true,
      body: reportBody({
        ...current, dimensions: ['eventName'], metrics: ['eventCount', 'totalUsers'], orderBy: 'eventCount', limit: 15,
      }),
    },
    {
      id: 'keyEvents',
      optional: true,
      body: reportBody({
        ...current, dimensions: ['sessionDefaultChannelGroup'], metrics: ['keyEvents'], orderBy: 'keyEvents', limit: 15,
      }),
    },
  ]
}

// ─── Reading what came back ────────────────────────────────────────────────

/** A change, or null when there is nothing honest to compare against. */
export function delta(now, was, { hasPrevious = true } = {}) {
  if (!hasPrevious) return null
  const a = num(now), b = num(was)
  if (!b) return null
  return a - b
}

/**
 * The GA4 summary the page's tiles show.
 *
 * `hasPrevious` is not "did the previous report succeed" — it is "did the
 * previous window contain anything at all". A property that started collecting
 * three weeks ago has a perfectly successful previous report holding zero
 * sessions, and a tile that renders that as −100% is reporting the tag's
 * installation date as a collapse in traffic. Search Console's half of this
 * page draws the same distinction and calls it `baseline`.
 */
export function ga4Summary({ totals = {}, previousTotals = {} } = {}) {
  const hasPrevious = num(previousTotals.sessions) > 0
  return {
    sessions: num(totals.sessions),
    users: num(totals.totalUsers),
    newUsers: num(totals.newUsers),
    pageViews: num(totals.screenPageViews),
    engagedSessions: num(totals.engagedSessions),
    // GA4 returns these as fractions; the app's `pct()` takes 0..100.
    engagementRate: num(totals.engagementRate) * 100,
    bounceRate: num(totals.bounceRate) * 100,
    avgSessionSeconds: num(totals.averageSessionDuration),
    pagesPerSession: num(totals.sessions) ? num(totals.screenPageViews) / num(totals.sessions) : 0,
    baseline: !hasPrevious,
    previous: {
      sessions: num(previousTotals.sessions),
      users: num(previousTotals.totalUsers),
      pageViews: num(previousTotals.screenPageViews),
    },
    sessionsDelta: delta(totals.sessions, previousTotals.sessions, { hasPrevious }),
    usersDelta: delta(totals.totalUsers, previousTotals.totalUsers, { hasPrevious }),
    pageViewsDelta: delta(totals.screenPageViews, previousTotals.screenPageViews, { hasPrevious }),
  }
}

/**
 * Where GA4 config lives, beside the Search Console property it belongs with.
 *
 * `customFields` again — the same extension point `searchConfig` reads, for
 * the same reason: nothing is inferred and nothing is guessed, because a wrong
 * property id produces an error that looks like a permissions bug.
 */
export function ga4Config(profile = {}) {
  const cf = profile?.customFields || {}
  return propertyPath(cf.ga4_property_id || cf.ga4_property || '')
}

// ─── The bio link: who tapped it, and who actually arrived ─────────────────
//
// Two different numbers, and the whole reason this section exists is that they
// are constantly mistaken for one another:
//
//   · TAPS are Instagram's count of people tapping the link in the bio. They
//     come from Zernio's account insights (`profile_links_taps`), not from
//     here, and Instagram is the only platform that reports them.
//   · ARRIVALS are our tag's count of sessions that started from a social
//     source. That is what this file can see.
//
// Arrivals are always lower — a tap that never finishes loading, an ad
// blocker, a refused consent banner and a back button all sit in the gap. The
// panel must print both with their own names and never subtract one from the
// other, the same rule the two engagement rates on the social page cost this
// project once already.
//
// ── WHY UNTAGGED SOCIAL TRAFFIC IS ITS OWN NUMBER ──
//
// Instagram's in-app browser frequently sends no referrer at all. Those
// sessions land in `(direct) / (none)` and are indistinguishable from someone
// typing the address in — so an untagged bio link UNDER-reports itself, badly,
// and the undercount is invisible. A `utm_campaign` on the link is the only
// thing that survives the in-app browser. So `platformArrivals` counts tagged
// and untagged sessions separately: untagged social traffic is a measurement
// that is known to be incomplete, and the panel says so rather than quoting it
// as the answer.

/** The campaign name the bio link carries. One word, lower case, everywhere. */
export const BIO_CAMPAIGN = 'bio'

/** The medium the bio link carries. `social` is what GA4 files as Organic Social. */
export const BIO_MEDIUM = 'social'

/**
 * The platforms worth naming, and every spelling GA4 reports them under.
 *
 * `exact` holds the link-shortener hosts, which carry no readable name at all
 * — `t.co` and `lnkd.in` tokenize into nothing a keyword could match.
 * `tokens` is matched against the source split on punctuation, so one entry
 * covers `instagram`, `instagram.com`, `l.instagram.com` and `m.instagram.com`
 * at once — GA4 reports all four, depending on how the person got there.
 */
export const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', tokens: ['instagram'], exact: [] },
  { id: 'linkedin', label: 'LinkedIn', tokens: ['linkedin'], exact: ['lnkd.in'] },
  { id: 'facebook', label: 'Facebook', tokens: ['facebook'], exact: ['fb.me', 'fb.com'] },
  { id: 'tiktok', label: 'TikTok', tokens: ['tiktok'], exact: [] },
  { id: 'youtube', label: 'YouTube', tokens: ['youtube'], exact: ['youtu.be'] },
  { id: 'x', label: 'X (Twitter)', tokens: ['twitter'], exact: ['x.com', 't.co', 'x'] },
  { id: 'whatsapp', label: 'WhatsApp', tokens: ['whatsapp'], exact: ['wa.me', 'chat.whatsapp.com'] },
  { id: 'snapchat', label: 'Snapchat', tokens: ['snapchat'], exact: [] },
  { id: 'pinterest', label: 'Pinterest', tokens: ['pinterest'], exact: [] },
  { id: 'telegram', label: 'Telegram', tokens: ['telegram'], exact: ['t.me'] },
]

/** Which platform a GA4 source string belongs to, or null for everything else. */
export function platformOf(source) {
  const s = str(source).toLowerCase()
  if (!s) return null
  const parts = s.split(/[^a-z0-9]+/).filter(Boolean)
  for (const p of SOCIAL_PLATFORMS) {
    if (p.exact.includes(s)) return p
    if (p.tokens.some(t => parts.includes(t))) return p
  }
  return null
}

// GA4's ways of saying "there was no campaign on this link". All four are
// real values it returns, and all four mean untagged.
const NO_CAMPAIGN = new Set(['', '(not set)', '(direct)', '(organic)', '(referral)', '(none)'])

/** Did this session arrive on a link somebody tagged? */
export function isTagged(campaign) {
  return !NO_CAMPAIGN.has(str(campaign).toLowerCase())
}

/**
 * Is this the bio link?
 *
 * `startsWith` rather than equality so `bio`, `bio-2026` and `bio_ramadan` all
 * count — a campaign name gets dated the first time somebody runs a second
 * link, and a panel that stopped counting on that day would read as a collapse
 * in bio traffic rather than a rename.
 */
export function isBioCampaign(campaign) {
  return str(campaign).toLowerCase().startsWith(BIO_CAMPAIGN)
}

/**
 * Social arrivals, one row per platform.
 *
 * Takes the `social` report's rows (sessionSource × sessionMedium ×
 * sessionCampaignName). Everything that is not a social source is dropped
 * here rather than filtered in the query, because GA4's filter syntax cannot
 * express "any of these ten hosts, however they are spelled" without ten
 * clauses that would then live in two places.
 */
export function platformArrivals(rows = []) {
  const by = new Map()
  for (const r of rows) {
    const p = platformOf(r.sessionSource)
    if (!p) continue
    const row = by.get(p.id) || {
      id: p.id, label: p.label, sessions: 0, users: 0, engagedSessions: 0,
      bioSessions: 0, taggedSessions: 0, untaggedSessions: 0, sources: [],
    }
    const sessions = num(r.sessions)
    row.sessions += sessions
    row.users += num(r.totalUsers)
    row.engagedSessions += num(r.engagedSessions)
    if (isBioCampaign(r.sessionCampaignName)) row.bioSessions += sessions
    if (isTagged(r.sessionCampaignName)) row.taggedSessions += sessions
    else row.untaggedSessions += sessions
    const source = str(r.sessionSource)
    if (source && !row.sources.includes(source)) row.sources.push(source)
    by.set(p.id, row)
  }
  return [...by.values()].sort((a, b) => b.sessions - a.sessions)
}

/** The one-line verdict the panel leads with. */
export function arrivalsSummary(rows = []) {
  const sessions = rows.reduce((n, r) => n + num(r.sessions), 0)
  const tagged = rows.reduce((n, r) => n + num(r.taggedSessions), 0)
  const bio = rows.reduce((n, r) => n + num(r.bioSessions), 0)
  return {
    sessions,
    users: rows.reduce((n, r) => n + num(r.users), 0),
    tagged,
    bio,
    untagged: sessions - tagged,
    // Nothing tagged at all is the state every property starts in, and it is
    // the difference between "social sent 7 people" and "social sent at least
    // 7 people, and we cannot see the rest". Named, not inferred from a zero.
    anyTagged: tagged > 0,
  }
}

/**
 * The site as a link, from whatever Search Console calls it.
 *
 * The property is usually `sc-domain:arak-sa.com`, which is not a URL and
 * cannot be pasted into an Instagram bio. This is the one place that turns it
 * back into one.
 */
export function siteOrigin(site) {
  const s = str(site).replace(/^sc-domain:/i, '')
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s.replace(/\/+$/, '')
  return `https://${s.replace(/\/+$/, '')}`
}

/**
 * The tagged link to paste into a profile's bio.
 *
 * Built here rather than typed by hand in the panel because the three
 * parameters have to agree with what `platformArrivals` looks for — a link
 * carrying `utm_medium=referral` or a capitalised source would be counted as
 * a different platform, or not counted at all, and nothing on screen would
 * say why.
 */
export function bioLink(site, source, { campaign = BIO_CAMPAIGN, path = '/' } = {}) {
  const origin = siteOrigin(site)
  const src = str(source).toLowerCase()
  if (!origin || !src) return ''
  const p = path.startsWith('/') ? path : `/${path}`
  const q = new URLSearchParams({ utm_source: src, utm_medium: BIO_MEDIUM, utm_campaign: campaign })
  return `${origin}${p}?${q.toString()}`
}
