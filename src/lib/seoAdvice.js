import {
  attachPages, appearingNotWinning, homepageCatching, impressionMovers,
  periodSummary, splitBrand, totals, isolate, pathOf,
  WINNABLE, MIN_IMPRESSIONS, NARRATABLE_CLICKS,
} from './agent/searchConsole.js'

// ─── Search Console, turned into things to do ──────────────────────────────
//
// The dashboard's Website card. Every rule here is arithmetic over rows Google
// measured — nothing is asked of a model, so this costs nothing to run and
// says the same thing twice in a row.
//
// ── WHY THIS REUSES agent/searchConsole.js RATHER THAN RESTATING IT ──
//
// The weekly research report already reads this property, through
// runSearchLens, using exactly these primitives: the same 28-day window, the
// same three-day data lag, the same impression floor, the same position band.
// Re-deriving "what counts as a winnable query" here would give the dashboard
// and the report two different definitions of the same word, and the first
// time they disagreed on screen nobody would know which one to believe.
//
// So this module contributes ONE thing the lens does not: ordering. The lens
// emits findings for a report that is read once, top to bottom. A card is
// scanned, so its recommendations have to arrive worst-first, deduplicated,
// and each carrying the one action that actually follows from its position.
//
// ── WHAT IS DELIBERATELY NOT HERE ──
//
// Click movement. arak-sa.com had 122 web-search clicks in a quarter; at that
// volume 3 → 6 is not a doubling, it is two people. Impressions, query text
// and position are stable at low volume and are the useful half anyway. See
// the header of agent/searchConsole.js — this file inherits that rule rather
// than re-litigating it.

/** Impression-weighted average position. A plain mean lets a query with two
 *  impressions at position 90 drag the whole site's number down. */
export function averagePosition(rows = []) {
  let weight = 0
  let sum = 0
  for (const r of rows) {
    const imp = Number(r.impressions) || 0
    if (!imp) continue
    weight += imp
    sum += imp * (Number(r.position) || 0)
  }
  return weight ? sum / weight : null
}

/**
 * The numbers the card's tiles show, with the brand split made explicit.
 *
 * `nonBrand` is the one that matters and the one nobody thinks to ask for: on
 * a small site most clicks are people typing the company's name, so counting
 * those as demand makes a brand look like it is winning a category it has not
 * entered.
 */
export function searchSummary({ queries = [], pages = [], previous = [], brandTerms = [], lines = [] } = {}) {
  const joined = attachPages(queries, pages)
  const base = periodSummary(joined, brandTerms, lines, previous)
  const prevSplit = splitBrand(previous, brandTerms)

  const position = averagePosition(joined)
  const prevPosition = averagePosition(previous)

  return {
    ...base,
    position,
    // A LOWER position is better, so the sign is flipped here rather than at
    // every call site — a card that renders "+3.2" in green for a site that
    // fell three places would be worse than showing nothing.
    positionDelta: position !== null && prevPosition !== null ? prevPosition - position : null,
    previous: {
      all: totals(previous),
      nonBrand: totals(prevSplit.nonBrand),
    },
    impressionsDelta: previous.length ? base.all.impressions - totals(previous).impressions : null,
    nonBrandDelta: previous.length ? base.nonBrand.impressions - totals(prevSplit.nonBrand).impressions : null,
    // Below this floor the card says so instead of drawing a percentage.
    narratableClicks: NARRATABLE_CLICKS,
  }
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

/**
 * Ranked, deduplicated recommendations.
 *
 * Every one of them is a sentence somebody can act on this week, with the
 * measurement that justifies it attached. Ordering is priority first, then
 * impressions — the size of the audience already proven to exist.
 *
 * @returns {Array<{id, kind, priority, title, action, impressions, position, query, page}>}
 */
export function seoRecommendations({
  queries = [], pages = [], previous = [], brandTerms = [], limit = 8,
} = {}) {
  const joined = attachPages(queries, pages)
  const out = []
  const seen = new Set()

  // ── 1. Queries with a proven audience that convert nothing ──
  //
  // The highest-value thing Search Console produces for a site with almost no
  // traffic, because it does not depend on traffic at all: the impressions
  // prove the demand exists and that Google already considers us a candidate.
  // What is missing is a page that deserves the click.
  //
  // A query can be BOTH this and homepage-catching, and on the report's first
  // live run two of five findings were the second half repeating the first.
  // They are one recommendation, and together a stronger one: the demand is
  // proven, the ranking is proven, and the reason it converts nothing is that
  // Google had no page of ours to send it to.
  const homeless = new Set(homepageCatching(pages, brandTerms).map(r => r.query))

  for (const r of appearingNotWinning(joined, { brandTerms })) {
    const onHomepage = homeless.has(r.query)
    if (onHomepage) homeless.delete(r.query)
    seen.add(r.query)
    // The advice has to follow from WHERE it ranks. Near the top of page one a
    // title and description can win the click back; at position 22 they
    // cannot — nobody is seeing the result to click it — and saying so would
    // be advice that quietly does not work.
    const tweakable = r.position <= WINNABLE.tweakable
    out.push({
      id: `unwon:${r.query}`,
      kind: onHomepage ? 'missing-page' : tweakable ? 'rewrite' : 'new-page',
      priority: r.impressions >= MIN_IMPRESSIONS * 3 ? 'high' : 'medium',
      title: onHomepage
        ? `"${isolate(r.query)}" lands on the homepage and converts nothing`
        : `"${isolate(r.query)}" is seen ${r.impressions} times and clicked none`,
      action: onHomepage
        ? 'Google had nothing more specific of ours to show, so it fell back to the homepage. Write the page this query is asking for and link it from the service section it belongs to.'
        : tweakable
          ? 'Rewrite the title and meta description of the page ranking for this, or give the query its own page if the ranking one only mentions it in passing.'
          : `At position ${round1(r.position)} this is not a title problem — nobody is seeing the result to click it. This needs a page of its own, using the words people are actually searching in its heading.`,
      impressions: r.impressions,
      position: r.position,
      query: r.query,
      page: r.page || '',
    })
  }

  // ── 2. Homepage-catching queries not already covered above ──
  // The homepage ranking for a specific, multi-word search is Google saying it
  // had nothing more specific of ours to show. That is a missing page, stated
  // as a measurement rather than as an opinion.
  for (const r of homepageCatching(pages, brandTerms)) {
    if (!homeless.has(r.query) || seen.has(r.query)) continue
    seen.add(r.query)
    out.push({
      id: `homepage:${r.query}`,
      kind: 'missing-page',
      priority: 'high',
      title: `"${isolate(r.query)}" has no page of its own`,
      action: `${r.impressions} impressions land on the homepage. Write the page this query is asking for, and link it from the service section it belongs to.`,
      impressions: r.impressions,
      position: r.position,
      query: r.query,
      page: r.page || '',
    })
  }

  // ── 3. Demand that arrived or grew ──
  // Measured in impressions, never clicks. A query present in only one window
  // is a genuine arrival, not a percentage against zero — and with no previous
  // window at all, impressionMovers returns nothing rather than calling every
  // query on the property "new", which is what the report's first run did.
  for (const m of impressionMovers(joined, previous)) {
    if (seen.has(m.query)) continue
    if (m.state !== 'new' && m.state !== 'rising') continue
    seen.add(m.query)
    out.push({
      id: `rising:${m.query}`,
      kind: 'rising',
      priority: 'medium',
      title: m.state === 'new'
        ? `"${isolate(m.query)}" is new this period at ${m.impressions} impressions`
        : `"${isolate(m.query)}" grew ${m.was} → ${m.impressions} impressions`,
      action: 'Demand is appearing here. Publishing on it now is cheaper than catching up later — check whether the page it lands on actually answers the question.',
      impressions: m.impressions,
      position: m.position,
      query: m.query,
      page: '',
    })
  }

  // ── 4. Visibility lost ──
  for (const m of impressionMovers(joined, previous)) {
    if (seen.has(m.query)) continue
    if (m.state !== 'gone' && m.state !== 'falling') continue
    seen.add(m.query)
    out.push({
      id: `falling:${m.query}`,
      kind: 'falling',
      priority: 'low',
      title: m.state === 'gone'
        ? `"${isolate(m.query)}" stopped appearing — it had ${m.was} impressions`
        : `"${isolate(m.query)}" fell ${m.was} → ${m.impressions} impressions`,
      action: 'Check the page that used to rank for it still exists, still says the words people search, and is still linked from somewhere.',
      impressions: m.impressions || m.was,
      position: m.position,
      query: m.query,
      page: '',
    })
  }

  return out
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.impressions - a.impressions)
    .slice(0, limit)
}

/**
 * Pages taking impressions, best first — "which of our 44 pages is doing any
 * work". Rows come with both dimensions, so one page holds many queries.
 */
export function pagePerformance(pages = [], { limit = 6 } = {}) {
  const byPage = new Map()
  for (const r of pages) {
    const path = pathOf(r.page)
    if (!path) continue
    const cur = byPage.get(path) || { path, impressions: 0, clicks: 0, queries: 0, weighted: 0 }
    cur.impressions += r.impressions
    cur.clicks += r.clicks
    cur.queries += 1
    cur.weighted += r.impressions * (r.position || 0)
    byPage.set(path, cur)
  }
  return [...byPage.values()]
    .map(p => ({ ...p, position: p.impressions ? p.weighted / p.impressions : null }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
}

const round1 = n => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1)
