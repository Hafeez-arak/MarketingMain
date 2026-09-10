// ─── Stage 0 — the measured half of a research run ─────────────────────────
// Ported from the `Arak Lighting – Research Run` Gather node. AGENT.md §8
// step 2 says the logic and the tests carry over and the plumbing does not, so
// everything that was pure in n8n is pure here: this module never touches the
// network, and api/agent/_gather.js does the fetching.
//
// Two guarantees this stage exists to provide (AGENT.md §6):
//
//   • The numbers survive anything. This runs and commits BEFORE a single
//     model token is spent, so no key, an unreachable model, or unparseable
//     output still leaves a readable competitor board behind.
//   • Every number is computed here, never by a model. Asking a model to
//     subtract last week's post count from this week's is asking it to be
//     occasionally wrong about the number the reader trusts most.

const round = (n, p = 2) =>
  (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)))
    ? null
    : Math.round(Number(n) * 10 ** p) / 10 ** p

/** How much of a rival's output is moving pictures. VIDEO and REELS are the same story. */
export function videoShare(mix) {
  const v = Number((mix || {}).VIDEO || 0) + Number((mix || {}).REELS || 0)
  return Number.isFinite(v) ? round(v, 3) : null
}

/**
 * The fields business_discovery is asked for, as one string.
 *
 * Pure so the request shape is testable without a Meta token — the media limit
 * in particular is load-bearing, because `truncated` below is computed from it
 * and a change here silently changes what that flag means.
 */
export const MEDIA_LIMIT = 50

export function discoveryFields(handle) {
  return `business_discovery.username(${handle})` +
    `{id,username,name,biography,website,followers_count,follows_count,media_count,` +
    `media.limit(${MEDIA_LIMIT}){id,caption,media_type,permalink,timestamp,like_count,comments_count}}`
}

/**
 * Everything we compute about one account for one period.
 *
 * @param {Array}  media      business_discovery media.data
 * @param {number} followers  their follower count
 * @param {object} period     { start: Date, end: Date, days: number }
 */
export function metricsFor(media, followers, period) {
  const start = period?.start instanceof Date ? period.start : new Date(period?.start)
  const end = period?.end instanceof Date ? period.end : new Date(period?.end)
  const days = Number(period?.days) || 7
  const all = media || []

  const inPeriod = all.filter(m => {
    const t = new Date(m?.timestamp)
    return !Number.isNaN(t.getTime()) && t >= start && t <= end
  })

  const formatCounts = {}
  for (const m of inPeriod) {
    const k = m?.media_type || 'UNKNOWN'
    formatCounts[k] = (formatCounts[k] || 0) + 1
  }
  const formatMix = {}
  for (const [k, v] of Object.entries(formatCounts)) formatMix[k] = round(v / inPeriod.length, 3)

  // Instagram lets an account hide its like counts, and business_discovery
  // then omits like_count entirely. A missing count is NOT a zero: averaging
  // it in would quietly punish exactly the accounts that hid it. So cadence
  // counts every post while the engagement averages count only the posts that
  // actually reported — which is why the schema keeps posts_in_period and
  // sample_size as separate columns.
  const measurable = inPeriod.filter(m => m?.like_count != null || m?.comments_count != null)
  const engagementOf = m => (Number(m?.like_count) || 0) + (Number(m?.comments_count) || 0)
  const totalEngagement = measurable.reduce((a, m) => a + engagementOf(m), 0)
  const avgEngagement = measurable.length ? totalEngagement / measurable.length : null

  const postHours = {}
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  for (const m of inPeriod) {
    const t = new Date(m?.timestamp)
    if (Number.isNaN(t.getTime())) continue
    postHours[`${DAY[t.getUTCDay()]}-${String(t.getUTCHours()).padStart(2, '0')}`] =
      (postHours[`${DAY[t.getUTCDay()]}-${String(t.getUTCHours()).padStart(2, '0')}`] || 0) + 1
  }

  const topPosts = [...measurable]
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, 3)
    .map(m => ({
      permalink: m?.permalink || '',
      likes: m?.like_count ?? null,
      comments: m?.comments_count ?? null,
      media_type: m?.media_type || '',
      timestamp: m?.timestamp || '',
      hook: String(m?.caption || '').split('\n')[0].slice(0, 160),
    }))

  return {
    posts_in_period: inPeriod.length,
    posts_per_week: days > 0 ? round((inPeriod.length * 7) / days) : null,
    format_mix: formatMix,
    avg_engagement: round(avgEngagement),
    // The only number comparable across accounts of different sizes, and so
    // the only one the report is allowed to rank on. Null rather than zero
    // when we do not know the follower count — a ratio over an unknown
    // denominator is not a small number, it is not a number.
    engagement_per_1k: (avgEngagement !== null && Number(followers) > 0)
      ? round((avgEngagement / Number(followers)) * 1000)
      : null,
    top_posts: topPosts,
    post_hours: postHours,
    sample_size: measurable.length,
    likes_hidden: inPeriod.length - measurable.length,
    // media.limit caps what we can see. If every post we got back falls inside
    // the period, there may be more we never saw and the cadence is a floor,
    // not a count.
    truncated: all.length >= MEDIA_LIMIT && inPeriod.length === all.length,
  }
}

/** The things that make a number less trustworthy than it looks, in words. */
export function caveatsFor(name, m) {
  const out = []
  if (m?.truncated) {
    out.push(`${name}: every one of the ${MEDIA_LIMIT} posts Instagram returned falls inside this ` +
      `period, so their cadence is a floor rather than a count — there may be posts we cannot see.`)
  }
  if (m?.likes_hidden) {
    out.push(`${name}: ${m.likes_hidden} of ${m.posts_in_period} posts hide their like count, ` +
      `so the engagement average rests on ${m.sample_size} post${m.sample_size === 1 ? '' : 's'}.`)
  }
  return out
}

// ─── Movements ─────────────────────────────────────────────────────────────

// Below this relative change, a difference is noise. Without a floor a
// rounding wobble gets reported as news, and a report that cries wolf weekly
// is one people stop opening.
export const MOVEMENT_FLOOR = 0.15

/**
 * One movement, or nothing.
 *
 * Both sides must be real numbers. A rival we could not read this week has
 * null, and comparing null against last week's figure would announce a
 * collapse that never happened — the most damaging thing this report can do,
 * because it reads as a finding rather than as an error.
 */
export function movement(name, metric, from, to, unit) {
  const a = round(from)
  const b = round(to)
  if (a === null || b === null) return null
  if (a === 0 && b === 0) return null
  const abs = Math.abs(b - a)
  const rel = a !== 0 ? abs / Math.abs(a) : 1
  if (rel < MOVEMENT_FLOOR) return null
  return {
    what: `${name}: ${metric}`,
    metric,
    competitor: name,
    from: a,
    to: b,
    unit,
    change_pct: round(rel * 100, 1),
    direction: b > a ? 'up' : 'down',
    significance: rel >= 0.5 ? 'high' : rel >= 0.25 ? 'medium' : 'low',
    // Instagram findings prove; web findings explain. Every movement here is
    // measured, so it is always the first kind.
    evidence_source: 'instagram',
  }
}

/** The latest prior snapshot per competitor, keyed by lowercased name. */
export function priorByName(rows) {
  const map = new Map()
  // Sorted newest-first so the first row seen for a name is the latest one.
  const sorted = [...(rows || [])].sort((a, b) =>
    String(b?.captured_at || '').localeCompare(String(a?.captured_at || '')))
  for (const p of sorted) {
    const k = String(p?.competitor_name || '').toLowerCase()
    if (k && !map.has(k)) map.set(k, p)
  }
  return map
}

/** Every movement across every measured rival, biggest first. */
export function computeMovements(snapshots, prior) {
  const prev = prior instanceof Map ? prior : priorByName(prior)
  const movements = []
  let comparable = 0

  for (const s of snapshots || []) {
    if (s?.data_source !== 'instagram') continue
    const p = prev.get(String(s.competitor_name || '').toLowerCase())
    if (!p) continue
    comparable += 1
    const add = m => { if (m) movements.push(m) }
    add(movement(s.competitor_name, 'followers', p.followers, s.followers, 'followers'))
    add(movement(s.competitor_name, 'posts per week', p.posts_per_week, s.posts_per_week, 'posts/week'))
    add(movement(s.competitor_name, 'engagement per 1k followers',
      p.engagement_per_1k, s.engagement_per_1k, 'per 1k'))
    add(movement(s.competitor_name, 'share of posts that are video',
      videoShare(p.format_mix), videoShare(s.format_mix), 'share'))
  }

  movements.sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0))
  return { movements, comparable }
}

// ─── The board ─────────────────────────────────────────────────────────────

// Two floors, not one, and both were paid for.
//
// The follower floor keeps a one-follower test account from producing a
// -99.9% that reads as a finding. The engagement floor is a separate hazard:
// our own account can clear 50 followers while still getting zero likes, and
// dividing by that zero yields Infinity, which rounds to null and renders as
// "+null%" on every card. Observed as a near-miss live on 2026-08-20 —
// @lightingaaa really does have posts at 0 engagement, and only the follower
// floor caught it that day.
export const MIN_SELF_BASELINE = 50

export function selfIsComparable(self) {
  return Boolean(self) &&
    Number(self.followers) >= MIN_SELF_BASELINE &&
    Number(self.engagement_per_1k) > 0
}

/** The competitor board: one card per rival, ours excluded, compared to us where honest. */
export function buildBoard(snapshots, prior) {
  const prev = prior instanceof Map ? prior : priorByName(prior)
  const self = (snapshots || []).find(s => s?.is_self && s?.data_source === 'instagram')
  const comparable = selfIsComparable(self)

  return (snapshots || []).filter(s => !s?.is_self).map(s => {
    const p = prev.get(String(s.competitor_name || '').toLowerCase())
    return {
      name: s.competitor_name,
      handle: s.ig_handle,
      // The report must say this on every card: 'web_only' means the hard
      // numbers are absent, not zero.
      data: s.data_source,
      followers: s.followers ?? null,
      followers_delta: p && s.followers != null ? s.followers - Number(p.followers) : null,
      posts_per_week: s.posts_per_week ?? null,
      posts_per_week_prev: p ? round(p.posts_per_week) : null,
      format_mix: s.format_mix || {},
      engagement_per_1k: s.engagement_per_1k ?? null,
      vs_us: (comparable && s.engagement_per_1k != null)
        ? `${s.engagement_per_1k >= self.engagement_per_1k ? '+' : ''}` +
          `${round(((s.engagement_per_1k - self.engagement_per_1k) / self.engagement_per_1k) * 100, 1)}%`
        : null,
      vs_us_note: comparable ? null : 'No comparable account of ours is connected yet.',
      sample_size: s.sample_size ?? null,
      top_posts: s.top_posts || [],
    }
  })
}

/**
 * The stage-0 report — the thing that survives everything after it.
 *
 * `stage_reached: 'gather'` is how a reader tells a full brief from the
 * measured half left behind by a run that died during investigation.
 */
export function gatherReport({ snapshots, prior, period, failures = [], caveats = [] }) {
  const { movements, comparable } = computeMovements(snapshots, prior)
  const board = buildBoard(snapshots, prior)
  const baseline = comparable === 0

  return {
    headline: baseline
      ? `First measurement of ${board.length} competitor${board.length === 1 ? '' : 's'} — nothing to compare against yet.`
      : movements.length
        ? `${movements.length} measurable change${movements.length === 1 ? '' : 's'} across ${comparable} competitor${comparable === 1 ? '' : 's'}.`
        : 'Nothing moved measurably this week.',
    baseline,
    // A quiet week is a first-class, reportable result — distinct from a
    // baseline, which is "nothing to compare against yet" rather than "we
    // compared and nothing changed".
    quiet_week: !baseline && movements.length === 0,
    period,
    movements,
    competitor_board: board,
    market: [], gaps: [], proposed_rules: [], proposed_ideas: [], agenda_changes: [],
    // Failures and caveats reach the report rather than being dropped. A
    // cadence that is really a floor, read next week as a fall, is a movement
    // the report would state with total confidence and be wrong about.
    unanswered: [
      ...failures.map(f => `Could not read ${f.name} (@${f.handle}): ${f.error}`),
      ...caveats,
    ],
    sources: [],
    stage_reached: 'gather',
  }
}

/** The report used when nothing has a verified handle — not a failure, just empty. */
export function emptyReport(period) {
  return {
    headline: 'No competitor has a verified Instagram handle yet, so there is nothing to measure.',
    baseline: true, quiet_week: false, period,
    movements: [], competitor_board: [], market: [], gaps: [],
    proposed_rules: [], proposed_ideas: [], agenda_changes: [],
    unanswered: ['No competitor has a verified Instagram handle, so nothing could be measured.'],
    sources: [], stage_reached: 'gather',
  }
}

/**
 * The period a run covers. Ends now, starts `days` back.
 *
 * UTC dates, matching how competitor_snapshots and research_runs store them,
 * and matching the ledger's month boundary — brand-local time is right for
 * scheduling a post and wrong for a measurement window that has to line up
 * with rows captured by a server.
 */
export function periodFor(days = 7, now = new Date()) {
  const end = now instanceof Date ? now : new Date(now)
  const start = new Date(end.getTime() - days * 86_400_000)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    days,
  }
}

// ─── Telling a credentials problem from a competitor problem ───────────────
// These look identical in the per-rival failure list and are completely
// different problems. "Could not read Technolight" three times over reads as
// three rivals having gone private; the same three lines when the token is
// blocked mean nothing was ever going to be measured and the person needs to
// go and fix an app setting.
//
// Observed live 2026-09-10: a well-formed token returning "API access blocked"
// (OAuthException 200) on every call including debug_token — an app-level
// block, not a scope or a competitor issue.

const AUTH_SHAPED = /API access blocked|OAuthException|access token|token (?:is )?(?:invalid|expired)|session has expired|permission|not authorized|unsupported get request/i

/**
 * Did every Instagram read fail for the same, credentials-shaped reason?
 *
 * Requires ALL of them to have failed: one rival erroring while others succeed
 * is genuinely that rival's problem, and misreporting it as a token failure
 * would send someone to the wrong dashboard.
 */
export function looksLikeCredentialsFailure(failures, attempted) {
  const list = failures || []
  if (!attempted || list.length < attempted) return false
  if (!list.length) return false
  return list.every(f => AUTH_SHAPED.test(String(f?.error || '')))
}

/** The sentence to put at the TOP of `unanswered` when that is what happened. */
export function credentialsNote(failures) {
  const message = String(failures?.[0]?.error || 'the Instagram API refused every request')
  return `No competitor could be measured because Instagram refused every request ` +
         `("${message}"). This is a credentials or app-permissions problem, not a ` +
         `problem with these competitors — check the Meta app's status and the ` +
         `META_IG_TOKEN. Nothing in this brief rests on Instagram evidence.`
}
