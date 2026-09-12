// ─── A real number, or null ────────────────────────────────────────────────
// One function, because this codebase has now been bitten by the same thing
// five times.
//
// `Number(null)` is `0`. `Number('')` is `0`. `Number(false)` is `0`. And
// `Number.isFinite(0)` is `true` — so the guard everyone reaches for first,
//
//     Number.isFinite(Number(x)) ? Number(x) : fallback
//
// reports every one of those as the number zero. The damage is never a crash.
// It is a missing follower count rendered as "0 followers", a missing duration
// rendered as "0s", an absent engagement rate charted as a real floor. Each
// one reads as a measurement and is actually an absence, which is the specific
// failure this whole agent is built against: a number nobody can tell is not
// there is worse than a blank, because it is convincing.
//
// Occurrences so far: gather's engagement maths, the cost ledger, the calendar
// deltas, researchBrief's formatters, and progress's durations. Two of those
// were caught by a test, one by reading a page, and the rest by luck.
//
// So: import this rather than writing the guard again.

/**
 * Coerce to a finite number, or null when there genuinely is not one.
 *
 * Booleans are rejected deliberately — `Number(true)` is `1`, and a `true`
 * arriving where a count belongs is a bug upstream, not a quantity of one.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function num(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Same, but with a floor you choose — for the places that genuinely want a
 * number and have a sensible default, like summing a cost ledger.
 *
 * Separate from `num` on purpose: a caller that wants zero should have to say
 * so, rather than getting it by accident from a helper that silently defaults.
 */
export function numOr(value, fallback = 0) {
  const n = num(value)
  return n === null ? fallback : n
}
