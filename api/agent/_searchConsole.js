import crypto from 'node:crypto'
import {
  SC_SCOPE, SC_TOKEN_URL, SC_API, propertyId, queryBody, normalizeRows, searchWindows,
} from '../../src/lib/agent/searchConsole.js'

// ─── Talking to Search Console ─────────────────────────────────────────────
//
// The half that needs a key and a network. Everything that decides what any of
// it MEANS is in src/lib/agent/searchConsole.js, which is pure and tested.
//
// ── WHY THERE IS NO OAUTH FLOW HERE ──
//
// There is no "Connect Google" button, no consent screen, no refresh token and
// no reconnect UI, and that is not a shortcut — it is a different trust model.
// OAuth exists so a PERSON can grant an app access to THEIR data. We do not
// need that: Google issues us an identity of our own (a service account with
// its own email address), and a human grants that identity access to our own
// Search Console property once, by hand, in the Search Console UI.
//
// What remains is technically still an OAuth grant — a JWT signed with the
// service account's private key, exchanged at Google's token endpoint for a
// one-hour access token (RFC 7523). It needs no browser and no user, so it is
// thirty lines of crypto rather than a subsystem.
//
// The day another workspace wants to connect a property WE do not control,
// this stops being enough and a real consent flow has to be built. Until then
// this is the same shape as META_IG_TOKEN: a long-lived server credential.
//
// Deliberately NO dependency. The agent container installs exactly one package
// (@anthropic-ai/sdk — see server/Dockerfile), and pulling in googleapis to
// call two endpoints would add tens of megabytes to an image whose whole point
// is that it holds only what api/agent imports.

// ── The two keys this module reads ──
// Named literally here because vite.config.js's dev allowlist is kept in step
// with `grep -rho 'process\.env\.[A-Z0-9_]*' api/agent/`, and every read below
// goes through an injectable `env` parameter that grep would never find. A key
// missing from that allowlist works in production and reports itself
// unconfigured on a laptop, which is the confusing direction for a bug to run.
//
//   process.env.GOOGLE_SA_KEY    the service account JSON, raw or base64
//   process.env.GOOGLE_SC_SITE   fallback property, when the brand sets none

const b64url = buf => Buffer.from(buf).toString('base64url')

/**
 * The service account JSON, from the environment.
 *
 * Accepted either raw or base64-encoded, because a JSON blob with newlines in
 * a private key survives some .env parsers and not others, and discovering
 * which one you have at 6am on a Monday is not a good use of anyone's time.
 */
export function serviceAccount(env = process.env) {
  const raw = String(env.GOOGLE_SA_KEY || '').trim()
  if (!raw) return null
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const sa = JSON.parse(text)
    if (!sa?.client_email || !sa?.private_key) return null
    return sa
  } catch {
    return null
  }
}

/** Which property to ask about. Configured per brand; never guessed. */
export function siteFor(brandSite, env = process.env) {
  return propertyId(brandSite || env.GOOGLE_SC_SITE || '')
}

/**
 * Sign the assertion Google trades for an access token.
 *
 * RS256 over {header}.{claims}, which is all `urn:ietf:params:oauth:grant-type:jwt-bearer`
 * actually is. The one-hour lifetime is Google's maximum and there is no
 * reason to ask for less: the token is minted per run and never stored.
 */
export function signedAssertion(sa, { now = Math.floor(Date.now() / 1000), scope = SC_SCOPE } = {}) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: SC_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const body = `${header}.${claims}`
  const signature = crypto.createSign('RSA-SHA256').update(body).sign(sa.private_key)
  return `${body}.${b64url(signature)}`
}

/**
 * Trade the assertion for an access token. Throws with Google's own message.
 *
 * `scope` is a parameter rather than a constant because the same service
 * account now reads two products: Search Console and, once somebody installs
 * the tag, GA4. One token cannot cover both — a JWT assertion carries the
 * scopes it asks for, and asking for a scope the property has not granted
 * fails the API call rather than the token request, which would turn a missing
 * GA4 grant into "Search Console is broken". So each product mints its own.
 */
export async function accessToken(sa, scope = SC_SCOPE) {
  const res = await fetch(SC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(sa, { scope }),
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    // Google's error bodies are unusually good. Passing the real one through
    // is the difference between "invalid_grant: Invalid JWT Signature" (the
    // key is mangled) and a generic failure that could be anything.
    throw new Error(`Google refused the token request: ${json.error_description || json.error || res.status}`)
  }
  return json.access_token
}

async function searchAnalytics(token, site, body) {
  const url = `${SC_API}/${encodeURIComponent(site)}/searchAnalytics/query`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`
    // The 403 everyone hits once: the property is verified, the key is fine,
    // and the service account was never added as a user. Say so, because the
    // message Google returns does not.
    if (res.status === 403) {
      throw new Error(
        `${msg} — check that the service account's client_email is added as a user on ${site} ` +
        'in Search Console > Settings > Users and permissions.')
    }
    throw new Error(msg)
  }
  return json.rows || []
}

/**
 * Everything one run needs, in three calls.
 *
 * Queries for the current window and the previous one (so movement is measured
 * rather than asserted), plus query+page rows for the current window, which is
 * what makes "this query lands on the homepage because no page exists for it"
 * detectable at all.
 */
export async function fetchSearchData({ site, now = new Date(), rowLimit = 500, env = process.env } = {}) {
  const sa = serviceAccount(env)
  const property = siteFor(site, env)

  if (!sa) return { ok: false, configured: false, error: 'GOOGLE_SA_KEY is not set.', site: property }
  if (!property) return { ok: false, configured: false, error: 'No Search Console property is configured for this brand.', site: property }

  const windows = searchWindows(now)
  try {
    const token = await accessToken(sa)
    const [current, previous, pages] = await Promise.all([
      searchAnalytics(token, property, queryBody({ ...windows.current, dimensions: ['query'], rowLimit })),
      searchAnalytics(token, property, queryBody({ ...windows.previous, dimensions: ['query'], rowLimit })),
      searchAnalytics(token, property, queryBody({ ...windows.current, dimensions: ['query', 'page'], rowLimit })),
    ])
    return {
      ok: true,
      configured: true,
      site: property,
      windows,
      queries: normalizeRows(current, ['query']),
      previous: normalizeRows(previous, ['query']),
      pages: normalizeRows(pages, ['query', 'page']),
    }
  } catch (err) {
    // Configured but failing is NOT the same as unconfigured, and the report
    // must be able to tell them apart — a dead credential that reads as "quiet"
    // looks exactly like nobody searching for us, which is the silent failure
    // this agent has already been bitten by twice.
    return { ok: false, configured: true, site: property, windows, error: String(err?.message || err).slice(0, 300) }
  }
}

// ─── The whole property, not just its queries ──────────────────────────────
//
// fetchSearchData() above answers ONE question — what are people searching to
// reach us — because that is the only question the weekly research agent and
// the dashboard card ask. The Analytics page asks the property everything it
// will answer, so it needs its own fetch rather than a flag on that one: the
// dashboard card paints on every visit and must stay three calls.
//
// ── WHAT THE NARROW FETCH WAS MISSING, MEASURED ──
//
// On the first live pull of arak-sa.com (28 days to 2026-09-17), web search
// returned 3,312 impressions — and IMAGE search returned 892 more at position
// 39.9, roughly a fifth of the property's total visibility, invisible to every
// screen in this app because `queryBody` defaults to `type: 'web'` and nothing
// ever passed anything else. A page called Analytics that silently drops a
// fifth of the measurements is worse than one that admits it has none.

/** Every search surface Google will report separately. Ordered by how much
 *  any of them has ever mattered here; `discover` and `googleNews` need no
 *  special-casing — they answer zero on a property with no Discover presence,
 *  which is a true answer and renders as one. */
export const SEARCH_TYPES = ['web', 'image', 'video', 'news', 'discover']

/**
 * Run `jobs` with at most `limit` in flight.
 *
 * Search Console's per-site ceiling is 20 queries per second, and a full pull
 * is ~17 calls. Firing them all at once sits exactly on that line, where the
 * failure mode is a 429 on an arbitrary one of them — so the page would lose a
 * different panel each time it loaded. Six at a time is well under, and the
 * whole pull still finishes in three round trips' worth of wall clock.
 */
async function mapLimit(jobs, limit, run) {
  const out = new Array(jobs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await run(jobs[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Everything the Analytics page draws, in one pull.
 *
 * ── WHY EVERY CALL IS ALLOWED TO FAIL ALONE ──
 *
 * Seventeen calls means seventeen chances to turn one empty panel into an
 * empty page. Each one is settled on its own and records its own error, so a
 * property that will not answer `searchAppearance` still shows its queries,
 * its pages and its countries — and the panel that failed says it failed
 * rather than rendering as "nothing happened".
 *
 * The exception is the canary. `web` totals for the current window is the one
 * call whose failure means the credential, the property id or the grant is
 * wrong, and when it fails the whole answer is `ok: false` — because every
 * other panel would then be empty for the same reason, and a page of empty
 * panels reads as a quiet month instead of a broken connection. That is the
 * silent failure this project has already paid for twice.
 */
export async function fetchWebsiteData({ site, now = new Date(), days = 28, env = process.env } = {}) {
  const sa = serviceAccount(env)
  const property = siteFor(site, env)

  if (!sa) return { ok: false, configured: false, error: 'GOOGLE_SA_KEY is not set.', site: property }
  if (!property) return { ok: false, configured: false, error: 'No Search Console property is configured for this brand.', site: property }

  const windows = searchWindows(now, { days })
  let token
  try {
    token = await accessToken(sa)
  } catch (err) {
    return { ok: false, configured: true, site: property, windows, error: String(err?.message || err).slice(0, 300) }
  }

  const cur = windows.current
  const prev = windows.previous

  // Named so the results can be put back together by name rather than by
  // position — a 17-element destructure is a rename away from silently
  // swapping countries for devices.
  const plan = [
    // The daily series spans BOTH windows in one call. Two calls would give
    // the same rows and one more chance to fail, and a single series is also
    // what lets the chart draw the previous period behind the current one
    // without the two disagreeing about where the boundary is.
    { id: 'daily', body: queryBody({ start: prev.start, end: cur.end, dimensions: ['date'], rowLimit: 1000 }) },

    { id: 'queries', body: queryBody({ ...cur, dimensions: ['query'], rowLimit: 500 }) },
    { id: 'previousQueries', body: queryBody({ ...prev, dimensions: ['query'], rowLimit: 500 }) },
    // Both dimensions, which is what makes "this query lands on the homepage
    // because no page of ours answers it" detectable at all.
    { id: 'queryPages', body: queryBody({ ...cur, dimensions: ['query', 'page'], rowLimit: 1000 }) },

    // Page rows on their own, NOT derived from the pair above. Google withholds
    // rare queries for privacy, so the query+page rows do not add up to the
    // property's real page totals — deriving page numbers from them
    // undercounts every page, by a different amount each period.
    { id: 'pages', body: queryBody({ ...cur, dimensions: ['page'], rowLimit: 500 }) },
    { id: 'previousPages', body: queryBody({ ...prev, dimensions: ['page'], rowLimit: 500 }) },

    { id: 'countries', body: queryBody({ ...cur, dimensions: ['country'], rowLimit: 250 }) },
    { id: 'devices', body: queryBody({ ...cur, dimensions: ['device'], rowLimit: 10 }) },
    { id: 'previousDevices', body: queryBody({ ...prev, dimensions: ['device'], rowLimit: 10 }) },
    // Rich results, FAQs, translated results and the rest. Usually thin — this
    // property reported a single translated-result impression — but when it is
    // not thin it is the difference between "we rank" and "we rank and Google
    // is giving us the whole answer box".
    { id: 'appearance', body: queryBody({ ...cur, dimensions: ['searchAppearance'], rowLimit: 50 }) },

    // One row of totals per surface, per window. No dimensions, so these are
    // the cheapest calls in the pull and the only place image search has ever
    // been counted here.
    ...SEARCH_TYPES.flatMap(type => ([
      { id: `type:${type}`, body: queryBody({ ...cur, dimensions: [], rowLimit: 1, type }) },
      { id: `prevType:${type}`, body: queryBody({ ...prev, dimensions: [], rowLimit: 1, type }) },
    ])),
  ]

  const settled = await mapLimit(plan, 6, async job => {
    try {
      return { id: job.id, rows: await searchAnalytics(token, property, job.body), error: '' }
    } catch (err) {
      return { id: job.id, rows: [], error: String(err?.message || err).slice(0, 300) }
    }
  })

  const by = new Map(settled.map(r => [r.id, r]))
  const rowsOf = (id, dimensions) => normalizeRows(by.get(id)?.rows || [], dimensions)

  // The canary. See the note above: this one failing means nothing else could
  // have succeeded for a different reason.
  const canary = by.get('type:web')
  if (canary?.error) {
    return { ok: false, configured: true, site: property, windows, error: canary.error }
  }

  const warnings = settled.filter(r => r.error).map(r => ({ part: r.id, error: r.error }))

  const types = {}
  for (const type of SEARCH_TYPES) {
    const row = (by.get(`type:${type}`)?.rows || [])[0]
    const was = (by.get(`prevType:${type}`)?.rows || [])[0]
    types[type] = {
      clicks: Number(row?.clicks) || 0,
      impressions: Number(row?.impressions) || 0,
      ctr: Number(row?.ctr) || 0,
      position: Number(row?.position) || 0,
      previous: {
        clicks: Number(was?.clicks) || 0,
        impressions: Number(was?.impressions) || 0,
        ctr: Number(was?.ctr) || 0,
        position: Number(was?.position) || 0,
      },
    }
  }

  return {
    ok: true,
    configured: true,
    site: property,
    windows,
    warnings,
    daily: rowsOf('daily', ['date']),
    queries: rowsOf('queries', ['query']),
    previous: rowsOf('previousQueries', ['query']),
    pages: rowsOf('queryPages', ['query', 'page']),
    pageTotals: rowsOf('pages', ['page']),
    previousPageTotals: rowsOf('previousPages', ['page']),
    countries: rowsOf('countries', ['country']),
    devices: rowsOf('devices', ['device']),
    previousDevices: rowsOf('previousDevices', ['device']),
    appearance: rowsOf('appearance', ['searchAppearance']),
    types,
  }
}

/**
 * The sitemaps Google is actually reading, and when it last bothered.
 *
 * Not a search metric, and on the page it sits apart from them — but it is the
 * cheapest explanation there is for why a page takes no impressions. This
 * property's sitemap was submitted in 2021 and last downloaded in February
 * 2026, nineteen months before the first pull that looked, and it points at
 * the `www` host that 301s to the apex. Nothing in the numbers above can tell
 * you that, and no amount of rewriting titles fixes it.
 *
 * Its own try/catch: a property whose sitemaps endpoint refuses still has
 * perfectly good search numbers, and the page shows them.
 */
export async function fetchSitemaps({ site, env = process.env } = {}) {
  const sa = serviceAccount(env)
  const property = siteFor(site, env)
  if (!sa || !property) return { ok: false, sitemaps: [] }
  try {
    const token = await accessToken(sa)
    const res = await fetch(`${SC_API}/${encodeURIComponent(property)}/sitemaps`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, sitemaps: [], error: json?.error?.message || `HTTP ${res.status}` }
    return {
      ok: true,
      sitemaps: (json.sitemap || []).map(s => ({
        path: String(s.path || ''),
        lastSubmitted: s.lastSubmitted || '',
        lastDownloaded: s.lastDownloaded || '',
        isPending: !!s.isPending,
        isSitemapsIndex: !!s.isSitemapsIndex,
        warnings: Number(s.warnings) || 0,
        errors: Number(s.errors) || 0,
      })),
    }
  } catch (err) {
    return { ok: false, sitemaps: [], error: String(err?.message || err).slice(0, 300) }
  }
}
