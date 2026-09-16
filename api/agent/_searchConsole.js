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

/** Trade the assertion for an access token. Throws with Google's own message. */
export async function accessToken(sa) {
  const res = await fetch(SC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(sa),
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
