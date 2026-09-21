// ─── What Google will say about one URL ────────────────────────────────────
//
// searchAnalytics answers "how did the site do". It cannot answer "is this
// page in the index at all", and the difference is not academic: a page that
// Google has never fetched takes zero impressions, and zero impressions is
// exactly what a page nobody searches for takes. The Analytics page was
// therefore unable to tell a content problem from an indexing one.
//
// The URL Inspection API answers it, one URL at a time. It is the same data
// the "Inspect URL" box in Search Console shows a person, and — measured on
// sc-domain:arak-sa.com on 2026-09-20 — the service account this project
// already uses can read it, with no extra grant: Full user is enough, Owner is
// only needed for the Indexing API.
//
// ── WHY THIS IS NOT PART OF fetchWebsiteData ──
//
// It is one call PER URL, and a slow one — about seven seconds each, against
// a fraction of a second for a searchAnalytics query. A site with 88 sitemap
// entries is 88 of those where the whole search pull is 22 fast ones, and it
// answers a question that changes on the scale of days rather than one a
// reader scans on every visit. So it is its own route, asked for by a person
// pressing a button, and the search panels never wait behind it.
//
// Everything here is pure. The network half is api/agent/_urlInspection.js.

const str = v => (v === null || v === undefined ? '' : String(v))
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

export const INSPECT_SCOPE = 'https://www.googleapis.com/auth/webmasters'
export const INSPECT_API = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'

/**
 * The most URLs one press will inspect.
 *
 * Google's quota is 2,000 inspections per property per day and 600 per
 * minute, so this is nowhere near the ceiling — the limit exists because a
 * person is waiting, and because a single Vercel function may not run for
 * ever.
 *
 * The wait is real and was measured rather than assumed: this endpoint
 * answers in about SEVEN SECONDS per URL, not the fraction of a second a
 * searchAnalytics query takes. Ninety-three URLs at six in flight took 110
 * seconds. Sixteen in flight brings the same work to roughly forty, and
 * sixteen concurrent requests at seven seconds each is 140 per minute —
 * comfortably inside Google's 600.
 */
export const MAX_INSPECTIONS = 120

/**
 * A crawl older than this is called out.
 *
 * Sixty days is not a Google threshold — there isn't one — it is the point at
 * which "Google has not looked since" stops being normal crawl cadence for a
 * site that publishes, and starts being worth a sentence. The same number
 * sitemapHealth() uses, deliberately: two staleness rules with different
 * numbers on one screen is a question nobody can answer.
 */
export const STALE_CRAWL_DAYS = 60

// ─── Which URLs to ask about ───────────────────────────────────────────────

/**
 * Every `<loc>` in a sitemap, and every nested sitemap it points at.
 *
 * Deliberately a regex and not an XML parser. The agent container installs one
 * package on purpose (see server/Dockerfile), a sitemap is the most
 * predictable XML there is, and the failure mode of this regex — a `<loc>`
 * inside a comment — does not occur in a generated sitemap. A parser would be
 * a dependency for correctness we do not need.
 *
 * `<sitemapindex>` and `<urlset>` are told apart by the root element, because
 * both hold `<loc>` elements and a caller that cannot tell them apart would
 * inspect a list of sitemaps as if they were pages.
 */
export function sitemapUrls(xml, { limit = 5_000 } = {}) {
  const text = str(xml)
  const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map(m => m[1].trim())
    .filter(Boolean)
    .slice(0, limit)
  const isIndex = /<sitemapindex[\s>]/i.test(text)
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] }
}

/**
 * The URLs worth spending an inspection on, best first.
 *
 * Two sources, and the order between them is the whole point:
 *
 *   1. Pages Search Console says took impressions. These are inspected FIRST
 *      because a page that is earning and quietly dropped out of the index is
 *      the most expensive thing on the site, and because the answer for a page
 *      with traffic is never boring.
 *   2. The sitemap. This is what finds the opposite problem — a page we
 *      published, submitted, and Google has never fetched. It cannot be found
 *      any other way: a URL with no impressions has no row in any report.
 *
 * `/ar` twins are NOT folded together here, unlike everywhere else in this
 * codebase. Indexing is per URL: the English page can be indexed while the
 * Arabic one is unknown to Google, and folding them would report the pair as
 * healthy on the strength of one half.
 */
export function inspectionTargets({ pages = [], sitemap = [], limit = MAX_INSPECTIONS } = {}) {
  const best = new Map()
  let order = 0

  const offer = (url, impressions) => {
    const u = str(url).trim()
    if (!u || !/^https?:\/\//i.test(u)) return
    const key = samePageKey(u)
    const candidate = { url: u, impressions: num(impressions), rank: order++, score: hostScore(u) }
    const held = best.get(key)
    if (!held || candidate.score > held.score
      || (candidate.score === held.score && candidate.impressions > held.impressions)) {
      // Keep the position the page first claimed, not the winner's. A page
      // that earned its place in the queue on impressions should not drop to
      // the back because the canonical spelling of it turned up later.
      best.set(key, { ...candidate, rank: held ? held.rank : candidate.rank })
    }
  }

  for (const row of [...pages].sort((a, b) => num(b.impressions) - num(a.impressions))) {
    offer(row.page || row.url || row, row.impressions)
  }
  for (const url of sitemap) offer(url, 0)

  return [...best.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(0, limit))
    .map(r => r.url)
}

/**
 * The key under which http://www.example.com/x/ and https://example.com/x are
 * the same page.
 *
 * ── WHY HOST VARIANTS ARE FOLDED AND /ar IS NOT ──
 *
 * They look like the same kind of duplicate and are not. /ar/about is a
 * different document with its own content, its own index status and its own
 * ranking — folding it would report a pair as healthy on the strength of one
 * half. http://www.example.com/about is the SAME document, reached by a URL
 * that 301s to the real one, and inspecting it can only ever answer "Page with
 * redirect", which says nothing about the page.
 *
 * Measured on this property: a sitemap submitted for the `www` host was still
 * registered in Search Console alongside the apex one, so 43 of 93 inspections
 * were spent on redirecting twins — half the wait, for forty rows that all
 * said the same uninteresting thing.
 */
export function samePageKey(url) {
  return str(url)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

/** Which spelling of a page to spend the inspection on: https over http,
 *  apex over www. Both are facts about the URL, not about the site, so no
 *  network call is needed to prefer the one Google is likely to call
 *  canonical. */
function hostScore(url) {
  const u = str(url).toLowerCase()
  return (u.startsWith('https://') ? 2 : 0) + (/^https?:\/\/www\./.test(u) ? 0 : 1)
}

// ─── One inspection, named ─────────────────────────────────────────────────

/**
 * Google's answer for one URL, flattened into the fields a screen renders.
 *
 * The API's own shape is three optional result objects, each with its own
 * verdict, and reading it in a component would put four levels of optional
 * chaining next to the markup. More importantly the ENUM NAMES are not
 * answers: `VERDICT_UNSPECIFIED` means "we did not check", not "it failed",
 * and a UI that renders the string it was given says the second.
 */
export function normalizeInspection(url, result = {}, error = '') {
  const index = result?.indexStatusResult || {}
  const rich = result?.richResultsResult || {}

  const coverage = str(index.coverageState)
  const googleCanonical = str(index.googleCanonical)
  const userCanonical = str(index.userCanonical)

  return {
    url: str(url),
    error: str(error),
    // PASS | PARTIAL | FAIL | NEUTRAL | '' — '' when the call itself failed.
    verdict: error ? '' : str(index.verdict).replace('VERDICT_UNSPECIFIED', ''),
    coverage,
    state: stateOf({ error, verdict: index.verdict, coverage }),
    lastCrawl: str(index.lastCrawlTime),
    crawledAs: str(index.crawledAs).replace('CRAWLING_USER_AGENT_UNSPECIFIED', ''),
    robots: str(index.robotsTxtState).replace('ROBOTS_TXT_STATE_UNSPECIFIED', ''),
    fetch: str(index.pageFetchState).replace('PAGE_FETCH_STATE_UNSPECIFIED', ''),
    googleCanonical,
    userCanonical,
    // Only a mismatch we can actually see. One of the two missing is not
    // evidence of agreement, and reporting it as one would put a red row next
    // to every URL Google has never crawled.
    canonicalMismatch: !!(googleCanonical && userCanonical && googleCanonical !== userCanonical),
    referrers: (index.referringUrls || []).map(str).filter(Boolean),
    richTypes: (rich.detectedItems || []).map(i => str(i.richResultType)).filter(Boolean),
    inspectUrl: str(result?.inspectionResultLink),
  }
}

/**
 * The one word this URL's answer comes down to.
 *
 * `unknown` is split out from the other not-indexed states on purpose. "URL is
 * unknown to Google" means the crawler has never been told the page exists —
 * a link or sitemap problem, fixed in minutes. "Crawled – currently not
 * indexed" means Google looked and decided against it — a content problem,
 * fixed in weeks if at all. Rendering both as "not indexed" would send
 * somebody to rewrite a page that Google has simply never seen.
 */
export function stateOf({ error = '', verdict = '', coverage = '' } = {}) {
  if (error) return 'error'
  const cov = str(coverage).toLowerCase()
  if (!cov && !verdict) return 'unchecked'
  if (cov.includes('unknown to google')) return 'unknown'
  if (str(verdict) === 'PASS') return 'indexed'
  if (cov.includes('not indexed') || cov.includes('excluded') || cov.includes('duplicate')
    || cov.includes('alternate page') || cov.includes('redirect')) return 'excluded'
  if (str(verdict) === 'FAIL') return 'excluded'
  return 'other'
}

/** Human labels for the states above, in the order a reader should meet them. */
export const STATE_LABELS = {
  indexed: 'Indexed',
  excluded: 'Seen but not indexed',
  unknown: 'Google has never seen it',
  other: 'Other',
  unchecked: 'Not checked',
  error: 'Could not check',
}

// ─── The whole set, read as one answer ─────────────────────────────────────

const daysSince = (iso, now) => {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

/**
 * What the inspected pages add up to.
 *
 * Counts, then the three lists worth a person's attention, then the two things
 * that fall out of the same calls for free: who links to us, and which rich
 * results Google detects.
 *
 * ── WHY THE PROBLEM LISTS ARE CAPPED AND ORDERED ──
 *
 * A site with a broken sitemap can return eighty unknown URLs, and eighty rows
 * of red is read as "the tool is broken" rather than "the site is". The lists
 * carry the first `limit` ordered by how much the page is already earning —
 * a page taking 200 impressions that just left the index outranks a page
 * nobody has ever visited — and `more` says how many were left out.
 */
export function indexHealth(rows = [], { now = new Date(), site = '', limit = 12, staleAfterDays = STALE_CRAWL_DAYS } = {}) {
  const counts = { indexed: 0, excluded: 0, unknown: 0, other: 0, error: 0, unchecked: 0 }
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1

  const weight = r => num(r.impressions)
  const byWeight = list => [...list].sort((a, b) => weight(b) - weight(a))
  const cut = list => ({ rows: byWeight(list).slice(0, limit), more: Math.max(0, list.length - limit) })

  const stale = rows.filter(r => {
    const age = daysSince(r.lastCrawl, now)
    return r.state === 'indexed' && age !== null && age > staleAfterDays
  })

  return {
    checked: rows.length,
    counts,
    // Everything Google is not showing, for whatever reason, in one list —
    // because the reader's question is "what is missing", and the reason is a
    // column rather than three separate panels.
    missing: cut(rows.filter(r => r.state === 'unknown' || r.state === 'excluded')),
    canonical: cut(rows.filter(r => r.canonicalMismatch)),
    stale: cut(stale),
    failed: rows.filter(r => r.state === 'error').map(r => ({ url: r.url, error: r.error })),
    referrers: externalReferrers(rows, site),
    richResults: richResultTally(rows),
  }
}

/**
 * Who links to the site, by host, from Google's own view of it.
 *
 * This is not a backlink tool and must not be sold as one: `referringUrls` is
 * a sample Google chose to show, not the link graph. It is still the only
 * first-party answer available here, and on this property it was worth having
 * immediately — the four referrers to the homepage were the Arabic twin and
 * three scraper sites, which is a different problem from having no links at
 * all and is invisible in every other panel.
 *
 * Own-host links are dropped rather than counted, because internal linking is
 * a thing we control and a thing the pages panel already reflects.
 */
export function externalReferrers(rows = [], site = '') {
  const own = String(site || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
  const byHost = new Map()

  for (const row of rows) {
    for (const ref of row.referrers || []) {
      let host
      try { host = new URL(ref).hostname.toLowerCase() } catch { continue }
      const bare = host.replace(/^www\./, '')
      if (own && (bare === own || bare.endsWith(`.${own}`))) continue
      const seen = byHost.get(bare) || { host: bare, links: 0, pages: new Set(), example: ref }
      seen.links += 1
      seen.pages.add(row.url)
      byHost.set(bare, seen)
    }
  }

  return [...byHost.values()]
    .map(r => ({ host: r.host, links: r.links, pages: r.pages.size, example: r.example }))
    .sort((a, b) => b.links - a.links || a.host.localeCompare(b.host))
}

/**
 * Which rich results Google detects, and on how many pages.
 *
 * Kept because the searchAppearance dimension is the other half of the same
 * question and, on a site with no structured data, is empty — which reads as
 * "no answer" rather than "nothing to report". This one counts what IS there,
 * so an empty tally is a positive statement: Google found no structured data
 * on any of the pages we asked about.
 */
export function richResultTally(rows = []) {
  const byType = new Map()
  for (const row of rows) {
    for (const type of row.richTypes || []) {
      byType.set(type, (byType.get(type) || 0) + 1)
    }
  }
  return [...byType.entries()]
    .map(([type, pages]) => ({ type, pages }))
    .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type))
}
