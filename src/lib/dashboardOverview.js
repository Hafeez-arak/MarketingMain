import { foldFollowers } from '../pages/analytics/format'

// ─── Several accounts' analytics, read as one picture ──────────────────────
//
// /analytics answers "what happened on this account". The dashboard answers a
// different question — "how are we doing" — and no single account can answer
// it, because the business is on Instagram, LinkedIn and TikTok at once.
//
// /api/zernio/analytics is per-account by design (it checks the account
// belongs to the workspace before it reads anything), so the combining has to
// happen here, over one response per account. This module is PURE: it takes
// responses and returns numbers. Everything that fetches lives in the hook.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ──
//
// A number that nobody has measured must never come out of here as 0.
//
// Every source in this stack reports an uncounted account as a zero — Zernio
// sends `followersCount: null` until its first daily snapshot, follower-stats
// returns `currentFollowers: 0` beside `dataPoints: 0`, Instagram's insights
// simply omit a metric the account cannot report. Summing those with `|| 0`
// produces a confident total that reads as "we have no audience" rather than
// "nobody has counted yet", and on a dashboard that is the difference between
// a quiet week and a broken integration. So every aggregate here carries
// `null` when nothing underneath it was measured, and the tiles print "—".

const METRIC_KEYS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'views']
const ZERO_METRICS = Object.fromEntries(METRIC_KEYS.map(k => [k, 0]))

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Interactions ÷ people reached, falling back to impressions where a platform
 * does not report reach.
 *
 * The same definition /analytics uses. Stated once here and imported by the
 * dashboard rather than written out again, because two engagement rates on two
 * screens that disagree by a few tenths is a bug report nobody can close.
 */
export function engagementRate(m) {
  if (!m) return null
  const denom = num(m.reach) || num(m.impressions)
  if (!denom) return null
  return ((num(m.likes) + num(m.comments) + num(m.shares) + num(m.saves)) / denom) * 100
}

export const interactionsOf = m =>
  num(m?.likes) + num(m?.comments) + num(m?.shares) + num(m?.saves)

/** A metric total from Instagram's account insights or LinkedIn's page totals. */
const totalOf = (metrics, key) => {
  const t = metrics?.[key]?.total
  return typeof t === 'number' ? t : null
}

/**
 * One account's response, reduced to the shape the dashboard reads.
 *
 * `dash` is whatever /api/zernio/analytics returned — including an error,
 * which is kept rather than discarded: an account that failed has to be named
 * on screen, because silently dropping it turns "LinkedIn is down" into
 * "LinkedIn did nothing this month".
 */
export function accountSummary(account, dash) {
  const platform = account?.platform || dash?.platform || ''
  const accountId = account?.zernio_account_id || ''
  const base = {
    accountId,
    platform,
    username: account?.username || account?.display_name || '',
    error: '',
    supports: null,
    posts: 0,
    metrics: { ...ZERO_METRICS },
    interactions: 0,
    engagementRate: null,
    followers: null,
    followerSeries: [],
    accountViews: null,
    accountReach: null,
    profileTaps: null,
    daily: [],
    topPosts: [],
  }

  if (!dash || dash.error) {
    return { ...base, error: dash?.error || 'No response.' }
  }

  const posts = dash.overview?.posts || []
  const metrics = { ...ZERO_METRICS }
  for (const p of posts) {
    const a = p.analytics || {}
    for (const k of METRIC_KEYS) metrics[k] += num(a[k])
  }

  // Followers, from whichever of the three sources has actually counted. See
  // foldFollowers — `dataPoints` is the discriminator, not the number, because
  // an account genuinely sitting at zero followers still has snapshots behind
  // it and must read as 0 rather than as unknown.
  const scoped = a => !accountId || a._id === accountId
  const statsRows = accountId
    ? (dash.followers?.stats?.[accountId] || [])
    : Object.values(dash.followers?.stats || {}).flat()
  const historyRows = (dash.followerHistory?.metrics?.follower_count?.values || [])
    .map(v => ({ date: v.date, followers: v.value }))
  const followerSeries = statsRows.length ? statsRows : historyRows

  const followers = foldFollowers(
    (dash.overview?.accounts || []).filter(scoped),
    (dash.followers?.accounts || []).filter(scoped),
    followerSeries,
  )

  // ── Views that are not post views ──
  //
  // The distinction the dashboard exists to make. Instagram's account insights
  // count every surface — feed, stories, explore AND the profile itself — so
  // they are not the sum of the post numbers above and must not be added to
  // them. LinkedIn's equivalent is the company page's own view count.
  const ig = dash.insights?._error ? null : dash.insights?.metrics
  const li = dash.linkedinPage?._error ? null : dash.linkedinPage?.metrics

  const accountViews = platform === 'linkedin'
    ? totalOf(li, 'page_views_total')
    : totalOf(ig, 'views')
  const accountReach = platform === 'linkedin'
    ? totalOf(li, 'unique_impressions')
    : totalOf(ig, 'reach')

  return {
    ...base,
    // Which metrics this platform can fill at all, as the server reported
    // them. LinkedIn takes no view count on an ordinary post and Instagram
    // has not reported impressions since Graph v22 — summing an unreported
    // metric gives a confident 0 for a measurement nobody took.
    supports: Array.isArray(dash.metricsSupported) && dash.metricsSupported.length
      ? dash.metricsSupported
      : null,
    posts: posts.length,
    metrics,
    interactions: interactionsOf(metrics),
    engagementRate: engagementRate(metrics),
    followers,
    followerSeries,
    accountViews,
    accountReach,
    profileTaps: totalOf(ig, 'profile_links_taps'),
    daily: dash.daily?.dailyData || [],
    topPosts: posts
      .map(p => ({
        ...p,
        platform: p.platform || platform,
        _er: p.analytics?.engagementRate ?? engagementRate(p.analytics) ?? null,
        _interactions: interactionsOf(p.analytics),
      }))
      .sort((a, b) => b._interactions - a._interactions)
      .slice(0, 5),
  }
}

/** Sum that stays null until at least one source has actually counted. */
function sumCounted(values) {
  const counted = values.filter(v => typeof v === 'number')
  return counted.length ? counted.reduce((a, b) => a + b, 0) : null
}

/**
 * Can this account's platform fill this metric at all?
 *
 * A server that did not say assumes yes, which is the old behaviour and the
 * right default: a metric wrongly shown is a smaller error than one wrongly
 * hidden, and `metricsSupported` is only absent on platforms nobody has
 * catalogued yet.
 */
export const supportsMetric = (summary, key) =>
  !Array.isArray(summary?.supports) || summary.supports.includes(key)

/**
 * A post metric summed only across the platforms that actually report it.
 *
 * Returns null — an em dash on screen — when none of them do. LinkedIn takes
 * no view count on an ordinary post, so "Post views: 0" for a LinkedIn-only
 * selection is not a quiet month; it is a number LinkedIn never took. The
 * platforms that DID contribute travel back with it so the tile can say whose
 * number it is showing.
 */
export function metricAcross(summaries = [], key) {
  const sources = summaries.filter(s => !s.error && supportsMetric(s, key))
  if (!sources.length) return { value: null, platforms: [] }
  return {
    value: sources.reduce((n, s) => n + num(s.metrics?.[key]), 0),
    platforms: [...new Set(sources.map(s => s.platform))],
  }
}

/**
 * The whole workspace, from one summary per account.
 *
 * `byPlatform` folds several accounts on one platform together — two Instagram
 * accounts are one Instagram row, because "how is Instagram doing" is the
 * question the dashboard is being asked.
 */
export function combineOverview(summaries = []) {
  const ok = summaries.filter(s => !s.error)
  const metrics = { ...ZERO_METRICS }
  for (const s of ok) for (const k of METRIC_KEYS) metrics[k] += num(s.metrics[k])

  const byPlatformMap = new Map()
  for (const s of ok) {
    const row = byPlatformMap.get(s.platform) || {
      platform: s.platform, posts: 0, metrics: { ...ZERO_METRICS },
      followers: [], accountViews: [], accountReach: [], accounts: 0,
    }
    row.accounts += 1
    row.posts += s.posts
    for (const k of METRIC_KEYS) row.metrics[k] += num(s.metrics[k])
    row.followers.push(s.followers)
    row.accountViews.push(s.accountViews)
    row.accountReach.push(s.accountReach)
    byPlatformMap.set(s.platform, row)
  }

  const byPlatform = [...byPlatformMap.values()].map(r => ({
    platform: r.platform,
    accounts: r.accounts,
    posts: r.posts,
    metrics: r.metrics,
    followers: sumCounted(r.followers),
    accountViews: sumCounted(r.accountViews),
    accountReach: sumCounted(r.accountReach),
    interactions: interactionsOf(r.metrics),
    engagementRate: engagementRate(r.metrics),
  }))

  // ── Most active ──
  //
  // Ranked by interactions rather than by posts, because "most active" is a
  // question about where the audience is, not about where we happen to be
  // typing. A platform with three posts and 900 interactions is the one worth
  // knowing about. Posts and rate travel with it so the other reading of the
  // word is one glance away rather than unavailable.
  //
  // Ties broken by posts, then alphabetically, so the card does not reshuffle
  // itself between two identical loads.
  const mostActive = [...byPlatform]
    .filter(p => p.posts > 0 || p.interactions > 0)
    .sort((a, b) =>
      b.interactions - a.interactions ||
      b.posts - a.posts ||
      a.platform.localeCompare(b.platform))[0] || null

  return {
    accounts: summaries.length,
    posts: ok.reduce((n, s) => n + s.posts, 0),
    metrics,
    interactions: interactionsOf(metrics),
    engagementRate: engagementRate(metrics),
    followers: sumCounted(ok.map(s => s.followers)),
    // Post views and account-wide views are kept apart on purpose — see the
    // note in accountSummary. Adding them would double-count every view of a
    // post that Instagram also counted at the account level.
    //
    // Summed only over the platforms that report views at all, so a
    // LinkedIn-only selection reads "—" rather than a confident zero.
    postViews: metricAcross(ok, 'views').value,
    postViewPlatforms: metricAcross(ok, 'views').platforms,
    accountViews: sumCounted(ok.map(s => s.accountViews)),
    reach: sumCounted(ok.map(s => s.accountReach)) ?? (metrics.reach || null),
    postReach: metrics.reach,
    byPlatform: byPlatform.sort((a, b) => b.interactions - a.interactions || a.platform.localeCompare(b.platform)),
    mostActive,
    topPosts: ok.flatMap(s => s.topPosts).sort((a, b) => b._interactions - a._interactions).slice(0, 5),
    errors: summaries.filter(s => s.error).map(s => ({ platform: s.platform, username: s.username, error: s.error })),
  }
}

// ─── The trend line ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const iso = d => d.toISOString().slice(0, 10)

/** Monday-start week bucket (the YYYY-MM-DD of that week's Monday). */
export function weekOf(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return iso(d)
}

/**
 * Every bucket between two dates, whether or not anything happened in it.
 *
 * Zero-filling is not cosmetic. A chart that plots only the days with data
 * cannot draw the shape of a slow start — it draws a flat line through three
 * points and calls it a trend. The empty buckets are the measurement.
 */
export function bucketsInRange(fromDate, toDate, mode = 'day') {
  if (!fromDate || !toDate) return []
  const out = []
  const end = mode === 'week' ? weekOf(toDate) : String(toDate).slice(0, 10)
  let cur = mode === 'week' ? weekOf(fromDate) : String(fromDate).slice(0, 10)
  let guard = 0
  while (cur && cur <= end && guard++ < 400) {
    out.push(cur)
    const d = new Date(`${cur}T00:00:00Z`)
    cur = iso(new Date(d.getTime() + (mode === 'week' ? 7 : 1) * DAY_MS))
  }
  return out
}

/**
 * Daily rows past this many days are bucketed weekly instead.
 *
 * 90 daily points on a card-sized chart is a hairball; the same range in weeks
 * is thirteen points and readable. 45 rather than 31 so that a 30-day range —
 * the default — always stays daily even when the window overshoots by a day.
 */
export const WEEKLY_ABOVE_DAYS = 45

export function bucketModeFor(fromDate, toDate) {
  if (!fromDate || !toDate) return 'day'
  const span = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS
  return span > WEEKLY_ABOVE_DAYS ? 'week' : 'day'
}

/**
 * One row per bucket, carrying the combined total and a column per platform.
 *
 * This is the shape the user asked for in as many words: pick several
 * platforms, see the total, and still be able to tell which platform is doing
 * what. A stacked total alone answers the first half and destroys the second.
 *
 * `interactions` is a metric here even though no platform reports it, because
 * it is the one number that means the same thing everywhere — likes, comments,
 * shares and saves added up. Views and reach are native but not comparable
 * across platforms; interactions are.
 */
export function platformSeries(summaries = [], {
  metric = 'views', fromDate, toDate, mode,
} = {}) {
  const ok = summaries.filter(s => !s.error)
  const bucket = mode || bucketModeFor(fromDate, toDate)
  const keys = bucketsInRange(fromDate, toDate, bucket)
  const platforms = [...new Set(ok.map(s => s.platform))]

  const rows = new Map(keys.map(k => [k, {
    bucket: k,
    total: 0,
    ...Object.fromEntries(platforms.map(p => [p, 0])),
  }]))

  for (const s of ok) {
    for (const r of s.daily) {
      const key = bucket === 'week' ? weekOf(r.date) : String(r.date || '').slice(0, 10)
      if (!key) continue
      // A row outside the scaffold still counts. Zernio's window and ours are
      // computed from different clocks, and dropping the edges would quietly
      // shrink every total by a day.
      if (!rows.has(key)) {
        rows.set(key, { bucket: key, total: 0, ...Object.fromEntries(platforms.map(p => [p, 0])) })
      }
      const value = metric === 'interactions'
        ? interactionsOf(r.metrics)
        : num(r.metrics?.[metric])
      const row = rows.get(key)
      row[s.platform] = num(row[s.platform]) + value
      row.total += value
    }
  }

  return {
    mode: bucket,
    platforms,
    rows: [...rows.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  }
}

/**
 * Follower movement across the window, or null when nobody has counted twice.
 *
 * Zernio fills these on a daily snapshot, so an account connected today has
 * one point or none — and one point is not a change. Saying "+0" there would
 * be a measurement we did not make.
 */
export function followerChange(summaries = []) {
  let first = 0
  let last = 0
  let counted = 0
  for (const s of summaries) {
    const rows = s.followerSeries || []
    if (rows.length < 2) continue
    const a = rows[0]?.followers
    const b = rows[rows.length - 1]?.followers
    if (typeof a !== 'number' || typeof b !== 'number') continue
    first += a
    last += b
    counted += 1
  }
  return counted ? { from: first, to: last, delta: last - first } : null
}
