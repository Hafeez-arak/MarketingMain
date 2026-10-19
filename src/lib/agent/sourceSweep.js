// ─── The source sweep: the code reads the "Where to look" list itself ──────
// 2026-10-19. Until now the source list reached the project lenses as a list
// of names with "Tier 1 every run; tier 2 and 3 when searches allow", and the
// model chose what to search. Nothing recorded the choice. The 19 Oct run
// cited none of the eight sources marked "every run", and there was no way to
// tell a source that was searched and came back empty from one that was
// skipped.
//
// So the searching of the list moved into code. Before openings and targets
// start, every active source is searched (api/agent/_sweep.js), the results
// are handed to both lenses as leads to confirm, and each check is written to
// research_source_checks. The tier now decides how DEEPLY a source is read,
// not whether it is read at all.
//
// What was measured before choosing the queries (Firecrawl, 2026-10-19):
//   site:<domain> + English project words   works (meed, saudigulfprojects)
//   site:<domain> + Arabic words            the site filter is lost and
//                                           results come from anywhere — so a
//                                           site is searched with English words,
//                                           never Arabic ones, and its front
//                                           page is read for the rest
//   site:instagram.com/<handle>             works; a recency filter often
//                                           leaves nothing, so an empty recent
//                                           search is retried without it
//   site:linkedin.com/posts "<slug>"        LinkedIn indexes company posts
//                                           poorly; results are kept only when
//                                           the post is the company's own
//   reading a news site's front page        the freshest list of headlines,
//                                           one call, no search engine between;
//                                           but it leads with whatever the site
//                                           leads with, so it comes after the
//                                           search and only a few are kept
//   Firecrawl's plan                        about 24 requests a minute; the
//                                           sweep paces itself (_sweep.js)
//
// Pure. No network. Nothing here names a website: the list is data.

const SITE_TYPES = new Set(['website', 'news', 'tender_portal', 'exchange', 'government'])

/** Generic project words. English only, for the reason in the header. */
const PROJECT_WORDS = 'project contract awarded'

/**
 * How deep each tier is read.
 *   results  kept per search
 *   searches 2 adds a second query for a hashtag or a phrase (see sweepPlan)
 *   read     a site's own front page is read as well
 *   show     results handed to the lens
 */
export const DEPTH = {
  1: { results: 8, searches: 2, read: true, show: 8 },
  2: { results: 5, searches: 1, read: false, show: 5 },
  3: { results: 3, searches: 1, read: false, show: 3 },
}
export const depthOf = tier => DEPTH[Number(tier)] || DEPTH[2]

const clean = s => String(s || '').trim()

/** "https://www.argaam.com/en/x/" → { host: 'argaam.com', path: 'argaam.com/en/x' }. */
export function siteOf(subject) {
  const raw = clean(subject).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (!raw || /\s/.test(raw) || !raw.includes('.')) return null
  const host = raw.split('/')[0].toLowerCase()
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null
  return { host, path: raw.toLowerCase() === host ? host : `${host}${raw.slice(host.length)}` }
}

/** "@x", "instagram.com/x", "https://x.com/x/" → "x". */
export function handleOf(subject) {
  const s = clean(subject).replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  const m = /^(?:@|(?:instagram\.com|x\.com|twitter\.com)\/)([A-Za-z0-9._]{1,30})\/?$/i.exec(s)
  return m ? m[1].toLowerCase() : ''
}

/** "linkedin.com/company/saudi-projects" → { slug }, "ALEC FITOUT" → { name }. */
export function linkedinOf(subject) {
  const s = clean(subject).replace(/^https?:\/\//i, '').replace(/^[a-z]{2}\.|^www\./i, '')
  const m = /^linkedin\.com\/(?:company|showcase|school)\/([^/?#]+)/i.exec(s)
  if (m) return { slug: decodeURIComponent(m[1]).toLowerCase() }
  return s ? { name: s } : null
}

const hostOf = url => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
const onHost = (url, host) => {
  const h = hostOf(url)
  return Boolean(h) && (h === host || h.endsWith(`.${host}`))
}

/**
 * What to do for one source: the searches, and a page to read when there is
 * one. `keep` says which results belong to the source; a search engine that
 * drops a site: filter must not pass someone else's page off as this one's.
 *
 * @returns {{ searches: {query:string, limit:number}[], read: string|null, keep: object }|null}
 */
export function sweepPlan(source, { geography = '' } = {}) {
  const type = clean(source?.source_type)
  const subject = clean(source?.subject)
  if (!subject) return null
  const d = depthOf(source?.tier)
  const geo = clean(geography).split(/[,;(]/)[0].trim()
  const words = [geo, PROJECT_WORDS].filter(Boolean).join(' ')
  const plan = (searches, read = null, keep = { any: true }) => ({
    searches: searches.slice(0, d.searches).map(query => ({ query, limit: d.results })),
    read: d.read ? read : null,
    keep,
  })

  if (SITE_TYPES.has(type) || (!type && siteOf(subject))) {
    const site = siteOf(subject)
    if (!site) return null
    return plan([`site:${site.path} ${words}`], `https://${site.path}`, { host: site.host })
  }
  if (type === 'instagram') {
    const h = handleOf(subject) || subject.replace(/^@/, '')
    return plan([`site:instagram.com/${h}`], null, { path: `instagram.com/${h}/` })
  }
  if (type === 'x') {
    const h = handleOf(subject) || subject.replace(/^@/, '')
    return plan([`site:x.com/${h}`], null, { path: `x.com/${h}/` })
  }
  if (type === 'linkedin') {
    const li = linkedinOf(subject)
    if (!li) return null
    return li.slug
      ? plan([`site:linkedin.com/posts "${li.slug}"`], null, { path: `linkedin.com/posts/${li.slug}_` })
      : plan([`site:linkedin.com/posts "${li.name}"`], null, { host: 'linkedin.com' })
  }
  if (type === 'hashtag') {
    return plan([subject, `site:instagram.com ${subject}`])
  }
  // keyword, or anything newer than this file: searched as written.
  return plan([subject, `site:linkedin.com/posts ${subject}`])
}

/** Does a result belong to the source, by the plan's `keep` rule? */
export function belongs(url, keep = { any: true }) {
  if (!url) return false
  if (keep.any) return true
  if (keep.host) return onHost(url, keep.host)
  if (keep.path) {
    // The trailing slash keeps @addadruh from claiming @addadruh2's posts.
    const bare = String(url).toLowerCase().replace(/^https?:\/\//, '').replace(/^[a-z]{2}\.|^www\./, '').replace(/[?#].*$/, '')
    return `${bare}/`.startsWith(keep.path.toLowerCase())
  }
  return true
}

/**
 * The headlines on a page someone else laid out, as results.
 *
 * A front page in markdown is mostly navigation, images and the same story
 * linked three times. What is worth handing on is each story link once: link
 * text long enough to be a headline, pointing at the source's own site.
 */
export function headlinesFrom(markdown = '', host = '', max = 12) {
  const out = []
  const seen = new Set()
  const re = /\[([^\]\n]{25,220})\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = re.exec(String(markdown))) && out.length < max) {
    const title = m[1].replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim()
    const url = m[2]
    if (title.length < 25 || /^!?\[?image|^https?:|!\[/i.test(title)) continue
    if (/\.(png|jpe?g|gif|webp|svg)([?#]|$)/i.test(url)) continue
    if (host && !onHost(url, host)) continue
    const key = url.replace(/[?#].*$/, '').replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title, url, snippet: '' })
  }
  return out
}

/**
 * A snippet as words. Firecrawl hands back page markdown, and on 2026-10-19 a
 * Saudi Exchange snippet was mostly a 200-character portal link the lens
 * would have paid for twice and could not use.
 */
const plain = s => clean(s)
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/[#*_`|>]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/** Merge result lists, dropping repeats by URL, keeping the first. */
export function mergeResults(lists = [], max = 20) {
  const seen = new Set()
  const out = []
  for (const r of lists.flat()) {
    const key = String(r?.url || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ title: clean(r.title).slice(0, 200), url: r.url, snippet: plain(r.snippet).slice(0, 300) })
    if (out.length >= max) break
  }
  return out
}

const LABEL = {
  website: 'site', news: 'news site', tender_portal: 'tender portal', exchange: 'stock-exchange announcements',
  government: 'government site', instagram: 'Instagram account', linkedin: 'LinkedIn page', x: 'X account',
  hashtag: 'hashtag', keyword: 'search phrase',
}

/**
 * The sweep as the lens reads it.
 *
 * `checks` are research_source_checks rows joined to their source. Sources
 * that came back empty or failed are named in one line each, so the lens does
 * not search them again, and the brief can say the list was read.
 */
export function sweepBlock(checks = []) {
  const rows = (checks || []).filter(c => c?.source?.subject)
  if (!rows.length) return ''
  const sorted = [...rows].sort((a, b) => (a.source.tier ?? 9) - (b.source.tier ?? 9))
  const withResults = sorted.filter(c => c.status === 'done' && (c.results || []).length)
  const empty = sorted.filter(c => c.status === 'done' && !(c.results || []).length)
  const failed = sorted.filter(c => c.status !== 'done')
  const name = s => `${LABEL[s.source_type] || 'source'}: ${s.subject}`
  return [
    '',
    'WHERE TO LOOK — ALREADY SEARCHED FOR YOU THIS WEEK.',
    'A person on this team chose these sources because they carry the projects we want. Before you',
    'started, every one of them was searched in code, and this is what came back. Treat it as your',
    'first reading list:',
    '- These are LEADS, not findings. A title and a snippet prove nothing on their own: open',
    '  (read_page or web_fetch) the ones that could be a project for us, confirm the facts on the',
    '  page, and report those with the page as the source.',
    '- Skip what is plainly not ours (oil and gas, roads, utilities, other countries) without comment.',
    '- Do NOT search these sources again; spend your own searches on what the list does not reach.',
    ...withResults.flatMap(c => [
      `- [tier ${c.source.tier ?? 2}] ${name(c.source)}${c.source.why ? ` — ${clean(c.source.why).slice(0, 140)}` : ''}`,
      ...(c.results || []).slice(0, depthOf(c.source.tier).show).map(r =>
        `    · ${clean(r.title) || r.url} — ${r.url}${r.snippet ? ` — ${clean(r.snippet).slice(0, 160)}` : ''}`),
    ]),
    ...(empty.length ? [`- Searched, nothing new came back: ${empty.map(c => c.source.subject).join(', ')}.`] : []),
    ...(failed.length ? [`- Could not be checked this week: ${failed.map(c => c.source.subject).join(', ')}.`] : []),
  ].join('\n')
}

/**
 * How many of a run's project findings rest on each source.
 *
 * A finding counts for a source when one of its source URLs belongs to it by
 * the same rule the sweep keeps results by — so "led to a project" means the
 * same thing as "came back from this source".
 *
 * @returns {Map<string, number>} source id → findings
 */
export function findingsBySource(findings = [], sources = []) {
  const counts = new Map((sources || []).map(s => [s.id, 0]))
  const rules = (sources || []).map(s => {
    const p = sweepPlan(s)
    return p && !p.keep.any ? { id: s.id, keep: p.keep } : null
  }).filter(Boolean)
  for (const f of findings || []) {
    if (!['openings', 'targets'].includes(String(f?.lens || '').split(/[:_]/)[0])) continue
    const urls = (f?.sources || []).map(s => (typeof s === 'string' ? s : s?.url)).filter(Boolean)
    for (const r of rules) {
      if (urls.some(u => belongs(u, r.keep))) counts.set(r.id, (counts.get(r.id) || 0) + 1)
    }
  }
  return counts
}

/**
 * One line per source for the "Where to look" panel, from its check rows
 * (newest first): when it was last checked, what came back, and when it last
 * led to a project.
 */
export function sourceRecord(checks = []) {
  const rows = [...(checks || [])].sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)))
  const last = rows.find(r => r.status !== 'claimed') || null
  const lastHit = rows.find(r => (r.findings || 0) > 0) || null
  return {
    checkedAt: last?.checked_at || null,
    status: last?.status || null,
    results: last?.result_count ?? null,
    error: last?.error || '',
    findings: last?.findings ?? null,
    lastHitAt: lastHit?.checked_at || null,
    runs: rows.filter(r => r.status === 'done').length,
  }
}
