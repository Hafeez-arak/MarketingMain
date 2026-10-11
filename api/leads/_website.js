import { lookup } from 'node:dns/promises'
import { pageSummary, fetchableHost, publicAddress } from '../../src/lib/leads/website.js'

// ─── The website check: fetch once per domain, remember it ─────────────────
// A sender's homepage, read once and kept in lead_domains for KEEP_DAYS, so
// the second email from the same company costs nothing and waits for nothing.
// A site that fails is remembered too, for a shorter time, so a dead domain
// does not slow every round.
//
// The address comes from an email we did not write, so the fetch is guarded:
// only http(s) to a public name that resolves to public addresses, every
// redirect checked the same way, a short timeout, and only the first part of
// the page read. Nothing is sent but a plain GET.
//
//   deps.db       PostgREST with the service key
//   deps.fetch    the network
//   deps.now()    the clock
//   deps.resolve  (host) → [ip], for tests; DNS by default

export const KEEP_DAYS = 60
export const RETRY_FAILED_DAYS = 3
const TIMEOUT_MS = 6000
const MAX_BYTES = 400_000
const MAX_REDIRECTS = 3

async function resolvesPublic(deps, host) {
  if (!fetchableHost(host)) return false
  try {
    const ips = deps.resolve
      ? await deps.resolve(host)
      : (await lookup(host, { all: true })).map((r) => r.address)
    return ips.length > 0 && ips.every(publicAddress)
  } catch { return false }
}

async function readCapped(res) {
  if (!res.body?.getReader) return (await res.text()).slice(0, MAX_BYTES)
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value); size += value.length
  }
  reader.cancel().catch(() => {})
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
}

/** Fetch a homepage, following at most a few checked redirects. → { ok, title, description, text, error } */
export async function fetchSite(deps, domain) {
  let url = `https://${domain}/`
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed
    try { parsed = new URL(url) } catch { return { ok: false, error: 'bad address' } }
    if (!/^https?:$/.test(parsed.protocol) || (parsed.port && !['80', '443'].includes(parsed.port))) return { ok: false, error: 'not a web address' }
    if (!(await resolvesPublic(deps, parsed.hostname))) {
      if (hop === 0 && !parsed.hostname.startsWith('www.')) { url = `https://www.${domain}/`; continue }
      return { ok: false, error: 'not a public address' }
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await deps.fetch(parsed.href, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArakLeadCheck/1.0)', Accept: 'text/html' },
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), parsed.href).href
        continue
      }
      if (!res.ok) return { ok: false, error: `answered ${res.status}` }
      if (!/html|text\/plain/i.test(res.headers.get('content-type') || 'text/html')) return { ok: false, error: 'not a web page' }
      return { ok: true, ...pageSummary(await readCapped(res)) }
    } catch (err) {
      // The bare domain failed over https: try www. once, as many sites only answer there.
      if (hop === 0 && !parsed.hostname.startsWith('www.')) { url = `https://www.${domain}/`; continue }
      return { ok: false, error: err.name === 'AbortError' ? 'timed out' : 'could not connect' }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, error: 'too many redirects' }
}

/**
 * What the domain's website says, from the cache when fresh. Never throws:
 * a failure is a result ({ ok: false }) the model is told about.
 */
export async function checkWebsite(deps, domain) {
  const d = String(domain || '').toLowerCase()
  if (!d) return null
  const now = deps.now()
  const [cached] = await deps.db(`lead_domains?domain=eq.${encodeURIComponent(d)}&select=*`).catch(() => []) || []
  if (cached) {
    const age = now.getTime() - Date.parse(cached.checked_at)
    if (age < (cached.ok ? KEEP_DAYS : RETRY_FAILED_DAYS) * 86_400_000) {
      return { domain: d, ok: cached.ok, title: cached.title, description: cached.description, text: cached.text, error: cached.error, cached: true }
    }
  }
  const got = await fetchSite(deps, d).catch(() => ({ ok: false, error: 'could not connect' }))
  const row = {
    domain: d, ok: Boolean(got.ok), title: got.title || '', description: got.description || '',
    text: got.text || '', error: got.error || '', checked_at: now.toISOString(),
  }
  await deps.db('lead_domains?on_conflict=domain', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: row,
  }).catch(() => {})
  return { domain: d, ok: row.ok, title: row.title, description: row.description, text: row.text, error: row.error, cached: false }
}
