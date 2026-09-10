// ─── Reading the open web, with a provider that can fail ───────────────────
// Firecrawl first, Tavily behind it. Same seam as models.js: swapping the
// provider behind a job is a config change, not a rewrite.
//
// ── THE DISTINCTION THIS FILE EXISTS FOR ──
//
// Falling through on every error is worse than not falling through at all. Two
// kinds of failure look identical in a try/catch and mean opposite things:
//
//   The PROVIDER failed.  Out of credits, rate limited, key revoked, service
//                         down. The next provider will very likely succeed,
//                         so fall through.
//
//   The CONTENT failed.   That page is 404, or the URL is malformed, or the
//                         site blocks robots. Every provider will fail the
//                         same way. Falling through burns the fallback's quota
//                         to arrive at the same answer more slowly — and on a
//                         free tier, exhausting the backup on pages that do
//                         not exist is exactly how you have no backup on the
//                         day you need one.
//
// So provider-level failures fall through and content-level ones do not.

export const PROVIDERS = ['firecrawl', 'tavily']

/** HTTP statuses that mean THIS provider is unusable right now. */
const PROVIDER_DOWN = new Set([
  401, // key rejected — misconfigured or revoked
  402, // payment required — the free tier ran out
  403, // forbidden at the account level
  429, // rate limited
  500, 502, 503, 504, // their outage
])

/** Statuses that mean the URL is the problem. Every provider agrees on these. */
const CONTENT_BAD = new Set([
  400, // we sent something malformed
  404, // the page is not there
  410, // it was there and is gone
  422, // unprocessable — usually an unsupported document type
])

/**
 * Should the next provider be tried?
 *
 * @param {object} outcome  { status, networkError }
 */
export function shouldFallThrough({ status = 0, networkError = false } = {}) {
  // No response at all means we never reached them. Always worth trying the
  // next one — this is the outage case, and it is the whole point of a chain.
  if (networkError) return true
  if (CONTENT_BAD.has(status)) return false
  if (PROVIDER_DOWN.has(status)) return true
  // An unrecognised failure is treated as provider-side. Erring that way costs
  // one extra call; erring the other way silently loses a result we could have
  // had, and the loss is invisible.
  return status >= 400
}

/**
 * Why a provider was skipped or fell through, in words a person can act on.
 *
 * Surfaced rather than swallowed because "we are running on the backup" is
 * something you want to learn from a report, not from a bill at the end of the
 * month.
 */
export function explainFallThrough(provider, status) {
  if (status === 402 || status === 429) {
    return `${provider} is out of quota or rate limited (${status}) — falling back.`
  }
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key (${status}) — falling back. The key is probably wrong or revoked.`
  }
  if (status >= 500) return `${provider} is having an outage (${status}) — falling back.`
  if (status === 0) return `${provider} could not be reached — falling back.`
  return `${provider} failed (${status}) — falling back.`
}

// ─── One shape, whichever provider answered ────────────────────────────────
// Callers must never branch on which provider served a result, or the seam
// stops being a seam.

/** A single search hit. */
export function normaliseResult(raw, provider) {
  return {
    url: String(raw?.url || raw?.link || ''),
    title: String(raw?.title || raw?.metadata?.title || ''),
    snippet: String(raw?.description || raw?.content || raw?.snippet || '').slice(0, 600),
    provider,
  }
}

/** A page that was actually read. */
export function normalisePage(raw, provider, url) {
  const text = raw?.markdown || raw?.raw_content || raw?.content || ''
  return {
    url: String(raw?.metadata?.sourceURL || raw?.url || url || ''),
    title: String(raw?.metadata?.title || raw?.title || ''),
    // Capped hard. A 200KB page dropped whole into a prompt costs more than
    // every search that found it, and the useful part is almost always early.
    markdown: String(text).slice(0, 20_000),
    truncated: String(text).length > 20_000,
    provider,
  }
}

/**
 * Which providers are actually configured.
 *
 * A provider with no key is skipped silently rather than attempted and failed:
 * a 401 costs a round trip to learn something we already knew from the
 * environment.
 */
export function availableProviders(env = {}) {
  return PROVIDERS.filter(p => {
    if (p === 'firecrawl') return Boolean(env.FIRECRAWL_API_KEY)
    if (p === 'tavily') return Boolean(env.TAVILY_API_KEY)
    return false
  })
}

/**
 * A one-line health note for the brief.
 *
 * Silent when the primary is serving. A note that appears every week is one
 * nobody reads, so this only speaks when something changed.
 */
export function webHealthNote({ used = '', available = [] } = {}) {
  if (!available.length) return 'No web provider is configured, so no lens could read the open web.'
  if (used && used !== available[0]) {
    return `Web research ran on ${used} because ${available[0]} was unavailable. ` +
           `Check the ${available[0]} account before the next run.`
  }
  return ''
}
