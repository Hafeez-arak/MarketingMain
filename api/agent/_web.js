import {
  availableProviders, shouldFallThrough, explainFallThrough,
  normaliseResult, normalisePage,
} from '../../src/lib/agent/web.js'

// ─── The web, through whichever provider is up ─────────────────────────────
// Firecrawl first, Tavily behind it. The decision about WHEN to fall through
// lives in src/lib/agent/web.js and is tested without a network; this file
// only does the calling.
//
// Every call reports which provider served it. Running on the backup is
// something you want to learn from a report rather than from a bill, and a
// silent fallback is how a free tier gets quietly exhausted.

const KEY = name => (name === 'firecrawl'
  ? process.env.FIRECRAWL_API_KEY
  : process.env.TAVILY_API_KEY) || ''

const TIMEOUT_MS = 25_000

/** One HTTP call with a timeout, classified rather than thrown. */
async function call(url, init) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: abort.signal })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body, networkError: false }
  } catch (err) {
    // A timeout and a DNS failure are both "we never got an answer", which is
    // the case a fallback exists for.
    return { ok: false, status: 0, body: {}, networkError: true, message: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Firecrawl ─────────────────────────────────────────────────────────────

async function firecrawlSearch(query, { limit = 5 } = {}) {
  const out = await call('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY('firecrawl')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  })
  if (!out.ok) return out
  const web = out.body?.data?.web || out.body?.data || []
  return { ...out, results: (Array.isArray(web) ? web : []).map(r => normaliseResult(r, 'firecrawl')) }
}

async function firecrawlRead(url) {
  const out = await call('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY('firecrawl')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
  })
  if (!out.ok) return out
  // Firecrawl answers 200 with success:false for a page it could not render.
  // That is content-level, not provider-level — the fallback would fail the
  // same way, so it is reported rather than retried elsewhere.
  if (out.body?.success === false) {
    return { ...out, ok: false, status: 422, contentError: out.body?.error || 'could not be read' }
  }
  return { ...out, page: normalisePage(out.body?.data, 'firecrawl', url) }
}

// ─── Tavily ────────────────────────────────────────────────────────────────

async function tavilySearch(query, { limit = 5 } = {}) {
  const out = await call('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY('tavily')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
  })
  if (!out.ok) return out
  return { ...out, results: (out.body?.results || []).map(r => normaliseResult(r, 'tavily')) }
}

async function tavilyRead(url) {
  const out = await call('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY('tavily')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: [url], extract_depth: 'basic' }),
  })
  if (!out.ok) return out
  const first = out.body?.results?.[0]
  if (!first) {
    const why = out.body?.failed_results?.[0]?.error || 'could not be read'
    return { ...out, ok: false, status: 422, contentError: why }
  }
  return { ...out, page: normalisePage(first, 'tavily', url) }
}

const IMPL = {
  firecrawl: { search: firecrawlSearch, read: firecrawlRead },
  tavily:    { search: tavilySearch,    read: tavilyRead },
}

/**
 * Try each configured provider in order until one answers.
 *
 * @param {'search'|'read'} op
 * @param {Array} args
 */
async function withFallback(op, args) {
  const available = availableProviders(process.env)
  if (!available.length) {
    return { ok: false, error: 'No web provider is configured (FIRECRAWL_API_KEY / TAVILY_API_KEY).', notes: [], available }
  }

  const notes = []
  for (const provider of available) {
    const out = await IMPL[provider][op](...args)
    if (out.ok) {
      return { ok: true, ...out, provider, used: provider, notes, available }
    }
    // A content failure means every provider will fail identically. Stopping
    // here protects the fallback's quota for the day it is genuinely needed.
    if (!shouldFallThrough(out)) {
      return {
        ok: false,
        error: out.contentError || `That page could not be read (${out.status}).`,
        provider, used: provider, notes, available, contentError: true,
      }
    }
    notes.push(explainFallThrough(provider, out.status))
  }

  return {
    ok: false,
    error: `Every web provider failed. ${notes.join(' ')}`,
    notes, available,
  }
}

/** Search the open web. Returns normalised results whichever provider served. */
export function searchWeb(query, opts = {}) {
  return withFallback('search', [String(query || '').slice(0, 400), opts])
}

/** Read one page as markdown. */
export function readPage(url, opts = {}) {
  return withFallback('read', [String(url || '').slice(0, 2_000), opts])
}

/** Is anything configured at all? Used to decide whether to offer the tools. */
export function webConfigured() {
  return availableProviders(process.env).length > 0
}
