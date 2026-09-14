// Number and time formatting shared by the Analytics graphs and the pages
// that frame them. Kept out of Dashboard.jsx so that file exports only
// components, which is what fast refresh needs.

export const fmt = n => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(Math.round(n) || 0)

/**
 * The follower count across whichever sources have actually counted, or null.
 *
 * ── WHY THIS IS NOT `Math.max(a, b, c)` ──
 *
 * Every source reports an UNCOUNTED account as a zero. Zernio sends
 * `followersCount: null` until its first daily snapshot; follower-stats
 * returns `currentFollowers: 0` beside `dataPoints: 0` and an empty series,
 * which is a default computed over no observations; the history series is
 * simply empty. Folding those with `|| 0` and taking the max produced a
 * confident `0` in the KPI tile — which reads as an account with no audience,
 * rather than one nobody has counted yet.
 *
 * `dataPoints` is the discriminator, and it is why the number alone cannot
 * decide: an account genuinely sitting at zero followers HAS snapshots behind
 * it and must still read as 0, not as unknown.
 *
 * Three sources rather than one because they fill on the same daily clock but
 * not in the same instant, so whichever has a real figure first is the answer.
 *
 * @param {Array} accounts Zernio account objects (`followersCount`)
 * @param {Array} stats    follower-stats rows (`currentFollowers`, `dataPoints`)
 * @param {Array} history  [{ followers }] series, oldest first
 * @returns {number|null} the count, or null when nobody has counted
 */
export function foldFollowers(accounts = [], stats = [], history = []) {
  const counted = []

  for (const a of accounts || []) {
    if (typeof a?.followersCount === 'number') counted.push(a.followersCount)
  }
  for (const s of stats || []) {
    if ((Number(s?.dataPoints) || 0) > 0 && typeof s?.currentFollowers === 'number') {
      counted.push(s.currentFollowers)
    }
  }
  const rows = history || []
  const last = rows[rows.length - 1]
  if (typeof last?.followers === 'number') counted.push(last.followers)

  return counted.length ? Math.max(...counted) : null
}

export function timeAgo(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
