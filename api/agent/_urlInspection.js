import { accessToken, serviceAccount, siteFor, fetchSitemaps, mapLimit } from './_searchConsole.js'
import {
  INSPECT_API, INSPECT_SCOPE, MAX_INSPECTIONS,
  sitemapUrls, inspectionTargets, normalizeInspection,
} from '../../src/lib/agent/urlInspection.js'

// ─── Asking Google about one URL at a time ─────────────────────────────────
//
// The network half of src/lib/agent/urlInspection.js. Same credential as the
// search pull, different scope: URL Inspection is not in the read-only scope,
// even though inspecting a URL writes nothing. `accessToken` takes a scope for
// exactly this reason — see its note in _searchConsole.js.
//
// ── WHAT IT COSTS ──
//
// Nothing in money and one call per URL in time. Google's quota is 2,000
// inspections per property per day and 600 per minute; a full press here is
// at most MAX_INSPECTIONS, so the daily quota allows about sixteen presses on
// a 120-page site. That is generous for a button, and nowhere near enough for
// something on a page load — which is why this is not on one.

/**
 * Sixteen at a time — higher than the search pull's six, on purpose.
 *
 * The search pull is limited by Google's twenty-queries-per-second ceiling on
 * fast calls. This one is limited by latency: an inspection takes about seven
 * seconds, so sixteen in flight is about 140 requests a minute against a limit
 * of 600. The number that matters here is the wall clock — 93 URLs took 110
 * seconds at six, and roughly forty at sixteen.
 */
const CONCURRENCY = 16

/** A page of a sitemap, fetched over plain HTTP. Google's API will not hand
 *  us the contents of a sitemap — only when it last read one — so the file
 *  itself is the only source for which URLs were submitted. */
async function fetchXml(url, timeoutMs = 15_000) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: abort.signal, headers: { 'User-Agent': 'arak-marketing/1.0' } })
    if (!res.ok) return { ok: false, text: '', error: `HTTP ${res.status}` }
    return { ok: true, text: await res.text(), error: '' }
  } catch (err) {
    return { ok: false, text: '', error: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Every URL this site has submitted to Google, from the sitemaps Google holds.
 *
 * Two hops, and the first one matters: the list of sitemaps comes from SEARCH
 * CONSOLE, not from robots.txt or a guessed /sitemap.xml. What we want to know
 * is what Google was TOLD about, and a sitemap that exists on the server but
 * was never submitted is not that. It is also how a stale submission — this
 * property carried a 2021 entry pointing at a host that 301s — shows up as
 * URLs that cannot be fetched rather than as silence.
 *
 * One level of nesting is followed. A sitemap index of sitemap indexes is
 * legal and does not occur; stopping at one level is a bounded fetch rather
 * than a crawl with a cycle in it.
 */
export async function fetchSitemapUrls({ site, env = process.env, limit = 5_000 } = {}) {
  const listed = await fetchSitemaps({ site, env })
  const paths = (listed.sitemaps || []).map(s => s.path).filter(Boolean)
  if (!paths.length) return { urls: [], sources: [], error: listed.error || '' }

  const urls = []
  const sources = []
  const seen = new Set()

  for (const path of paths) {
    const res = await fetchXml(path)
    sources.push({ path, ok: res.ok, error: res.error })
    if (!res.ok) continue
    const parsed = sitemapUrls(res.text, { limit })

    // A sitemap index: fetch its children, once.
    for (const child of parsed.sitemaps) {
      if (seen.has(child)) continue
      seen.add(child)
      const sub = await fetchXml(child)
      sources.push({ path: child, ok: sub.ok, error: sub.error })
      if (sub.ok) urls.push(...sitemapUrls(sub.text, { limit }).urls)
    }
    urls.push(...parsed.urls)
  }

  return { urls, sources, error: '' }
}

/**
 * Inspect a list of URLs.
 *
 * Every call is settled on its own. One URL that 429s or times out costs its
 * own row and nothing else — the alternative, a rejected Promise.all, throws
 * away 119 good answers because the 120th was rate-limited, and the panel
 * would then be empty exactly when the site is largest.
 */
export async function fetchInspections({ site, urls = [], env = process.env } = {}) {
  const sa = serviceAccount(env)
  const property = siteFor(site, env)

  if (!sa) return { ok: false, configured: false, error: 'GOOGLE_SA_KEY is not set.', rows: [] }
  if (!property) return { ok: false, configured: false, error: 'No Search Console property is configured for this brand.', rows: [] }
  if (!urls.length) return { ok: true, configured: true, site: property, rows: [] }

  let token
  try {
    token = await accessToken(sa, INSPECT_SCOPE)
  } catch (err) {
    return { ok: false, configured: true, site: property, rows: [], error: String(err?.message || err).slice(0, 300) }
  }

  const rows = await mapLimit(urls, CONCURRENCY, async url => {
    try {
      const res = await fetch(INSPECT_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionUrl: url, siteUrl: property }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = json?.error?.message || `HTTP ${res.status}`
        return normalizeInspection(url, {}, msg.slice(0, 200))
      }
      return normalizeInspection(url, json.inspectionResult || {})
    } catch (err) {
      return normalizeInspection(url, {}, String(err?.message || err).slice(0, 200))
    }
  })

  // ── The canary, again ──
  // If EVERY call failed, this is one problem (the grant, the property, the
  // quota) and not 120 of them. Reporting it as a failed pull rather than 120
  // red rows is the difference between "fix one thing" and "the site is
  // broken". A partial failure is left as rows, because it genuinely is one.
  const failed = rows.filter(r => r.state === 'error')
  if (rows.length && failed.length === rows.length) {
    return { ok: false, configured: true, site: property, rows: [], error: failed[0].error }
  }

  return { ok: true, configured: true, site: property, rows }
}

export { MAX_INSPECTIONS, inspectionTargets }
