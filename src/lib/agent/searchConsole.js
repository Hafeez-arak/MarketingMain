// ─── Search Console: the only first-party demand signal the agent has ──────
//
// Every other lens infers what buyers want from something second-hand — what a
// rival posted, what a trade magazine wrote, what a tender portal listed.
// Search Console is people typing what they actually want, in their own words,
// in Arabic and English, on the way to our own site. Nothing else in this run
// is that direct, which is why it is worth a lens of its own rather than a few
// extra rows folded into `ourselves`.
//
// This module is PURE. It builds request bodies, normalises the rows that come
// back, and decides what is worth reporting. The signed JWT, the token
// exchange and the fetch live in api/agent/_searchConsole.js, because that is
// the half that needs a key and a network.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ──
//
// arak-sa.com had 122 web-search clicks in a quarter when this was written. At
// that volume a click count is noise: 3 → 6 is not a doubling, it is two
// people. An agent handed thin numbers and asked what changed will find
// something to say every single week, and all of it will be false — the same
// failure the "do not compare two things measured differently" rule in the
// synthesis prompt already guards against.
//
// So the numbers this module will narrate are IMPRESSIONS, QUERY TEXT and
// POSITION, which are stable at low volume and are the useful half anyway.
// "We appeared 400 times for 'guest room management system Saudi' at position
// 14 and got no clicks" is a content brief, and it does not need a single
// click to be true. Click movement is reported only above NARRATABLE_CLICKS,
// and below it the finding says so rather than going quiet.

const str = v => String(v ?? '').trim()
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Read-only. We never ask for more than we use, and indexing is not our job. */
export const SC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

export const SC_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const SC_API = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

/**
 * The property id the API wants, which is NOT a URL.
 *
 * A Domain property — the kind arak-sa.com is verified as — is addressed as
 * `sc-domain:arak-sa.com`. Handing it `https://arak-sa.com/` instead returns a
 * 403 that reads like a permissions problem and is not one, which is a very
 * expensive hour to spend. A caller that already has the `sc-domain:` form
 * gets it back untouched so a URL-prefix property can still be passed whole.
 */
export function propertyId(site) {
  const s = str(site)
  if (!s) return ''
  if (/^sc-domain:/i.test(s)) return s
  // A full URL means a URL-prefix property, and those really are addressed by
  // URL. Only a bare hostname becomes a domain property.
  if (/^https?:\/\//i.test(s)) return s
  return `sc-domain:${s.replace(/^www\./i, '')}`
}

// ─── Windows ───────────────────────────────────────────────────────────────

/**
 * Search Console data is not final for the last few days.
 *
 * Fresh rows keep arriving for roughly two days after the fact, so a window
 * ending today always reads as a decline — and a weekly agent would report
 * that decline every week, forever, as news. Ending three days back costs
 * three days of recency and removes a permanent false trend.
 */
export const DATA_LAG_DAYS = 3

/**
 * 28 days, not 7.
 *
 * At this site's volume a 7-day window is mostly zeroes, and a comparison
 * between two mostly-zero weeks is noise with a percentage sign on it. 28 days
 * against the previous 28 is the shortest window where a change in impressions
 * means anything. It also matches four whole weeks, so a weekday effect cannot
 * masquerade as a trend.
 */
export const WINDOW_DAYS = 28

const iso = d => d.toISOString().slice(0, 10)
const shift = (d, days) => new Date(d.getTime() + days * 86_400_000)

export function searchWindows(now = new Date(), { days = WINDOW_DAYS, lag = DATA_LAG_DAYS } = {}) {
  const end = shift(new Date(now), -lag)
  const start = shift(end, -(days - 1))
  const prevEnd = shift(start, -1)
  const prevStart = shift(prevEnd, -(days - 1))
  return {
    days,
    current: { start: iso(start), end: iso(end) },
    previous: { start: iso(prevStart), end: iso(prevEnd) },
  }
}

/**
 * One searchAnalytics.query body.
 *
 * `rowLimit` is capped at the API's own 25,000 and defaulted far below it: a
 * site with 44 pages does not have 25,000 distinct queries, and asking for
 * them makes a slow call that returns a long tail of single impressions
 * nobody will ever act on.
 */
export function queryBody({ start, end, dimensions = ['query'], rowLimit = 500, type = 'web' } = {}) {
  return {
    startDate: start,
    endDate: end,
    dimensions,
    rowLimit: Math.min(Math.max(1, num(rowLimit) || 500), 25_000),
    type,
    // Anonymised queries are withheld by Google anyway; asking for all data
    // rather than the default keeps page and query totals reconcilable.
    dataState: 'final',
  }
}

/** Turn the API's positional `keys` array back into named fields. */
export function normalizeRows(rows = [], dimensions = ['query']) {
  return (rows || []).map(r => {
    const out = {
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      ctr: num(r.ctr),
      position: num(r.position),
    }
    dimensions.forEach((d, i) => { out[d] = str(r.keys?.[i]) })
    return out
  })
}

// ─── Business lines ────────────────────────────────────────────────────────
//
// Nothing here knows what lighting is, for the same reason lenses.js does not:
// one system serves Arak, Aqeeq and Alo Kheyatah, and the moment a line is
// hardcoded the other two inherit a toggle that means nothing to them. The
// lines come from the brand's own configuration, and a brand that has not set
// any gets findings with no line on them rather than a guess.
//
// The configuration is one text field, one line per business line:
//
//     controls | Controls & automation | /services/lighting-controls, knx, dali, grms
//     lighting | Lighting | /services/indoor-lighting, /services/facade, luminaire
//
// key | Label | comma-separated patterns. A pattern beginning with "/" is
// matched against the landing page's path; anything else is matched against
// the query text as a whole word. Both are lowercased first.

export function parseLines(text) {
  return str(text)
    .split('\n')
    .map(row => {
      const [key, label, patterns] = row.split('|').map(s => str(s))
      if (!key) return null
      return {
        key: key.toLowerCase().replace(/\s+/g, '_'),
        label: label || key,
        paths: (patterns || '').split(',').map(s => str(s).toLowerCase()).filter(p => p.startsWith('/')),
        words: (patterns || '').split(',').map(s => str(s).toLowerCase()).filter(p => p && !p.startsWith('/')),
      }
    })
    .filter(Boolean)
}

/** The path of a landing page, language prefix removed so /ar/x matches /x. */
export function pathOf(url) {
  const s = str(url)
  if (!s) return ''
  let path
  try { path = new URL(s).pathname } catch { path = s.replace(/^https?:\/\/[^/]+/i, '') }
  return path.toLowerCase().replace(/^\/(ar|en)(?=\/|$)/, '') || '/'
}

/**
 * Which line a row belongs to.
 *
 * The landing page decides it when it can, because a URL is a fact and a
 * keyword match is an opinion — /services/lighting-controls IS the controls
 * business whatever words the searcher used. Query words are the fallback for
 * the case that matters most: a query that landed on the homepage because the
 * page it deserved does not exist yet.
 *
 * Returns '' rather than a default line. An unlabelled finding is honest; a
 * finding filed under the wrong business is worse than no filing at all,
 * because someone will act on it.
 */
export function lineOf(row = {}, lines = []) {
  if (!lines.length) return ''
  const path = pathOf(row.page)
  if (path && path !== '/') {
    for (const l of lines) {
      if (l.paths.some(p => path.startsWith(p))) return l.key
    }
  }
  const q = str(row.query).toLowerCase()
  if (q) {
    for (const l of lines) {
      if (l.words.some(w => w && q.includes(w))) return l.key
    }
  }
  return ''
}

/**
 * Give each query row the landing page it actually resolves to.
 *
 * Query-dimension rows carry no page, so without this every query would be
 * classified by keyword alone — and keywords are the weak signal. The page
 * rows already fetched hold the answer: for each query, the page that took the
 * most impressions is the one Google is ranking. Joining them means a query
 * lands in the right business line because of where it WENT, not because of
 * which words it happened to contain.
 */
export function attachPages(queries = [], pages = []) {
  const best = new Map()
  for (const r of pages) {
    const cur = best.get(r.query)
    if (!cur || r.impressions > cur.impressions) best.set(r.query, r)
  }
  return queries.map(r => (r.page ? r : { ...r, page: best.get(r.query)?.page || '' }))
}

/** Roll impressions and clicks up per line, so a report can show the balance. */
export function lineTotals(rows = [], lines = []) {
  const totals = new Map(lines.map(l => [l.key, { key: l.key, label: l.label, clicks: 0, impressions: 0, queries: 0 }]))
  totals.set('', { key: '', label: 'Unclassified', clicks: 0, impressions: 0, queries: 0 })
  for (const r of rows) {
    const t = totals.get(lineOf(r, lines))
    if (!t) continue
    t.clicks += r.clicks
    t.impressions += r.impressions
    t.queries += 1
  }
  // Configured lines first, biggest first; the unclassified remainder always
  // last however large it is. Sorting it purely by size put "Unclassified"
  // at the head of the list on the first real data — which reads as the
  // report's own finding rather than as the leftovers, and buries the
  // comparison between the businesses that the roll-up exists to show.
  return [...totals.values()]
    .filter(t => t.queries > 0)
    .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || b.impressions - a.impressions)
}

// ─── Brand queries ─────────────────────────────────────────────────────────
//
// On a small site most clicks are people typing the company's name, and
// counting those as demand makes a brand look like it is winning a category it
// has not entered. Splitting them is the difference between "122 clicks" and
// "18 clicks from people who did not already know us".

export function isBrandQuery(query, brandTerms = []) {
  const q = str(query).toLowerCase()
  if (!q) return false
  return brandTerms.map(t => str(t).toLowerCase()).filter(Boolean).some(t => q.includes(t))
}

export function splitBrand(rows = [], brandTerms = []) {
  const brand = [], nonBrand = []
  for (const r of rows) (isBrandQuery(r.query, brandTerms) ? brand : nonBrand).push(r)
  return { brand, nonBrand }
}

const sum = (rows, k) => rows.reduce((n, r) => n + num(r[k]), 0)
export const totals = rows => ({
  clicks: sum(rows, 'clicks'),
  impressions: sum(rows, 'impressions'),
  queries: rows.length,
})

// ─── What is worth reporting ───────────────────────────────────────────────

/**
 * Below this, a change in clicks is two people changing their minds.
 *
 * Deliberately per-query and deliberately high for a site this size: almost
 * nothing will clear it in the first months, and that is the correct output.
 * A finding that says "clicks moved but the base is too small to read" is
 * worth more than a confident percentage computed from four clicks.
 */
export const NARRATABLE_CLICKS = 10

/** Impressions below this are a rounding error, not an audience. */
export const MIN_IMPRESSIONS = 30

/**
 * Positions 4 to 20 are the only band where a page can be argued into the
 * clicks it is missing.
 *
 * Above 4 with no clicks usually means the query wanted something else and no
 * title rewrite will fix it. Below 20 we are not really competing, and telling
 * marketing to "improve the title" of something on page three is advice that
 * cannot work.
 */
export const WINNABLE = { from: 4, to: 20 }

/**
 * Queries where we are already visible and getting nothing.
 *
 * This is the highest-value thing Search Console produces for a site with
 * almost no traffic, because it does not depend on traffic at all: the
 * impressions prove the demand exists and that Google already considers us a
 * candidate. What is missing is a page that deserves the click.
 */
export function appearingNotWinning(rows = [], { minImpressions = MIN_IMPRESSIONS, band = WINNABLE } = {}) {
  return rows
    .filter(r => r.impressions >= minImpressions && r.clicks === 0 &&
                 r.position >= band.from && r.position <= band.to)
    .sort((a, b) => b.impressions - a.impressions)
}

/**
 * Specific queries whose best landing page is the homepage.
 *
 * The homepage ranking for "guest room management system" is not a win, it is
 * the site telling you a page is missing — Google had nothing more specific of
 * ours to show. Needs rows fetched with both `query` and `page` dimensions.
 *
 * Single-word and brand queries are excluded: the homepage SHOULD win those.
 */
export function homepageCatching(rows = [], brandTerms = [], { minImpressions = MIN_IMPRESSIONS } = {}) {
  return rows
    .filter(r => {
      const path = pathOf(r.page)
      if (path !== '/') return false
      if (r.impressions < minImpressions) return false
      if (isBrandQuery(r.query, brandTerms)) return false
      return str(r.query).split(/\s+/).length >= 2
    })
    .sort((a, b) => b.impressions - a.impressions)
}

/**
 * What moved between the two windows, measured in impressions.
 *
 * Impressions and not clicks, for the reason at the top of this file. A query
 * present in only one window is a genuine arrival or disappearance and is
 * reported as such rather than as a percentage against zero.
 */
export function impressionMovers(current = [], previous = [], { minImpressions = MIN_IMPRESSIONS } = {}) {
  const before = new Map(previous.map(r => [r.query, r]))
  const after = new Map(current.map(r => [r.query, r]))
  const out = []

  for (const r of current) {
    const was = before.get(r.query)
    if (!was) {
      if (r.impressions >= minImpressions) {
        out.push({ query: r.query, state: 'new', impressions: r.impressions, was: 0, position: r.position })
      }
      continue
    }
    // Only judge a change when the LARGER side clears the floor, so a query
    // going 2 → 5 does not arrive as a 150% rise.
    if (Math.max(r.impressions, was.impressions) < minImpressions) continue
    const delta = r.impressions - was.impressions
    if (Math.abs(delta) < minImpressions / 2) continue
    out.push({
      query: r.query,
      state: delta > 0 ? 'rising' : 'falling',
      impressions: r.impressions,
      was: was.impressions,
      delta,
      position: r.position,
      positionWas: was.position,
    })
  }

  for (const r of previous) {
    if (after.has(r.query) || r.impressions < minImpressions) continue
    out.push({ query: r.query, state: 'gone', impressions: 0, was: r.impressions, position: 0 })
  }

  return out.sort((a, b) => Math.abs(b.delta ?? b.impressions ?? b.was) - Math.abs(a.delta ?? a.impressions ?? a.was))
}

/** How a period reads in one line, with the brand split made explicit. */
export function periodSummary(rows = [], brandTerms = [], lines = []) {
  const { brand, nonBrand } = splitBrand(rows, brandTerms)
  return {
    all: totals(rows),
    brand: totals(brand),
    nonBrand: totals(nonBrand),
    byLine: lineTotals(rows, lines),
    thin: totals(rows).clicks < NARRATABLE_CLICKS,
  }
}

const pos = n => (Math.round(num(n) * 10) / 10).toFixed(1)

/**
 * Wrap a search query so the sentence around it survives bidi.
 *
 * Queries arrive in both scripts and get interpolated into English sentences
 * next to numbers. Without isolation the bidi algorithm absorbs an adjacent
 * number into the RTL run, and
 *
 *     We appear for "شركة إنارة واجهات الرياض" 233 times at position 12.1
 *
 * renders as `We appear for "233 شركة إنارة واجهات الرياض" times at position
 * 12.1` — the impression count moves inside the quotes and reads as part of
 * the query. Caught in the harness on 2026-09-16, not in a test: the string is
 * correct and only its DISPLAY is wrong, so nothing but looking at it finds
 * this.
 *
 * U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE is the fix that
 * travels with the text rather than living in a renderer, which matters
 * because these strings are also printed to PDF and read back by the model.
 */
export const isolate = text => `\u2068${str(text)}\u2069`

/**
 * Turn a period into findings, in the raw shape makeFinding() takes.
 *
 * Every finding here carries confidence 1 and no sources, for the same reason
 * a computed calendar date does: its provenance is a measurement we made, not
 * a page somebody read. The citation filter must not mistake that for an
 * unsupported claim — see the note on runCalendarLens.
 */
export function searchFindings({
  queries = [], pages = [], previous = [], brandTerms = [], lines = [], site = '',
} = {}) {
  const out = []
  // Joined first, so every finding below classifies on the page a query
  // actually resolves to rather than on the words in the query.
  const joined = attachPages(queries, pages)
  const summary = periodSummary(joined, brandTerms, lines)
  const host = str(site).replace(/^sc-domain:/, '')

  if (!queries.length) {
    return [{
      headline: `Search Console returned no queries for ${host} in this period.`,
      detail: 'The property answered and had nothing to report. That is a real answer for a site with very ' +
        'little search presence — it is not a failure, and it is not the same as the credential being wrong.',
      confidence: 1,
      relevance: 'medium',
      for_whom: 'marketing',
      channel: 'website',
      category: 'other',
      suggested_action: '',
    }]
  }

  // The shape of demand, first, because every number below is read against it.
  out.push({
    headline: `${summary.all.impressions} search impressions and ${summary.all.clicks} clicks across ` +
      `${summary.all.queries} queries — ${summary.nonBrand.impressions} impressions from people not searching our name.`,
    detail: `Measured by Google, not estimated. Brand queries accounted for ${summary.brand.clicks} of the ` +
      `${summary.all.clicks} clicks. ` +
      (summary.thin
        ? `At this volume click counts are too thin to read as movement — ${NARRATABLE_CLICKS} clicks on a ` +
          'single query is the floor this report will narrate a change from. Impressions and position are ' +
          'the numbers to work with.'
        : 'Click volume is now high enough to read changes per query.'),
    confidence: 1,
    relevance: 'medium',
    for_whom: 'marketing',
    channel: 'website',
    category: 'other',
    suggested_action: '',
    evidence: summary,
  })

  for (const r of appearingNotWinning(joined).slice(0, 5)) {
    out.push({
      headline: `We appear for "${isolate(r.query)}" ${r.impressions} times at position ${pos(r.position)} and get no clicks.`,
      detail: 'Google already treats us as a candidate for this search, so the demand and the ranking both ' +
        'exist. What is missing is a result worth clicking — a title, a description, or a page that answers ' +
        'the query directly instead of a general one that mentions it.',
      confidence: 1,
      relevance: r.impressions >= MIN_IMPRESSIONS * 3 ? 'high' : 'medium',
      for_whom: 'marketing',
      channel: 'website',
      category: 'content',
      suggested_action: `Rewrite the title and meta description for the page ranking on "${isolate(r.query)}", or give ` +
        'the query its own page if the ranking one only mentions it in passing.',
      evidence: r,
    })
  }

  for (const r of homepageCatching(pages, brandTerms).slice(0, 5)) {
    out.push({
      headline: `"${isolate(r.query)}" lands on the homepage — ${r.impressions} impressions with no page of its own.`,
      detail: 'The homepage ranking for a specific, multi-word search is Google saying it had nothing more ' +
        'specific of ours to show. That is a missing page, stated as a measurement rather than as an opinion.',
      confidence: 1,
      relevance: 'high',
      for_whom: 'marketing',
      channel: 'website',
      category: 'content',
      suggested_action: `Write the page this query is asking for, and link it from the service section it belongs to.`,
      evidence: r,
    })
  }

  for (const m of impressionMovers(joined, previous).slice(0, 5)) {
    const moved = m.state === 'new'
      ? `"${isolate(m.query)}" is new this period at ${m.impressions} impressions.`
      : m.state === 'gone'
        ? `"${isolate(m.query)}" stopped appearing — it had ${m.was} impressions last period.`
        : `"${isolate(m.query)}" went ${m.was} → ${m.impressions} impressions.`
    out.push({
      headline: moved,
      detail: 'Measured in impressions rather than clicks, because impressions are stable at this volume and ' +
        'clicks are not. ' + (m.position ? `Average position ${pos(m.position)}.` : ''),
      confidence: 1,
      relevance: 'medium',
      for_whom: 'marketing',
      channel: 'website',
      category: 'other',
      suggested_action: '',
      evidence: m,
    })
  }

  return out
}

// ─── Reading the brand's configuration ─────────────────────────────────────

/**
 * Where the site, the lines and the brand's own names come from.
 *
 * All three live in `customFields`, which is the extension point the Brand
 * Brain already uses for exactly this — `motionOf` reads `sales_motion` the
 * same way. Nothing is inferred from the workspace name or guessed from the
 * brand's prose: a wrong property id produces a 403 that looks like a
 * permissions bug, and a wrong business line produces a finding filed under
 * the wrong team. Both are worse than being unconfigured and saying so.
 */
export function searchConfig(profile = {}, ctx = {}) {
  const cf = profile?.customFields || {}
  const name = str(ctx?.brandName)
  const extra = str(cf.brand_terms).split(',').map(s => str(s)).filter(Boolean)

  const terms = new Set()
  if (name) {
    terms.add(name.toLowerCase())
    // The first word, which is how people actually search for a company —
    // "arak", not "arak lighting solutions". Guarded at four characters so a
    // brand called "The Lighting Company" does not classify every query
    // containing "the" as brand traffic.
    const first = name.split(/\s+/)[0]
    if (first && first.length >= 4) terms.add(first.toLowerCase())
  }
  for (const t of extra) terms.add(t.toLowerCase())

  return {
    site: str(cf.website || cf.site_url),
    lines: parseLines(cf.business_lines),
    brandTerms: [...terms],
  }
}
