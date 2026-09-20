// ─── Reach, split by whether the person already follows the account ────────
//
// "Are we talking to the room or to the street." A month where almost all
// reach is FOLLOWER means the posts are circulating among people who already
// know us; a month where it is mostly NON_FOLLOWER means the account is
// actually reaching outward, which is the whole point of posting.
//
// ── WHY THIS IS REACH AND NOT ENGAGEMENT ──
//
// `follow_type` is the only follower/non-follower breakdown Instagram offers,
// and reach is the ONLY metric that accepts it. Measured live against Zernio
// on 2026-09-20: `metrics=reach&breakdown=follow_type` answers
// `{FOLLOWER: 1, NON_FOLLOWER: 9}`, while the same call for accounts_engaged,
// total_interactions, likes or comments is a 400 that names the valid
// breakdowns ("Valid: none" and "Valid: media_product_type" respectively).
//
// So there is no follower/non-follower split of likes or comments to be had.
// That is Meta's limit, not Zernio's and not ours, and it is said on screen
// rather than approximated — a "split" of engagement computed by applying the
// reach ratio to interactions would be a number we invented.
//
// ── AND WHY EVERY FIELD CAN BE NULL ──
//
// The house rule: a number nobody measured is null, never 0. Instagram omits
// a breakdown an account cannot fill, and an account with no reach in the
// window has no breakdown array at all. Folding that to zero would print
// "0 non-followers reached" — indistinguishable on screen from an account
// that reached a hundred people who all already followed it.

export const FOLLOWER = 'FOLLOWER'
export const NON_FOLLOWER = 'NON_FOLLOWER'

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * Zernio's account-insights answer, reduced to the two sides.
 *
 * @returns {{ total: number|null, follower: number|null, nonFollower: number|null, error: string }}
 */
export function splitReach(payload) {
  const blank = { total: null, follower: null, nonFollower: null, error: '' }
  if (!payload) return blank
  if (payload._error) return { ...blank, error: String(payload._error) }

  const reach = payload.metrics?.reach
  if (!reach) return blank

  const rows = Array.isArray(reach.breakdowns) ? reach.breakdowns : []
  const find = dim => {
    const row = rows.find(r => String(r?.dimension).toUpperCase() === dim)
    return row ? num(row.value) : null
  }

  return {
    total: num(reach.total),
    follower: find(FOLLOWER),
    nonFollower: find(NON_FOLLOWER),
    error: '',
  }
}

/**
 * The reach attributable to the sides currently ticked.
 *
 * Null when none of the ticked sides was measured — the sum of nothing is not
 * zero. A side that was measured as genuinely 0 still counts, which is why
 * this tests for `typeof number` rather than truthiness.
 */
export function reachFor(split, sides) {
  const picked = []
  if (sides?.has?.(FOLLOWER) && typeof split?.follower === 'number') picked.push(split.follower)
  if (sides?.has?.(NON_FOLLOWER) && typeof split?.nonFollower === 'number') picked.push(split.nonFollower)
  if (!picked.length) return null
  return picked.reduce((a, b) => a + b, 0)
}

/**
 * Each side's share of the two, as a percentage, or null.
 *
 * Deliberately over `follower + nonFollower` and NOT over `total`. Instagram's
 * own total is computed across every surface and is not always the sum of the
 * two sides — a person Instagram could not classify is in the total and in
 * neither breakdown — so dividing by it produces two shares that do not add up
 * to a hundred and look like a rounding bug.
 */
export function shareOf(split) {
  const a = typeof split?.follower === 'number' ? split.follower : null
  const b = typeof split?.nonFollower === 'number' ? split.nonFollower : null
  if (a === null || b === null) return { follower: null, nonFollower: null }
  const sum = a + b
  if (!sum) return { follower: null, nonFollower: null }
  return { follower: (a / sum) * 100, nonFollower: (b / sum) * 100 }
}
