import { DKIM_SELECTORS, judgeDomain } from '../../src/lib/email/domainCheck.js'

// ─── Looking up a sending domain's DNS ─────────────────────────────────────
// The answers judged by src/lib/email/domainCheck.js. "Not there" (NODATA,
// NOTFOUND) is an answer; a timeout or a server failure is not, and is
// reported in `failed` so a slow resolver never reads as a missing record.
//
//   resolver   anything with resolveMx / resolveTxt / resolveCname (tests
//              pass a fake; the server uses dohResolver below)
//
// Why DNS over HTTPS and not node:dns: Node's resolver timed out on large
// answers (GoDaddy's SPF chain, Microsoft's DKIM keys) on 2026-10-08, which
// would have read as "could not be checked" for exactly the records that
// matter. One HTTPS request per question, to Google, then Cloudflare.

const ABSENT = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ENONAME'])
const MAX_SPF_LOOKUPS = 10   // the SPF standard's own limit

const DOH = [
  name => `https://dns.google/resolve?name=${encodeURIComponent(name)}`,
  name => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}`,
]
const TYPE = { TXT: 16, MX: 15, CNAME: 5 }

/** TXT data as DNS-over-HTTPS returns it: one or more quoted strings → their text. */
export function unquoteTxt(data) {
  const s = String(data || '')
  const parts = [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\(.)/g, '$1'))
  return parts.length ? parts.join('') : s
}

/** A resolver with node:dns's shape, over DNS-over-HTTPS. */
export function dohResolver({ fetch: f = fetch, timeoutMs = 4000 } = {}) {
  async function query(name, type) {
    let lastErr = null
    for (const url of DOH) {
      try {
        const res = await f(`${url(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok) throw new Error(`DNS answered ${res.status}`)
        const body = await res.json()
        // 0 = an answer (maybe empty), 3 = the name does not exist.
        if (body.Status === 3) throw Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' })
        if (body.Status !== 0) throw Object.assign(new Error(`DNS status ${body.Status}`), { code: 'ESERVFAIL' })
        const rows = (body.Answer || []).filter(a => a.type === TYPE[type])
        if (!rows.length) throw Object.assign(new Error('NODATA'), { code: 'ENODATA' })
        return rows.map(a => a.data)
      } catch (err) {
        if (err?.code === 'ENOTFOUND' || err?.code === 'ENODATA') throw err
        lastErr = err
      }
    }
    throw Object.assign(lastErr || new Error('DNS lookup failed'), { code: lastErr?.code || 'ETIMEOUT' })
  }
  return {
    resolveTxt: async name => (await query(name, 'TXT')).map(d => [unquoteTxt(d)]),
    resolveMx: async name => (await query(name, 'MX')).map(d => {
      const [priority, exchange] = String(d).trim().split(/\s+/)
      return { priority: Number(priority) || 0, exchange: String(exchange || '').replace(/\.$/, '') }
    }),
    resolveCname: async name => (await query(name, 'CNAME')).map(d => String(d).replace(/\.$/, '')),
  }
}

function defaultResolver() {
  return dohResolver()
}

/** [] when the record is absent; throws only when the lookup itself failed. */
async function ask(fn) {
  try { return await fn() } catch (err) {
    if (ABSENT.has(err?.code)) return []
    throw err
  }
}

const joinTxt = rows => (rows || []).map(r => (Array.isArray(r) ? r.join('') : String(r)))

/**
 * Follow a domain's SPF includes and redirects, as receivers do, up to the
 * standard's 10 lookups. Returns every domain reached and whether the walk
 * finished (a dead end that is a timeout leaves it unfinished).
 */
async function walkSpf(resolver, record) {
  const reached = []
  const queue = [record]
  let lookups = 0
  let complete = true
  while (queue.length) {
    const rec = queue.shift()
    const targets = [...rec.matchAll(/\b(?:include:|redirect=)([^\s]+)/gi)].map(m => m[1].toLowerCase())
    for (const t of targets) {
      if (reached.includes(t)) continue
      reached.push(t)
      if (++lookups > MAX_SPF_LOOKUPS) { complete = false; continue }
      try {
        const next = joinTxt(await ask(() => resolver.resolveTxt(t))).find(s => /^v=spf1\b/i.test(s))
        if (next) queue.push(next)
      } catch {
        complete = false
      }
    }
  }
  return { reached, complete }
}

/**
 * Everything the check needs about one domain, and the verdict.
 * @returns {Promise<{ domain, kind, mx, spf, spfIncludes, spfComplete, dkim, dkimPending, dmarc, failed, blocking, warnings, checked_at }>}
 */
export async function lookupDomain(domain, kind = 'other', { resolver = defaultResolver(), now = new Date() } = {}) {
  const d = String(domain || '').trim().toLowerCase()
  const found = { domain: d, kind, mx: [], spf: [], spfIncludes: [], spfComplete: true, dkim: [], dkimPending: [], dmarc: '', failed: [] }

  await Promise.all([
    (async () => {
      try { found.mx = (await ask(() => resolver.resolveMx(d))).map(r => r.exchange).filter(Boolean) } catch { found.failed.push('mx') }
    })(),
    (async () => {
      try {
        found.spf = joinTxt(await ask(() => resolver.resolveTxt(d))).filter(s => /^v=spf1\b/i.test(s))
        if (found.spf.length === 1) {
          const walk = await walkSpf(resolver, found.spf[0])
          found.spfIncludes = walk.reached
          found.spfComplete = walk.complete
        }
      } catch { found.failed.push('spf') }
    })(),
    (async () => {
      let errors = 0
      const selectors = DKIM_SELECTORS[kind] || DKIM_SELECTORS.other
      await Promise.all(selectors.map(async sel => {
        const name = `${sel}._domainkey.${d}`
        try {
          // resolveTxt follows a CNAME (Microsoft's selector1 → its own host).
          const key = joinTxt(await ask(() => resolver.resolveTxt(name))).find(s => /(^|;)\s*p=[A-Za-z0-9+/]/.test(s))
          if (key) { found.dkim.push(sel); return }
          const cname = resolver.resolveCname ? await ask(() => resolver.resolveCname(name)) : []
          if (cname.length) found.dkimPending.push(sel)
        } catch { errors++ }
      }))
      if (!found.dkim.length && errors) found.failed.push('dkim')
    })(),
    (async () => {
      try { found.dmarc = joinTxt(await ask(() => resolver.resolveTxt(`_dmarc.${d}`))).find(s => /^v=DMARC1\b/i.test(s)) || '' } catch { found.failed.push('dmarc') }
    })(),
  ])

  found.dkim.sort()
  return { ...found, ...judgeDomain(found, kind), checked_at: now.toISOString() }
}
