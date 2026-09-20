// ─── The window every analytics surface is asked for ───────────────────────
//
// Four pickers on three pages each held their own number and offered the same
// three choices — 7, 30, 90 on the dashboard and the account pages, 7, 28, 90
// on the website. None of them could express "the two weeks of the trade show"
// or "last month", which is the window somebody actually wants when they are
// checking whether a campaign worked.
//
// ── WHY A RANGE IS TWO SHAPES AND NOT ONE ──
//
// A rolling window and a fixed one are different questions and must stay
// different values. `{ days: 30 }` means "the last thirty days, whenever you
// ask" — it re-resolves every load, which is what a dashboard wants. `{ from,
// to }` means two specific dates and never moves, which is what a comparison
// wants. Flattening the first into the second at pick time freezes it: the
// dashboard would quietly keep showing the thirty days that ended the morning
// somebody first opened it.
//
// So the preset stays a preset all the way to the request, and only the server
// turns it into dates, against its own clock.
//
// ── THE CAP IS OURS, THE LIMITS ARE THEIRS ──
//
// Zernio takes arbitrary `since`/`until` on every analytics endpoint — the old
// three-value whitelist was ours, not a platform limit (verified live against
// the spec and a 45-day window ending five days ago). What the platforms DO
// cap is how far back a particular metric reaches: Instagram account insights
// refuse more than 30 days between since and until, LinkedIn's page aggregate
// refuses more than 88. Those caps are applied per request where they bite,
// not here, because they differ per platform and clamping them up front would
// shrink the post numbers — which have no such cap — to match.

/** Days either side of which a range is refused outright. */
export const MAX_RANGE_DAYS = 365

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

export const isoDay = ms => new Date(ms).toISOString().slice(0, 10)

/** Today in UTC, the clock every date in this app is kept on. */
export const todayIso = (now = Date.now()) => isoDay(now)

const parse = d => (ISO.test(String(d)) ? Date.parse(`${d}T00:00:00Z`) : NaN)

// The shape and the day are two different checks. "2026-13-45" matches the
// pattern perfectly and is not a date, and letting it through produced a
// range with a NaN end that passed every comparison below it — NaN is never
// greater than anything, so neither the ordering check nor the future check
// would fire and the window came out "valid" and empty.
const isRealDay = d => ISO.test(String(d)) && !Number.isNaN(parse(d))

/** Whole days covered by a fixed range, counting both ends. */
export const spanOf = (from, to) => {
  const a = parse(from)
  const b = parse(to)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / DAY_MS) + 1
}

export const isPreset = r => typeof r?.days === 'number' && Number.isFinite(r.days)
export const isCustom = r => typeof r?.from === 'string' && typeof r?.to === 'string'

/**
 * A range, or the reason it is not one.
 *
 * Returns `{ range }` or `{ error }` — never a half-valid object. A picker
 * that silently corrected "2026-13-45" to something plausible would send a
 * window nobody chose, and the numbers that came back would be right for a
 * question nobody asked.
 */
export function normalizeRange(input, { maxDays = MAX_RANGE_DAYS, minDays = 1, now = Date.now() } = {}) {
  if (isCustom(input)) {
    const { from, to } = input
    if (!isRealDay(from) || !isRealDay(to)) {
      return { error: 'Both dates must be real calendar days.' }
    }
    if (parse(from) > parse(to)) {
      return { error: 'The first date has to come before the second.' }
    }
    // Tomorrow has not been measured. Allowing it looks harmless and produces
    // a window whose last days are permanently empty, which reads on a chart
    // as a campaign that stopped rather than as days that have not happened.
    const today = todayIso(now)
    if (parse(to) > parse(today)) {
      return { error: `The last date cannot be after today (${today}).` }
    }
    const span = spanOf(from, to)
    if (span > maxDays) {
      return { error: `That is ${span} days. The most this can show at once is ${maxDays}.` }
    }
    // Some surfaces have a floor as well as a ceiling. Search Console's is a
    // week: below that a weekday effect reads as a trend, and the site's
    // volume makes a three-day window mostly zeroes with a percentage sign on
    // it. The floor is the caller's to set, because it is a property of the
    // data source and not of dates.
    if (span < minDays) {
      return { error: `That is ${span} day${span === 1 ? '' : 's'}. This needs at least ${minDays}.` }
    }
    return { range: { from, to } }
  }

  const days = Number(input?.days ?? input)
  if (!Number.isFinite(days) || days < 1) return { error: 'Pick a number of days.' }
  if (days > maxDays) return { error: `The most this can show at once is ${maxDays} days.` }
  if (days < minDays) return { error: `This needs at least ${minDays} days.` }
  return { range: { days: Math.round(days) } }
}

/**
 * The dates a range covers, resolved against a clock.
 *
 * A preset resolves here and nowhere earlier — see the note at the top of the
 * file about why `{ days: 30 }` must survive as far as the request.
 */
export function resolveRange(range, { now = Date.now() } = {}) {
  if (isCustom(range)) {
    return { fromDate: range.from, toDate: range.to, days: spanOf(range.from, range.to) }
  }
  const days = isPreset(range) ? range.days : 30
  return { fromDate: isoDay(now - days * DAY_MS), toDate: isoDay(now), days }
}

// en-US, and deliberately: the chart axes already print "Sep 16" through
// `shortDay`, and en-GB renders the same month as "Sept". A label above an
// axis that abbreviates the month differently from the axis reads as two
// different months.
const MONTH = { month: 'short', day: 'numeric', timeZone: 'UTC' }

/** "Last 30 days", or "Aug 18 – Sep 16, 2026" for a window somebody chose. */
export function rangeLabel(range) {
  if (isCustom(range)) {
    const a = new Date(`${range.from}T00:00:00Z`)
    const b = new Date(`${range.to}T00:00:00Z`)
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'Custom range'
    const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
    const fmt = (d, withYear) => d.toLocaleDateString('en-US', withYear ? { ...MONTH, year: 'numeric' } : MONTH)
    return `${fmt(a, !sameYear)} – ${fmt(b, true)}`
  }
  return `Last ${isPreset(range) ? range.days : 30} days`
}

/**
 * A range as query parameters, and back.
 *
 * The two shapes stay distinguishable across the wire: a preset sends `days`
 * and a fixed window sends `from`+`to`, so the server can tell "the last
 * thirty days" from "these thirty days" and resolve the first against its own
 * clock rather than the browser's.
 */
export function rangeParams(range) {
  return isCustom(range) ? { from: range.from, to: range.to } : { days: String(isPreset(range) ? range.days : 30) }
}

export function rangeFromParams(params, opts = {}) {
  const get = k => (typeof params?.get === 'function' ? params.get(k) : params?.[k])
  const from = get('from')
  const to = get('to')
  if (from && to) {
    const { range } = normalizeRange({ from, to }, opts)
    if (range) return range
  }
  const days = Number(get('days'))
  const { range } = normalizeRange({ days: Number.isFinite(days) && days > 0 ? days : 30 }, opts)
  return range || { days: 30 }
}
