// Number and time formatting shared by the Analytics graphs and the pages
// that frame them. Kept out of Dashboard.jsx so that file exports only
// components, which is what fast refresh needs.

export const fmt = n => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(Math.round(n) || 0)

/**
 * A percentage, rendered the one way this app renders percentages.
 *
 * ── WHY THIS EXISTS ──
 *
 * The same engagement rate was printed by four call sites at two precisions:
 * `toFixed(1)` in the KPI tile and `toFixed(0)` in the chart legend 200px
 * below it, so one variable read "18.8%" in one place and "19%" in the other.
 * The tables rounded to whole numbers too, which turns 6.5% into "7%" sitting
 * a screen away from a tile saying "6.5%".
 *
 * None of those was a wrong calculation, and that is exactly what made it
 * expensive to find: there was nothing wrong in the arithmetic, and the page
 * still looked like it could not add up. One decimal everywhere, from one
 * function, is the whole fix — below 10% the decimal is most of the
 * information, and past 100% it has stopped earning its place.
 *
 * @param {number|null|undefined} value A percentage already scaled to 0..100.
 * @param {string} [dash] What to render when there is no number to render.
 * @returns {string}
 */
export function pct(value, dash = '—') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return dash
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}%`
}

/**
 * "Last 29 days" for the window a strip ACTUALLY covers.
 *
 * ── WHY THIS IS NOT JUST `Last ${days} days` ──
 *
 * The two strips on an account page do not cover the same window, and until
 * this existed nothing on screen admitted it. Meta refuses more than 30 days
 * between `since` and `until` on account insights, so the platform strip is
 * capped at 29 whatever the picker says; the post strip below it honours the
 * full 90. Pick "Last 90 days" and you get a 29-day figure stacked on a 90-day
 * figure, in identical type, with identical captions — and every comparison a
 * reader makes between them is wrong by two months.
 *
 * So each strip states the span it was actually given, derived from the dates
 * the server used rather than from the number in the picker. When they agree
 * the two captions are identical and nobody notices; when they differ the
 * difference is the first thing in the reader's eye.
 *
 * @param {string} from ISO day, e.g. `2026-08-21`.
 * @param {string} to   ISO day.
 * @param {number} [fallbackDays] Used when either date is missing.
 * @returns {string}
 */
export function windowLabel(from, to, fallbackDays) {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  const days = Number.isFinite(a) && Number.isFinite(b)
    ? Math.round((b - a) / 86_400_000)
    : fallbackDays
  return days ? `Last ${days} days` : ''
}

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
