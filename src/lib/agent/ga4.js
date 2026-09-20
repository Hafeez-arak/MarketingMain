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
