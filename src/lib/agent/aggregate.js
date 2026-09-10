// ─── The arithmetic, done in code ──────────────────────────────────────────
// AGENT.md §7 makes this the first and most valuable of the four decisions
// that actually drive the bill: six competitors × 25 posts through a model
// every week, to compute averages, would cost more than everything else
// combined AND be less accurate. So every number the agent quotes is computed
// here and handed to it as a given fact.
//
// The accuracy half matters more than the cost half. A model doing arithmetic
// over 150 posts is wrong occasionally, and wrong in the specific way that
// reads as confident — RESEARCH-AGENT.md's warning that a report built on
// numbers that are quietly wrong is worse than no report, because it is
// convincing.
//
// Pure functions over rows. No network, no model, no clock except what is
// passed in.

import { computeMovements, buildBoard, priorByName } from './gather.js'

/**
 * A number, or null if there genuinely is not one.
 *
 * Number(null) is 0 and Number('') is 0, and Number.isFinite says yes to both.
 * So the obvious `Number.isFinite(Number(v))` test quietly turns "we have no
 * measurement" into "we measured zero" — the precise failure this whole module
 * exists to avoid, and the one that bit hardest in deltaFor: a rival with no
 * resolvable Instagram account has null engagement, and treating that as 0
 * reports their engagement as having COLLAPSED rather than as unknown.
 *
 * Nulls have to survive all the way to the model, because "unknown" is a thing
 * the agent is required to be able to say.
 */
function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Round to `places`, returning null for anything that is not a real number. */
function round(value, places = 2) {
  const n = num(value)
  if (n === null) return null
  const f = 10 ** places
  return Math.round(n * f) / f
}

// ─── Our own performance ───────────────────────────────────────────────────

/**
 * Fold post analytics into one engagement number per post.
 *
 * Interactions, not impressions: reach depends on how far the platform chose
 * to push a post, engagement depends on whether people cared. Only the second
 * is a signal about the content, which is the only thing we can change.
 *
 * A post with no analytics row at all returns null rather than 0 — "we have no
 * data" and "nobody engaged" are different facts, and collapsing them would
 * silently drag every average toward zero as unsynced posts accumulated.
 */
export function engagementOf(analyticsRows) {
  const rows = analyticsRows || []
  if (!rows.length) return null
  // Newest metric_date wins: analytics are re-synced daily and each row is a
  // snapshot of cumulative totals, not a daily delta. Summing them would count
  // the same like once per sync.
  const latest = [...rows].sort((a, b) =>
    String(b?.metric_date || '').localeCompare(String(a?.metric_date || '')))[0]
  const parts = ['likes', 'comments', 'shares', 'saves']
  let total = 0
  let present = 0
  for (const key of parts) {
    const n = num(latest?.[key])
    if (n !== null) { total += n; present += 1 }
  }
  // An analytics row can exist with every metric still null — the sync
  // inserted the row before the platform returned figures. That is not a post
  // that scored zero, and `metrics_present` on post_analytics exists because
  // this distinction is real. Returning null sends it to `measured: 0`, where
  // it correctly fails to drag an average down.
  if (!present) return null
  return {
    engagement: total,
    likes: num(latest?.likes) ?? 0,
    comments: num(latest?.comments) ?? 0,
    shares: num(latest?.shares) ?? 0,
    saves: num(latest?.saves) ?? 0,
    reach: num(latest?.reach),
    views: num(latest?.views),
    metric_date: latest?.metric_date || null,
  }
}

/**
 * Group posts by some key and report engagement per group, WITH sample sizes.
 *
 * `n` is returned on every row and is not decoration. The identity prompt
 * tells the agent to say when a sample is too small to carry a conclusion, and
 * it can only do that if the number is in front of it. Today @lightingaaa is
 * a test account with one follower, so most of these groups are n=0 or n=1 —
 * the honest output is "we cannot tell yet", and that requires shipping the
 * emptiness rather than hiding it behind an average of one.
 *
 * @param {Array} posts     generated_posts rows
 * @param {object} byPostId post_analytics rows keyed by post id
 * @param {(post:object)=>string} keyOf  what to group by
 */
export function performanceBy(posts, byPostId, keyOf) {
  const groups = new Map()
  for (const post of posts || []) {
    const key = String(keyOf(post) || '').trim() || '(unset)'
    if (!groups.has(key)) groups.set(key, { key, posts: 0, measured: 0, engagement: 0 })
    const g = groups.get(key)
    g.posts += 1
    const stats = engagementOf(byPostId?.[post.id])
    if (stats) { g.measured += 1; g.engagement += stats.engagement }
  }
  return [...groups.values()]
    .map(g => ({
      key: g.key,
      posts: g.posts,
      // How many of those posts we actually have numbers for. `posts` without
      // `measured` is the difference between "we published 12" and "we know
      // how 3 of them did", and reporting only the first invites a conclusion
      // the data cannot support.
      measured: g.measured,
      total_engagement: g.engagement,
      avg_engagement: g.measured ? round(g.engagement / g.measured) : null,
    }))
    .sort((a, b) => (b.avg_engagement ?? -1) - (a.avg_engagement ?? -1) || b.posts - a.posts)
}

/**
 * The whole picture of how we have been doing: by format, by pillar, by
 * weekday, plus the totals the caller needs to judge whether any of it means
 * anything yet.
 */
export function ourPerformance(posts, analytics, { now = new Date() } = {}) {
  const rows = posts || []
  const byPostId = {}
  for (const a of analytics || []) {
    const pid = a?.post_id
    if (pid) (byPostId[pid] ||= []).push(a)
  }

  const measured = rows.filter(p => engagementOf(byPostId[p.id]))
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return {
    // Stated first and plainly, because it is the caveat every other number
    // here depends on.
    posts_total: rows.length,
    posts_measured: measured.length,
    // Named so the agent cannot mistake an empty result for a bad result.
    note: rows.length === 0
      ? 'This workspace has no published posts yet, so there is no performance history to read.'
      : (measured.length === 0
        ? 'Posts exist but none has analytics synced yet, so no engagement conclusion is available.'
        : ''),
    by_format: performanceBy(rows, byPostId, p => p.format || p.media_type),
    by_pillar: performanceBy(rows, byPostId, p => p.post_kind || p.topic),
    by_weekday: performanceBy(rows, byPostId, p => {
      const d = p.published_at || p.scheduled_date
      if (!d) return ''
      const parsed = new Date(d)
      return Number.isNaN(parsed.getTime()) ? '' : weekdays[parsed.getUTCDay()]
    }),
    generated_at: now instanceof Date ? now.toISOString() : String(now),
  }
}

// ─── Competitors ───────────────────────────────────────────────────────────

/**
 * Engagement per 1,000 followers.
 *
 * The only number comparable across accounts of different sizes, and therefore
 * — per the competitor_snapshots migration — the only one a report should ever
 * rank on. Ranking on raw likes just re-discovers who is biggest, which is a
 * fact we already had for free.
 */
export function engagementPer1k(avgEngagement, followers) {
  const e = num(avgEngagement)
  const f = num(followers)
  if (e === null || f === null || f <= 0) return null
  return round((e / f) * 1000)
}

/**
 * Split a flat snapshot list into the latest row per competitor and everything
 * older, which is the shape both the board and the movements need.
 */
export function splitSeries(snapshots) {
  const byName = new Map()
  for (const snap of snapshots || []) {
    const key = String(snap?.competitor_name || '').toLowerCase()
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(snap)
  }

  const current = []
  const older = []
  for (const rows of byName.values()) {
    const series = [...rows].sort((a, b) =>
      String(b?.captured_at || '').localeCompare(String(a?.captured_at || '')))
    current.push(series[0])
    older.push(...series.slice(1))
  }
  return { current, older }
}

/**
 * The competitor board for the chat tool, built from stored snapshots.
 *
 * Delegates to gather.js rather than computing its own movements. There was
 * briefly a second implementation here with its own idea of what counts as a
 * change, which meant the weekly brief and the answer to "what are competitors
 * doing?" could disagree about the same two rows in the same database. One
 * implementation, and it is the one that carries the 15% significance floor —
 * without a floor a rounding wobble gets reported as news.
 *
 * `quiet_week` is a first-class result, not an error. Every tool in this
 * category is built to manufacture four exciting insights per run; this one is
 * required to say when nothing happened, because the weeks where something did
 * happen only mean anything if the quiet ones were reported honestly.
 */
export function competitorBoard(snapshots) {
  const { current, older } = splitSeries(snapshots)
  const prior = priorByName(older)
  const { movements, comparable } = computeMovements(current, prior)
  const board = buildBoard(current, prior)

  return {
    competitors: board,
    movements,
    with_instagram: current.filter(r => r?.data_source === 'instagram').length,
    // Distinct states. "Nothing to compare against yet" is not "we compared
    // and nothing changed", and reporting the first as the second would make
    // week one read as a dull week rather than the start of the series.
    baseline: current.length > 0 && comparable === 0,
    quiet_week: current.length > 0 && comparable > 0 && movements.length === 0,
    note: current.length === 0
      ? 'No competitor snapshots exist for this workspace yet — the handles have not been resolved or no run has gathered them.'
      : '',
  }
}
