import { pathOf, isBrandQuery, attachPages, totals, splitBrand, lineOf } from '../agent/searchConsole.js'

// ─── The website, as the Analytics page draws it ───────────────────────────
//
// Arithmetic over rows Google measured. Nothing here asks a model anything, so
// it costs nothing to draw and says the same thing twice in a row — the same
// rule seoAdvice.js runs on, and this module is its sibling: seoAdvice turns
// Search Console into things to DO, and this turns it into things to SEE.
//
// ── WHY THE PRIMITIVES COME FROM agent/searchConsole.js ──
//
// Because the weekly research report, the dashboard card and this page must
// never disagree about what a word means. `pathOf` folds the /ar tree onto its
// English twin, `isBrandQuery` decides what counts as somebody typing our own
// name, and if this file re-derived either one, the first time the two screens
// printed different numbers for "non-brand impressions" nobody would know
// which to believe. One definition, imported.
//
// ── THE RULE ABOUT AN EMPTY PREVIOUS WINDOW ──
//
// Every delta in this file returns null when the previous window holds
// nothing, and NEVER a fall of 100%. arak-sa.com's property has held data only
// since 2026-08-25; asked for the 28 days before that it answers, correctly,
// with nothing. A page that renders that as a collapse is reporting the date
// the property was verified as a catastrophe, every period, until the window
// finally clears it.

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const str = v => String(v ?? '').trim()

/** GSC returns CTR as a fraction; every percentage in this app is 0..100. */
export const asPercent = v => num(v) * 100

/** A change, or null when there is nothing honest to compare against. */
export function change(now, was, hasPrevious) {
  if (!hasPrevious) return null
  return num(now) - num(was)
}

// ─── The daily series ──────────────────────────────────────────────────────

const iso = d => d.toISOString().slice(0, 10)

/** Every ISO day from `start` to `end` inclusive. */
export function daysBetween(start, end) {
  const out = []
  let cur = Date.parse(`${start}T00:00:00Z`)
  const last = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(cur) || !Number.isFinite(last)) return out
  let guard = 0
  while (cur <= last && guard++ < 1000) {
    out.push(iso(new Date(cur)))
    cur += 86_400_000
  }
  return out
}

/**
 * The line chart's rows: one per day across both windows, gaps filled.
 *
 * ── WHY THE GAPS ARE FILLED ──
 *
 * Search Console omits days it has nothing for, so the raw series for this
 * property is 24 rows spanning 56 days. Plotted as-is, a fortnight of silence
 * becomes a single flat segment between two points and the chart draws a site
 * with steady traffic since July. Filling the gaps with real zeroes is the
 * difference between "nothing happened here" and "we did not look".
 *
 * Position is deliberately left NULL on an empty day rather than zeroed.
 * Position 0 does not exist — rank 1 is the best there is — so a zero plots
 * below the best possible value and drags the axis somewhere no measurement
 * could ever be. A missing day has no rank, and the line breaks.
 */
export function dailySeries(daily = [], windows = {}) {
  const start = windows?.previous?.start || windows?.current?.start
  const end = windows?.current?.end
  if (!start || !end) return []
  const by = new Map((daily || []).map(r => [str(r.date), r]))
  const currentStart = windows?.current?.start || start

  return daysBetween(start, end).map(date => {
    const r = by.get(date)
    const impressions = num(r?.impressions)
    return {
      date,
      clicks: num(r?.clicks),
      impressions,
      ctr: asPercent(r?.ctr),
      // No impressions means no rank, not rank zero.
      position: impressions > 0 ? num(r?.position) : null,
      current: date >= currentStart,
    }
  })
}

/** A trailing mean, so a chart of a low-volume site shows shape and not noise. */
export function rollingAverage(rows = [], key = 'impressions', window = 7) {
  return rows.map((r, i) => {
    const slice = rows.slice(Math.max(0, i - window + 1), i + 1)
    const sum = slice.reduce((n, x) => n + num(x[key]), 0)
    return { ...r, [`${key}Avg`]: slice.length ? sum / slice.length : 0 }
  })
}

// ─── Search surfaces ───────────────────────────────────────────────────────

export const TYPE_LABELS = {
  web: 'Web', image: 'Images', video: 'Video', news: 'News', discover: 'Discover',
}

/**
 * Web, image, video, news and Discover side by side.
 *
 * ── WHY THIS PANEL EXISTS ──
 *
 * Because until it did, a fifth of this property's visibility was invisible to
 * every screen in the app. Search Console defaults to `type: 'web'` and
 * nothing here ever passed anything else, so image search — 892 impressions
 * against web's 3,312 on the first pull that asked — was simply absent, along
 * with the fact that it sits at position 39.9 and converts nothing.
 *
 * Surfaces with no impressions in either window are dropped rather than drawn
 * as empty bars: a lighting manufacturer has no Discover presence and a row of
 * zeroes labelled "Discover" is a gap that reads as a failure.
 */
export function searchTypes(types = {}) {
  const rows = Object.entries(types)
    .map(([type, t]) => ({
      type,
      label: TYPE_LABELS[type] || type,
      clicks: num(t.clicks),
      impressions: num(t.impressions),
      ctr: asPercent(t.ctr),
      position: num(t.position) || null,
      previousImpressions: num(t.previous?.impressions),
    }))
    .filter(r => r.impressions > 0 || r.previousImpressions > 0)
    .sort((a, b) => b.impressions - a.impressions)

  const all = rows.reduce((n, r) => n + r.impressions, 0)
  return rows.map(r => ({
    ...r,
    share: all ? (r.impressions / all) * 100 : 0,
    impressionsDelta: change(r.impressions, r.previousImpressions, r.previousImpressions > 0),
  }))
}

/**
 * A path a person can read.
 *
 * ── WHY THIS IS NOT JUST `pathOf` ──
 *
 * Arabic URLs arrive percent-encoded, so half this site's pages render as
 * `/%d8%ae%d8%af%d9%85%d8%a7%d8%aa%d9%86%d8%a7/%d8%a5%d9%86%d8%a7%d8%b1%d8%a9`
 * — sixty characters of hex where a reader needs a page name. Worse, every one
 * of them starts with the same `/%d8%` prefix, so a list of them is a column of
 * identical-looking strings that cannot be told apart at a glance at all.
 *
 * Decoding is display-only and deliberately stays out of `pathOf`: the agent
 * module's paths are used for MATCHING — business-line prefixes, homepage
 * detection, grouping — and matching must be done on one canonical form. Two
 * spellings of the same path, one decoded and one not, would quietly split a
 * page's impressions in half.
 *
 * A malformed escape is left exactly as it arrived rather than throwing;
 * `decodeURIComponent('%zz')` is a URIError, and one bad row on the property
 * must not take the page down.
 */
export function prettyPath(path) {
  const p = str(path)
  if (!p.includes('%')) return p
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

// ─── Pages ─────────────────────────────────────────────────────────────────

/**
 * Pages by impressions, with the host and language variants folded together.
 *
 * ── WHY FOLDING IS NOT OPTIONAL HERE ──
 *
 * A domain property reports every host it covers separately, so this site's
 * homepage arrives as FOUR rows: `https://arak-sa.com/`, `https://arak-sa.com/ar`,
 * `http://www.arak-sa.com/` and `https://www.arak-sa.com/` — 1,955 + 525 + 316
 * + 153 impressions. Listed raw, the top of the table is the same page four
 * times, three of them redirects, and the real second page is pushed off the
 * screen. `pathOf` already folds host and `/ar`, so folding is one group-by.
 *
 * The variants are kept and counted, because "16% of your impressions land on
 * a www URL that redirects" is worth knowing and is invisible once folded.
 */
export function pageRows(pageTotals = [], previousPageTotals = [], { limit = 15 } = {}) {
  const fold = rows => {
    const by = new Map()
    for (const r of rows) {
      const path = pathOf(r.page)
      if (!path) continue
      const cur = by.get(path) || { path, clicks: 0, impressions: 0, weighted: 0, variants: new Set() }
      cur.clicks += num(r.clicks)
      cur.impressions += num(r.impressions)
      cur.weighted += num(r.impressions) * num(r.position)
      cur.variants.add(str(r.page))
      by.set(path, cur)
    }
    return by
  }

  const now = fold(pageTotals)
  const was = fold(previousPageTotals)
  const hasPrevious = was.size > 0

  return [...now.values()]
    .map(p => ({
      path: p.path,
      // The canonical path stays the identity; `label` is the only thing the
      // page prints. Grouping already happened above, on `path`.
      label: prettyPath(p.path),
      clicks: p.clicks,
      impressions: p.impressions,
      ctr: p.impressions ? (p.clicks / p.impressions) * 100 : 0,
      position: p.impressions ? p.weighted / p.impressions : null,
      variants: p.variants.size,
      impressionsDelta: change(p.impressions, was.get(p.path)?.impressions, hasPrevious),
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
}

/**
 * Impressions landing on a host that only redirects.
 *
 * Not a fault — a 301 from `www` to the apex is correct and Search Console
 * keeps reporting the old host for as long as anything still links to it. It
 * is worth stating because it is the honest explanation for a chunk of
 * impressions that appear to come from a page that does not exist, and because
 * it tells you which host your backlinks actually point at.
 */
export function hostSplit(pageTotals = [], site = '') {
  const canonical = str(site).replace(/^sc-domain:/, '').replace(/^www\./, '').toLowerCase()
  const by = new Map()
  for (const r of pageTotals) {
    let host
    try { host = new URL(r.page).host.toLowerCase() } catch { continue }
    const cur = by.get(host) || { host, impressions: 0, clicks: 0 }
    cur.impressions += num(r.impressions)
    cur.clicks += num(r.clicks)
    by.set(host, cur)
  }
  const all = [...by.values()].reduce((n, h) => n + h.impressions, 0)
  return [...by.values()]
    .map(h => ({
      ...h,
      share: all ? (h.impressions / all) * 100 : 0,
      canonical: canonical ? h.host.replace(/^www\./, '') === canonical && !h.host.startsWith('www.') : false,
    }))
    .sort((a, b) => b.impressions - a.impressions)
}

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * The query table, brand-marked rather than brand-filtered.
 *
 * Marked and not filtered because both halves are worth reading and they are
 * read differently: a brand query at position 2 with a 48% click rate is the
 * site working exactly as it should, and a non-brand query at position 24 with
 * 233 impressions and no clicks is the work. Hiding either one leaves a table
 * that cannot answer the question it is on the page to answer.
 */
export function queryRows(queries = [], pages = [], brandTerms = [], { limit = 25 } = {}) {
  return attachPages(queries, pages)
    .map(r => ({
      query: r.query,
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      ctr: asPercent(r.ctr),
      position: num(r.position),
      page: prettyPath(pathOf(r.page)),
      brand: isBrandQuery(r.query, brandTerms),
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
}

/**
 * Where our visibility actually sits, in impressions per rank band.
 *
 * ── WHY BANDS AND NOT AN AVERAGE POSITION ──
 *
 * "Average position 16.3" is one number that describes no page on the site.
 * It is the mean of a site that ranks 2nd for its own name and 24th for
 * everything it sells, and it moves when either half moves, in a direction
 * that tells you nothing about which. The bands separate them: they say how
 * much of the demand we are visible for is on page one, how much is on page
 * two or three where a rewrite cannot help, and how much is nowhere.
 *
 * The boundaries are Google's own, not ours — ten blue links to a page, so
 * 1-3 is above the fold, 4-10 is page one, 11-20 is page two.
 */
export const POSITION_BANDS = [
  { key: 'top3', label: 'Positions 1–3', from: 0, to: 3.5, note: 'Above the fold' },
  { key: 'page1', label: 'Positions 4–10', from: 3.5, to: 10.5, note: 'Page one' },
  { key: 'page2', label: 'Positions 11–20', from: 10.5, to: 20.5, note: 'Page two' },
  { key: 'page3', label: 'Positions 21–30', from: 20.5, to: 30.5, note: 'Page three' },
  // A finite ceiling rather than Infinity: these bands are handed straight
  // to a chart and `JSON.stringify(Infinity)` is `null`, which would make the
  // last band silently stop matching anything the day this crosses a wire.
  { key: 'beyond', label: 'Past position 30', from: 30.5, to: 1e6, note: 'Not competing yet' },
]

export function positionBands(rows = []) {
  const buckets = POSITION_BANDS.map(b => ({ ...b, impressions: 0, clicks: 0, queries: 0 }))
  for (const r of rows) {
    const p = num(r.position)
    if (!p) continue
    const b = buckets.find(x => p > x.from && p <= x.to)
    if (!b) continue
    b.impressions += num(r.impressions)
    b.clicks += num(r.clicks)
    b.queries += 1
  }
  const all = buckets.reduce((n, b) => n + b.impressions, 0)
  return buckets.map(b => ({ ...b, share: all ? (b.impressions / all) * 100 : 0 }))
}

/**
 * How much of the property's visibility the query table can actually account for.
 *
 * ── WHY THIS NUMBER HAS TO BE ON THE PAGE ──
 *
 * Google withholds queries that too few people searched, to stop a rare query
 * identifying the person who typed it. Those impressions still count in the
 * totals — they are simply not attributable to any query it will name. On this
 * property the effect is not marginal: 202 named queries hold 1,310
 * impressions against a web total of 3,312, so SIXTY PERCENT of our visibility
 * has no query attached to it.
 *
 * Without this stated, the page shows a tile reading 3,312 and a table under
 * it that adds to 1,310, and the only conclusions available to a reader are
 * that one of them is broken or that they cannot trust either. Both are worse
 * than the truth, which is that Google will not say — and which is also the
 * honest ceiling on how much of an SEO strategy can be driven from the query
 * table at this volume.
 */
export function queryCoverage(queries = [], types = {}) {
  const named = queries.reduce((n, r) => n + num(r.impressions), 0)
  const all = num(types?.web?.impressions)
  return {
    named,
    all,
    anonymous: Math.max(0, all - named),
    share: all ? (named / all) * 100 : 0,
    namedQueries: queries.length,
  }
}

// ─── Countries and devices ─────────────────────────────────────────────────

// Search Console reports ISO 3166-1 alpha-3; `Intl.DisplayNames` speaks
// alpha-2. Only the code pairs are stored, so the NAMES come from the
// platform and are already translated, already spelled the way the reader
// expects, and never go stale in this file. Anything not listed falls back to
// the uppercased code, which is honest rather than wrong.
const ALPHA3 = ('afg:AF alb:AL dza:DZ arg:AR arm:AM aus:AU aut:AT aze:AZ bhr:BH bgd:BD blr:BY bel:BE ben:BJ ' +
  'bol:BO bih:BA bra:BR bgr:BG khm:KH cmr:CM can:CA chl:CL chn:CN col:CO cri:CR hrv:HR cyp:CY cze:CZ dnk:DK ' +
  'dom:DO ecu:EC egy:EG slv:SV est:EE eth:ET fin:FI fra:FR geo:GE deu:DE gha:GH grc:GR gtm:GT hkg:HK hun:HU ' +
  'isl:IS ind:IN idn:ID irn:IR irq:IQ irl:IE isr:IL ita:IT civ:CI jam:JM jpn:JP jor:JO kaz:KZ ken:KE kwt:KW ' +
  'kgz:KG lva:LV lbn:LB lby:LY ltu:LT lux:LU mys:MY mdv:MV mlt:MT mex:MX mda:MD mar:MA mmr:MM npl:NP nld:NL ' +
  'nzl:NZ nga:NG nor:NO omn:OM pak:PK pse:PS pan:PA per:PE phl:PH pol:PL prt:PT qat:QA rou:RO rus:RU sau:SA ' +
  'sen:SN srb:RS sgp:SG svk:SK svn:SI zaf:ZA kor:KR esp:ES lka:LK sdn:SD swe:SE che:CH syr:SY twn:TW tza:TZ ' +
  'tha:TH tun:TN tur:TR uga:UG ukr:UA are:AE gbr:GB usa:US ury:UY uzb:UZ ven:VE vnm:VN yem:YE zmb:ZM zwe:ZW')
  .split(' ').reduce((m, pair) => { const [a3, a2] = pair.split(':'); m[a3] = a2; return m }, {})

let regionNames = null
export function countryName(code) {
  const c = str(code).toLowerCase()
  // Search Console's own "we could not tell", which is a real row with real
  // impressions in it and must not be dropped or renamed to a country.
  if (!c || c === 'zzz') return 'Unknown'
  const a2 = ALPHA3[c]
  if (!a2) return c.toUpperCase()
  try {
    regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(a2) || a2
  } catch {
    return a2
  }
}

export function countryRows(countries = [], { limit = 10 } = {}) {
  const all = countries.reduce((n, r) => n + num(r.impressions), 0)
  return countries
    .map(r => ({
      code: str(r.country),
      name: countryName(r.country),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      ctr: asPercent(r.ctr),
      position: num(r.position) || null,
      share: all ? (num(r.impressions) / all) * 100 : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
}

const DEVICE_LABELS = { DESKTOP: 'Desktop', MOBILE: 'Mobile', TABLET: 'Tablet' }

export function deviceRows(devices = [], previousDevices = []) {
  const was = new Map((previousDevices || []).map(r => [str(r.device), r]))
  const hasPrevious = was.size > 0
  const all = devices.reduce((n, r) => n + num(r.impressions), 0)
  return devices
    .map(r => ({
      device: str(r.device),
      label: DEVICE_LABELS[str(r.device)] || str(r.device),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      ctr: asPercent(r.ctr),
      position: num(r.position) || null,
      share: all ? (num(r.impressions) / all) * 100 : 0,
      impressionsDelta: change(r.impressions, was.get(str(r.device))?.impressions, hasPrevious),
    }))
    .sort((a, b) => b.impressions - a.impressions)
}

const APPEARANCE_LABELS = {
  TRANSLATED_RESULT: 'Translated result',
  AMP_BLUE_LINK: 'AMP result',
  RICHCARD: 'Rich result',
  MERCHANT_LISTINGS: 'Merchant listing',
  ORGANIC_SHOPPING: 'Organic shopping',
  REVIEW_SNIPPET: 'Review snippet',
  VIDEO: 'Video result',
  PRODUCT_SNIPPETS: 'Product snippet',
  FAQ_RICH_SNIPPET: 'FAQ result',
  HOW_TO_RICH_SNIPPET: 'How-to result',
  JOB_LISTING: 'Job listing',
  EVENT_RICH_RESULT: 'Event result',
}

export function appearanceRows(appearance = []) {
  return appearance
    .map(r => ({
      key: str(r.searchAppearance),
      label: APPEARANCE_LABELS[str(r.searchAppearance)] || str(r.searchAppearance).replace(/_/g, ' ').toLowerCase(),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      ctr: asPercent(r.ctr),
      position: num(r.position) || null,
    }))
    .sort((a, b) => b.impressions - a.impressions)
}

// ─── Sitemaps ──────────────────────────────────────────────────────────────

const DAY = 86_400_000

/**
 * Whether Google is still reading the sitemap, and how long since it bothered.
 *
 * ── WHY A SEARCH ANALYTICS PAGE SHOWS A SITEMAP AT ALL ──
 *
 * Because it is the cheapest explanation there is for a page that takes no
 * impressions, and no amount of rewriting titles fixes it. This property's
 * sitemap was submitted in July 2021 and last downloaded by Google in February
 * 2025 — over a year and a half before anything looked — and it points at the
 * `www` host, which 301s to the apex. None of the query numbers can tell you
 * that, and all of them are affected by it.
 *
 * `staleDays` is measured from the last DOWNLOAD, not the last submission: a
 * submission is something we did once, and a download is Google choosing to
 * come back, which is the thing that stopped.
 */
export function sitemapHealth(sitemaps = [], { now = new Date(), site = '', staleAfterDays = 60 } = {}) {
  const canonical = str(site).replace(/^sc-domain:/, '').replace(/^www\./, '').toLowerCase()
  return (sitemaps || []).map(s => {
    const downloaded = Date.parse(s.lastDownloaded || '')
    const submitted = Date.parse(s.lastSubmitted || '')
    const staleDays = Number.isFinite(downloaded)
      ? Math.floor((now.getTime() - downloaded) / DAY)
      : null
    let host
    try { host = new URL(s.path).host.toLowerCase() } catch { host = '' }
    return {
      path: str(s.path),
      host,
      // A sitemap on a host that redirects still works — Google follows the
      // 301 — so this is a note, not an error. It is worth surfacing because
      // it is usually a sign the sitemap was submitted before the canonical
      // host changed and nobody has resubmitted it since.
      offCanonicalHost: !!canonical && !!host && host.replace(/^www\./, '') === canonical && host.startsWith('www.'),
      lastDownloaded: s.lastDownloaded || '',
      lastSubmitted: s.lastSubmitted || '',
      submittedDays: Number.isFinite(submitted) ? Math.floor((now.getTime() - submitted) / DAY) : null,
      staleDays,
      stale: staleDays !== null && staleDays > staleAfterDays,
      neverDownloaded: !Number.isFinite(downloaded),
      warnings: num(s.warnings),
      errors: num(s.errors),
      isPending: !!s.isPending,
    }
  })
}

// ─── Image search, in words ────────────────────────────────────────────────

/**
 * What image search is actually being asked for, and which pages answer it.
 *
 * ── WHY A TOTAL WAS NOT ENOUGH ──
 *
 * The surfaces panel already says image search is a fifth of this property's
 * visibility and earns almost nothing, and for months that was the whole
 * story: a big number, a terrible position, no explanation. The queries say
 * why, and the answer was not one anybody had guessed — the homepage takes
 * 230 image impressions for `air arabia headquarters`, `almarai headquarters
 * riyadh` and `air india riyadh office`. Photographs of buildings this company
 * lit, ranking for the buildings.
 *
 * That is not a ranking problem and no amount of rewriting titles touches it.
 * It is a filename and alt-text problem, and it is only visible in the words.
 *
 * ── WHAT `unrelated` CLAIMS, AND WHAT IT DOES NOT ──
 *
 * A query is counted as unrelated when it names neither the brand nor
 * anything the brand sells — measured with the same `isBrandQuery` and
 * `lineOf` the rest of the app uses, so it inherits the brand's own
 * configuration rather than an opinion held here. It is a HINT, not a verdict:
 * a brand with no business lines configured has no vocabulary to match
 * against, so `lines` being empty makes the share meaningless and `measurable`
 * says so rather than reporting everything as unrelated.
 */
export function imageSearch({ imageQueries = [], imagePages = [], brandTerms = [], lines = [], types = {} } = {}, { limit = 12 } = {}) {
  const image = types.image || {}

  const queries = imageQueries
    .map(r => {
      const brand = isBrandQuery(r.query, brandTerms)
      const line = lineOf({ query: r.query }, lines)
      return {
        query: str(r.query),
        clicks: num(r.clicks),
        impressions: num(r.impressions),
        position: num(r.position),
        brand,
        line,
        // Neither our name nor our subject. See the note above: only
        // meaningful when the brand has told us what its subjects are.
        unrelated: !brand && !line,
      }
    })
    .sort((a, b) => b.impressions - a.impressions)

  const pages = foldByPath(imagePages).slice(0, limit)

  const named = queries.reduce((n, r) => n + r.impressions, 0)
  const unrelatedImpressions = queries.filter(r => r.unrelated).reduce((n, r) => n + r.impressions, 0)

  return {
    impressions: num(image.impressions),
    clicks: num(image.clicks),
    position: num(image.position) || null,
    // The same withholding that applies to web queries applies here, and for
    // the same reason it has to be said out loud: the panel shows a total and
    // a table that will not add up to it.
    named,
    namedQueries: queries.length,
    queries: queries.slice(0, limit),
    pages,
    unrelated: {
      measurable: lines.length > 0,
      impressions: unrelatedImpressions,
      share: named ? (unrelatedImpressions / named) * 100 : 0,
      rows: queries.filter(r => r.unrelated).slice(0, limit),
    },
  }
}

/** Impressions per page path, host and language variants folded — the same
 *  group-by `pageRows` does, without the previous-window comparison, which
 *  image search has no second call to supply. */
function foldByPath(rows = []) {
  const by = new Map()
  for (const r of rows) {
    const path = pathOf(r.page)
    const seen = by.get(path) || { path, impressions: 0, clicks: 0, weighted: 0 }
    seen.impressions += num(r.impressions)
    seen.clicks += num(r.clicks)
    seen.weighted += num(r.impressions) * num(r.position)
    by.set(path, seen)
  }
  return [...by.values()]
    .map(r => ({
      path: r.path,
      label: prettyPath(r.path),
      impressions: r.impressions,
      clicks: r.clicks,
      position: r.impressions ? r.weighted / r.impressions : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions)
}

// ─── The whole picture ─────────────────────────────────────────────────────

/**
 * Everything the page's tiles show, from one payload.
 *
 * Built on `totals` and `splitBrand` from the agent module rather than on its
 * own sums, so the non-brand figure here is the same non-brand figure the
 * weekly report quotes.
 */
export function websiteSummary(data = {}) {
  const { queries = [], pages = [], previous = [], brandTerms = [], types = {} } = data
  const joined = attachPages(queries, pages)
  const { brand, nonBrand } = splitBrand(joined, brandTerms)
  const prevSplit = splitBrand(previous, brandTerms)

  const web = types.web || {}
  const hasPrevious = num(web.previous?.impressions) > 0 || previous.length > 0

  const allTypes = Object.values(types).reduce((acc, t) => ({
    clicks: acc.clicks + num(t.clicks),
    impressions: acc.impressions + num(t.impressions),
  }), { clicks: 0, impressions: 0 })

  return {
    // Web search, which is what every other number on the page is about.
    impressions: num(web.impressions),
    clicks: num(web.clicks),
    ctr: asPercent(web.ctr),
    position: num(web.position) || null,

    // Every surface added together, stated separately and never mixed into the
    // figures above: image impressions are real visibility but they are not
    // web rankings, and one tile holding both would be a number that answers
    // no question anybody has.
    allSurfaces: allTypes,

    brand: totals(brand),
    nonBrand: totals(nonBrand),
    queries: joined.length,

    baseline: !hasPrevious,
    impressionsDelta: change(web.impressions, web.previous?.impressions, hasPrevious),
    clicksDelta: change(web.clicks, web.previous?.clicks, hasPrevious),
    ctrDelta: hasPrevious ? asPercent(web.ctr) - asPercent(web.previous?.ctr) : null,
    // Lower is better, so the sign is flipped once, here, rather than at every
    // call site — a green "+3.2" on a site that fell three places is worse
    // than showing nothing at all.
    positionDelta: hasPrevious && num(web.previous?.position)
      ? num(web.previous.position) - num(web.position)
      : null,
    nonBrandDelta: change(totals(nonBrand).impressions, totals(prevSplit.nonBrand).impressions, previous.length > 0),
  }
}
