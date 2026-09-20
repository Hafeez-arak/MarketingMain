// The JWT lives next door.
//
// `serviceAccount` and `accessToken` were written for Search Console and are
// imported rather than copied, because the credential really is the same one:
// a single service account that a human grants access to two Google products,
// once each, by hand. Duplicating the signing code here would mean two places
// to fix the day a key format changes, and the failure would show up in only
// one of them. `accessToken` takes a scope for exactly this reason — see its
// note on why one token cannot cover both.
import { serviceAccount, accessToken } from './_searchConsole.js'
import {
  GA4_SCOPE, GA4_API, propertyPath, reportPlan, normalizeReport, totalsOf, TOTAL_METRICS,
} from '../../src/lib/agent/ga4.js'
import { searchWindows } from '../../src/lib/agent/searchConsole.js'

// ─── Talking to GA4 ────────────────────────────────────────────────────────
//
// The half that needs a key and a network. Everything that decides what any of
// it MEANS is in src/lib/agent/ga4.js, which is pure and tested.
//
// ── WHY runReport PER REPORT AND NOT batchRunReports ──
//
// The Data API will take five reports in one call, and this asks for eleven,
// so two batches would be the obvious shape and half the round trips.
//
// It is not worth it. A batch is atomic: one report naming a metric this
// property does not have takes the other four down with it, and returns a
// single 400 that names the offending metric in prose. The metrics most likely
// to be wrong are exactly the ones a property might not have — `keyEvents`
// replaced `conversions` in 2025 and the old name errors rather than aliasing,
// and a property with no key events configured is a completely normal state.
// Batched, that turns four working panels into an empty page; one call each,
// it turns one panel into "nothing is marked as a key event yet", which is
// both true and useful.
//
// Eleven small reports at four in flight is about two seconds. The page can
// afford it; it cannot afford being blank for a reason nobody can see.
//
// ── The two keys this module reads ──
// Kept literal for vite.config.js's dev allowlist, which is maintained from
//   grep -rho 'process\.env\.[A-Z0-9_]*' api/agent/
//
//   process.env.GOOGLE_SA_KEY          the same service account as Search Console
//   process.env.GOOGLE_GA4_PROPERTY    fallback property, when the brand sets none

/** Run `jobs` with at most `limit` in flight. */
async function mapLimit(jobs, limit, run) {
  const out = new Array(jobs.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await run(jobs[i], i)
    }
  }))
  return out
}

/** Which property to ask about. Configured per brand; never guessed. */
export function propertyFor(brandProperty, env = process.env) {
  return propertyPath(brandProperty || env.GOOGLE_GA4_PROPERTY || '')
}

async function runReport(token, property, body) {
  const res = await fetch(`${GA4_API}/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`
    // The 403 everyone hits once, and its GA4-specific cure. The property
    // exists, the key is fine, and the service account was never added to the
    // property's Access Management — which Google's message does not say.
    if (res.status === 403) {
      throw new Error(
        `${msg} — add the service account's client_email as a Viewer on this property in ` +
        'GA4 → Admin → Property access management.')
    }
    // A 404 here is almost always the wrong number rather than a deleted
    // property, and saying so saves the hour spent checking GA4 for a property
    // that was never the one being asked about.
    if (res.status === 404) {
      throw new Error(`${msg} — no GA4 property with this id, or the service account cannot see it.`)
    }
    throw new Error(msg)
  }
  return json
}

/**
 * Everything the Analytics page's GA4 half draws, in one pull.
 *
 * ── WHY THE SAME WINDOW AS SEARCH CONSOLE, LAG AND ALL ──
 *
 * GA4 does not have Search Console's three-day settling delay; its numbers are
 * near-complete within a day. Given that, ending this window three days back
 * throws away two days of data GA4 already has.
 *
 * It is thrown away on purpose. These two sets of numbers sit on one screen,
 * and a reader WILL compare them — that is the entire reason for putting them
 * together. Search clicks against sessions over two different windows is a
 * comparison that is wrong by two days at the exact end of the range where a
 * spike is most likely to be, and nothing on the page could make that legible.
 * The app already learned this the expensive way with a 29-day platform strip
 * stacked on a 90-day post strip (see `windowLabel` in pages/analytics/format).
 * One window, stated once, for both halves.
 */
export async function fetchGa4Data({
  property, now = new Date(), days = 28, from = '', to = '', env = process.env,
} = {}) {
  const sa = serviceAccount(env)
  const resolved = propertyFor(property, env)

  if (!sa) return { ok: false, configured: false, error: 'GOOGLE_SA_KEY is not set.', property: '' }
  if (resolved.error) return { ok: false, configured: false, error: resolved.error, property: '' }
  if (!resolved.path) {
    return { ok: false, configured: false, error: 'No GA4 property is configured for this brand.', property: '' }
  }

  const windows = searchWindows(now, { days, from, to })
  let token
  try {
    token = await accessToken(sa, GA4_SCOPE)
  } catch (err) {
    return { ok: false, configured: true, property: resolved.path, windows, error: String(err?.message || err).slice(0, 300) }
  }

  const plan = reportPlan(windows)
  const settled = await mapLimit(plan, 4, async job => {
    try {
      return { id: job.id, res: await runReport(token, resolved.path, job.body), error: '', optional: !!job.optional }
    } catch (err) {
      return { id: job.id, res: null, error: String(err?.message || err).slice(0, 300), optional: !!job.optional }
    }
  })

  const by = new Map(settled.map(r => [r.id, r]))
  const rowsOf = id => (by.get(id)?.res ? normalizeReport(by.get(id).res) : [])

  // The canary, same rule as Search Console's: `totals` failing means the
  // credential, the property id or the grant is wrong, and every other panel
  // is empty for that reason rather than because nobody visited. A page of
  // zeroes reads as a dead website; it must never stand in for a dead
  // connection.
  const canary = by.get('totals')
  if (canary?.error) {
    return { ok: false, configured: true, property: resolved.path, windows, error: canary.error }
  }

  return {
    ok: true,
    configured: true,
    property: resolved.path,
    windows,
    warnings: settled.filter(r => r.error && !r.optional).map(r => ({ part: r.id, error: r.error })),
    totals: totalsOf(rowsOf('totals'), TOTAL_METRICS),
    previousTotals: totalsOf(rowsOf('previousTotals'), TOTAL_METRICS),
    daily: rowsOf('daily'),
    channels: rowsOf('channels'),
    sources: rowsOf('sources'),
    pages: rowsOf('pages'),
    landings: rowsOf('landings'),
    countries: rowsOf('countries'),
    devices: rowsOf('devices'),
    events: rowsOf('events'),
    keyEvents: rowsOf('keyEvents'),
    // Said plainly rather than inferred from an empty array: "no key events
    // are configured" and "the key-events report failed" look identical on
    // screen and mean completely different things.
    keyEventsAvailable: !by.get('keyEvents')?.error,
  }
}
