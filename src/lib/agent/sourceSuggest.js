// ─── New sources, found by the run itself ──────────────────────────────────
// The project lenses are told to search Instagram and LinkedIn with hashtags
// they build themselves (see social() in lensPrompts.js). When that turns up
// an account or a site that led to a real project finding, the team should
// not have to notice it in a footnote and type it in: it is proposed for the
// "Where to look" list, and a person accepts or rejects it there.
//
// Read from the findings' own source URLs, in code. Asking synthesis to name
// sources would mean another field on a schema already near the API's limit
// (structured-output-schema-limits), and the URL is the better evidence
// anyway — it is the page the finding actually rests on.
//
// Pure. No network.

// Pages that are never a source worth reading every week, however often a
// lens cites them. Kept to kinds of site, not markets, so it holds for any
// brand.
const NEVER = [
  'scribd.com', 'wikipedia.org', 'youtube.com', 'google.com', 'bing.com', 'facebook.com',
  'bayt.com', 'indeed.com', 'glassdoor.com', 'naukrigulf.com', 'gulftalent.com',
  'oraclecloud.com', 'myworkdayjobs.com', 'rocketreach.co', 'zoominfo.com', 'issuu.com',
  'slideshare.net', 'pdfcoffee.com', 'yumpu.com', 'grandviewresearch.com', 'mordorintelligence.com',
]

const PROJECT_LENSES = new Set(['openings', 'targets'])
const host = url => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
const blocked = h => !h || NEVER.some(d => h === d || h.endsWith(`.${d}`))

/**
 * One candidate from one URL, or null.
 *
 *   instagram.com/<handle>/            → instagram  @handle
 *   linkedin.com/company/<slug>        → linkedin   linkedin.com/company/<slug>
 *   linkedin.com/posts/<slug>_…        → linkedin   linkedin.com/company/<slug>  (posts carry the poster)
 *   any other site                     → website    the bare domain
 *
 * Instagram post and reel URLs carry no handle, so they give nothing — better
 * than guessing whose post it was.
 */
export function candidateFromUrl(url) {
  const h = host(url)
  if (blocked(h)) return null
  const path = new URL(url).pathname  // host() above already proved it parses
  if (h.endsWith('instagram.com')) {
    const m = /^\/([A-Za-z0-9._]{2,30})\/?$/.exec(path)
    if (!m || ['p', 'reel', 'reels', 'explore', 'popular', 'stories', 'tv'].includes(m[1])) return null
    return { source_type: 'instagram', subject: `@${m[1].toLowerCase()}` }
  }
  if (h.endsWith('linkedin.com')) {
    const company = /^\/company\/([^/?#]+)/.exec(path)
    if (company) return { source_type: 'linkedin', subject: `linkedin.com/company/${company[1].toLowerCase()}` }
    const post = /^\/posts\/([^_/]+)_/.exec(path)
    if (post) return { source_type: 'linkedin', subject: `linkedin.com/company/${post[1].toLowerCase()}` }
    return null
  }
  if (/(^|\.)(x|twitter)\.com$/.test(h) || h.endsWith('tiktok.com')) return null
  return { source_type: 'website', subject: h }
}

const keyOf = s => String(s || '').toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^@/, '').replace(/\/$/, '')

/**
 * Up to `limit` new sources from this run's project findings.
 *
 * A social account qualifies on one finding (an account that posted a project
 * we reported is exactly what the list is for); a website needs two, so one
 * stray article does not put a site on a weekly reading list. Low-relevance
 * findings do not count. Anything already on the list — in ANY status, so a
 * source someone rejected is not proposed again — is skipped.
 */
export function suggestSources(findings = [], existing = [], { limit = 5 } = {}) {
  const known = new Set((existing || []).map(r => keyOf(r.subject)))
  // A site already on the list as "argaam.com/en" still covers argaam.com.
  const knownHosts = new Set((existing || []).map(r => keyOf(r.subject).split('/')[0]))
  const tally = new Map()
  for (const f of findings || []) {
    if (!PROJECT_LENSES.has(String(f?.lens || '').split(':')[0])) continue
    if (f?.relevance === 'low') continue
    const seen = new Set()
    for (const s of f?.sources || []) {
      const c = candidateFromUrl(typeof s === 'string' ? s : s?.url)
      if (!c) continue
      const k = keyOf(c.subject)
      if (seen.has(k) || known.has(k) || (c.source_type === 'website' && knownHosts.has(k))) continue
      seen.add(k)
      const t = tally.get(k) || { ...c, count: 0, example: f.headline || '' }
      t.count += 1
      tally.set(k, t)
    }
  }
  return [...tally.values()]
    .filter(t => t.source_type !== 'website' || t.count >= 2)
    .sort((a, b) => (a.source_type === 'website') - (b.source_type === 'website') || b.count - a.count)
    .slice(0, limit)
    .map(t => ({
      source_type: t.source_type,
      subject: t.subject,
      why: `Found by the research: cited by ${t.count} project finding${t.count === 1 ? '' : 's'}` +
        (t.example ? `, e.g. "${String(t.example).slice(0, 140)}"` : '') + '.',
    }))
}
