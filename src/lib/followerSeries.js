// ─── Which follower series to believe ──────────────────────────────────────
//
// Two sources fill the same line. `accounts/follower-stats` is cross-platform;
// `analytics/instagram/follower-history` is Instagram's own. Both are written
// by Zernio's DAILY snapshotter, so an account connected today has neither
// until tomorrow.
//
// ── WHY "LONGER" AND NOT "FIRST" ──
//
// This used to take follower-stats whenever it returned anything at all and
// fall back to the history only when it was EMPTY. The two are different
// pipelines on the same clock, so the one that answers is not the one with
// the most behind it: a single-point follower-stats hid a sixty-point
// history, and the chart drew one day inside a ninety-day window.
//
// Neither is "more correct" — they are the same measurement taken by two
// paths — so the tie-break is simply which one has more of it.

/**
 * @param {object} payload A `/api/zernio/analytics` or `/api/zernio/followers`
 *   response — both carry `followers` and, for Instagram, `followerHistory`.
 * @param {string} [accountId] Scopes follower-stats, which is keyed by account.
 * @returns {Array<{date: string, followers: number}>} oldest first
 */
export function followerRowsFrom(payload, accountId = '') {
  const stats = payload?.followers?.stats || {}
  const fromStats = accountId ? (stats[accountId] || []) : Object.values(stats).flat()
  const fromHistory = (payload?.followerHistory?.metrics?.follower_count?.values || [])
    .map(v => ({ date: v.date, followers: v.value }))
  return fromHistory.length > fromStats.length ? fromHistory : fromStats
}

/** "6 days recorded · 2026-09-15 to 2026-09-20", or '' for an empty series. */
export function followerSpanLabel(rows = []) {
  if (!rows.length) return ''
  const n = rows.length
  const first = rows[0]?.date
  const last = rows[n - 1]?.date
  return `${n} day${n === 1 ? '' : 's'} recorded · ${first}${first === last ? '' : ` to ${last}`}`
}
