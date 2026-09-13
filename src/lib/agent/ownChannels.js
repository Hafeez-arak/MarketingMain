// ─── Our own channels, every platform ──────────────────────────────────────
// The agent could measure exactly one account: ours, on Instagram, through
// business_discovery. That was never a decision about what matters — it was a
// decision about what Meta's Graph happened to return, and it quietly made
// "how is our marketing doing" mean "how is our Instagram doing".
//
// Publishing has gone to four platforms. Analytics land in `post_analytics`
// for all of them — Instagram via the Meta insights sync, TikTok and LinkedIn
// via the Zernio sync, which writes a row for any post carrying a
// zernio_post_id and does not care which platform it went to. So the numbers
// exist. Nothing was reading them.
//
// This module reads them. Pure functions over rows: no network, no model, and
// no clock except the period it is handed.
//
// ── THE ASYMMETRY THIS MODULE DOES NOT TRY TO HIDE ──
//
// Our OWN performance is knowable on every platform, because we published the
// post and the platform tells us how it did. A COMPETITOR's performance is
// knowable on Instagram alone, because business_discovery is the only public
// endpoint of its kind — TikTok and LinkedIn have no equivalent, at any price.
// So a rival on those platforms stays `web_only` no matter how much is built
// here, and the brief has to say which kind of claim it is making. Presenting
// "our LinkedIn is up 40%" and "rivals are winning on LinkedIn" as the same
// grade of fact would be the exact failure the whole design is organised
// against.

import { LIVE_PLATFORMS, PLATFORM_META } from '../utils.js'
import { engagementOf } from './aggregate.js'

/** Below this many measured posts, a per-platform average is quoted but flagged. */
export const WEAK_SAMPLE = 5

/**
 * Both periods need at least this many measured posts before a change is
 * computed at all.
 *
 * One post against one post is not a trend, it is two posts. Reporting that as
 * "engagement up 300%" is how a report earns the reputation of being noise,
 * and the floor is cheaper than the credibility.
 */
export const MIN_FOR_CHANGE = 2

/** Below this relative change, a difference is noise rather than news. */
export const CHANGE_FLOOR = 0.15

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function round(value, places = 2) {
  const n = num(value)
  if (n === null) return null
  const f = 10 ** places
  return Math.round(n * f) / f
}

/**
 * Interactions on one post, or null when we have no measurement at all.
 *
 * DELEGATES to aggregate.js rather than reimplementing the rule, and that is
 * the whole point of this function existing at all.
 *
 * The first version here summed every analytics row for a post. That looks
 * obviously right and is obviously wrong: `post_analytics` re-syncs daily and
 * each row is a snapshot of CUMULATIVE totals, not that day's delta. Summing
 * them counts the same like once per sync — the live check on 2026-09-13 read
 * Arak's one published post, which has 2 likes and 1 comment, as 42
 * interactions, because fourteen days of identical snapshots had been added
 * together. A number fourteen times too large, presented with total
 * confidence, is precisely the failure this whole module is organised against.
 *
 * `engagementOf` already encodes the rule — newest metric_date wins — and a
 * second implementation that has to agree with it is a second implementation
 * that will eventually not. So there is one.
 */
export function engagementIn(rows) {
  const stats = engagementOf(rows)
  return stats ? stats.engagement : null
}

/** Keep only the posts published inside [start, end). */
export function postsIn(posts, period) {
  const start = Date.parse(period?.start || '')
  const end = Date.parse(period?.end || '')
  if (!Number.isFinite(start) || !Number.isFinite(end)) return []
  return (posts || []).filter(p => {
    // published_at is the truth; scheduled_date is the intention. A post that
    // slipped a day belongs in the week it actually went out, because that is
    // the week its numbers came from.
    const when = Date.parse(p?.published_at || p?.scheduled_date || '')
    return Number.isFinite(when) && when >= start && when < end
  })
}

/** post_analytics rows grouped by the post they belong to. */
export function analyticsByPost(analytics) {
  const by = {}
  for (const a of analytics || []) {
    const id = a?.post_id
    if (id) (by[id] ||= []).push(a)
  }
  return by
}

/**
 * One platform's numbers for one window.
 *
 * `measured` is carried everywhere alongside `posts` and is never optional:
 * "we published six" and "we know how two of them did" are different claims,
 * and a report that states the first while computing from the second is
 * telling a true-sounding lie.
 */
export function windowStats(posts, byPostId) {
  let measured = 0
  let engagement = 0
  let best = null

  for (const p of posts || []) {
    const e = engagementIn(byPostId?.[p.id])
    if (e === null) continue
    measured += 1
    engagement += e
    if (!best || e > best.engagement) {
      best = {
        id: p.id,
        engagement: e,
        topic: p.topic || '',
        format: p.format || p.media_type || '',
        url: p.platform_post_url || '',
        published_at: p.published_at || p.scheduled_date || '',
      }
    }
  }

  return {
    posts: (posts || []).length,
    measured,
    total_engagement: measured ? engagement : null,
    avg_engagement: measured ? round(engagement / measured) : null,
    best_post: best,
  }
}

/**
 * What state a channel is in, which decides what the brief is allowed to say.
 *
 * Four outcomes, and separating them is most of the value here. "We have no
 * numbers for LinkedIn" collapses three completely different situations — no
 * account, an account we ignored, and an account we posted to whose analytics
 * never synced — into one shrug. Each has a different fix and a different
 * person responsible for it.
 */
export function stateOf({ connected, posts, measured }) {
  if (!connected) return 'not_connected'
  if (!posts) return 'silent'
  if (!measured) return 'unmeasured'
  return 'measured'
}

const NOTES = {
  not_connected: p => `No ${p} account is connected, so nothing on ${p} can be measured.`,
  silent: p => `The ${p} account is connected but nothing was published to it in this period.`,
  unmeasured: p => `Posts went out on ${p} but none has analytics synced yet, so no engagement conclusion is available.`,
  measured: () => '',
}

/**
 * Week-over-week change for one platform, or null when the samples cannot
 * support one.
 *
 * Returns null rather than 0 for "we cannot tell", because null survives to
 * the model as the word "unknown" and 0 survives as the claim "unchanged".
 * The agent is required to be able to say it does not know.
 */
export function changeFor(now, prev) {
  const a = num(prev?.avg_engagement)
  const b = num(now?.avg_engagement)
  if (a === null || b === null) return null
  if ((prev?.measured || 0) < MIN_FOR_CHANGE || (now?.measured || 0) < MIN_FOR_CHANGE) return null
  if (a === 0 && b === 0) return null

  const abs = Math.abs(b - a)
  const rel = a !== 0 ? abs / Math.abs(a) : 1
  if (rel < CHANGE_FLOOR) return null

  return {
    from: a,
    to: b,
    change_pct: round(rel * 100, 1),
    direction: b > a ? 'up' : 'down',
    significance: rel >= 0.5 ? 'high' : rel >= 0.25 ? 'medium' : 'low',
  }
}

/**
 * Every platform we could be marketing on, and how we actually did on each.
 *
 * Every LIVE platform gets a row, including ones with no account — a channel
 * that is dark is a marketing fact, and one the brief should be able to raise.
 * Omitting it would make "we do not post on LinkedIn" indistinguishable from
 * "LinkedIn went fine", which is the sort of silence that lets a channel stay
 * dark for a year.
 *
 * @param {Array}  accounts  social_accounts rows for this workspace
 * @param {Array}  posts     generated_posts rows covering BOTH windows
 * @param {Array}  analytics post_analytics rows for those posts
 * @param {object} period    the window being reported
 * @param {object} prior     the window before it, for comparison
 */
export function ownChannels({ accounts = [], posts = [], analytics = [], period, prior } = {}) {
  const byPostId = analyticsByPost(analytics)

  const live = new Map()
  for (const a of accounts) {
    const key = String(a?.platform || '').toLowerCase()
    if (!key || a?.is_active === false) continue
    // First active account per platform wins. A workspace with two TikTok
    // accounts is not a case this reports on yet, and silently summing them
    // would produce an average belonging to neither.
    if (!live.has(key)) live.set(key, a)
  }

  const platforms = LIVE_PLATFORMS.map(platform => {
    const account = live.get(platform) || null
    const mine = (posts || []).filter(p => String(p?.platform || '').toLowerCase() === platform)
    const now = windowStats(postsIn(mine, period), byPostId)
    const prev = prior ? windowStats(postsIn(mine, prior), byPostId) : null
    const state = stateOf({ connected: !!account, posts: now.posts, measured: now.measured })
    const label = PLATFORM_META[platform]?.label || platform

    return {
      platform,
      label,
      connected: !!account,
      username: account?.username || '',
      followers: num(account?.followers_count),
      needs_reconnection: account?.needs_reconnection === true,
      ...now,
      // Quoted, but flagged. The codebase's existing instinct is to show a
      // thin number with a warning rather than withhold it — withholding
      // teaches people the page is broken, flagging teaches them to wait.
      weak: now.measured > 0 && now.measured < WEAK_SAMPLE,
      posts_prev: prev?.posts ?? null,
      measured_prev: prev?.measured ?? null,
      avg_engagement_prev: prev?.avg_engagement ?? null,
      change: changeFor(now, prev),
      state,
      note: NOTES[state](label),
    }
  })

  const connected = platforms.filter(p => p.connected)
  const measured = platforms.filter(p => p.state === 'measured')

  return {
    platforms,
    connected_count: connected.length,
    measured_count: measured.length,
    // The one sentence a reader needs before any number below it means
    // anything.
    note: connected.length === 0
      ? 'No social account is connected to this workspace, so none of our own performance can be measured.'
      : measured.length === 0
        ? `${connected.length} account${connected.length === 1 ? '' : 's'} connected, but no post in this period has analytics synced yet.`
        : '',
    period: period || null,
    prior: prior || null,
  }
}

/**
 * Turn the per-platform numbers into the findings the brief reports.
 *
 * Raw finding shapes rather than finished ones: `makeFinding` lives with the
 * lenses and owns the schema, so this returns the material and the lens does
 * the wrapping. That keeps this module free of any idea of what a lens is,
 * which is what lets it be tested with nothing but rows.
 *
 * Confidence is 1 throughout for anything measured, and that is not bravado —
 * these are subtractions over stored rows, not a model's recollection. The
 * honesty lives in `weak` and in the sample sizes quoted in `detail`, which is
 * the right place for it: the number is certain, its representativeness is not.
 */
export function ownChannelFindings(own) {
  const findings = []
  for (const p of own?.platforms || []) {
    if (p.state === 'not_connected') {
      // Only worth raising once there is something to compare it against —
      // otherwise a brand that has deliberately never used LinkedIn gets the
      // same nag every week forever.
      if ((own?.measured_count || 0) > 0) {
        findings.push({
          headline: `We have no ${p.label} presence at all.`,
          detail: `${p.label} is a platform this product can publish to, and no account is connected. ` +
            'That is a choice worth making deliberately rather than by default.',
          confidence: 1,
          novelty: 'continuing',
          suggested_action: `Decide whether ${p.label} is a channel for this brand. If it is, connect the account; if it is not, retire the question.`,
          evidence: { platform: p.platform, state: p.state },
        })
      }
      continue
    }

    if (p.state === 'silent') {
      findings.push({
        headline: `Nothing went out on ${p.label} this period.`,
        detail: `The account @${p.username || p.label} is connected${p.needs_reconnection ? ' but is flagged as needing reconnection' : ''} and published no posts in this window.`,
        confidence: 1,
        novelty: 'changed',
        suggested_action: p.needs_reconnection
          ? `Reconnect the ${p.label} account — publishing may be failing rather than paused.`
          : `Either schedule for ${p.label} or accept it as dormant and say so.`,
        evidence: { platform: p.platform, posts: 0, state: p.state },
      })
      continue
    }

    if (p.state === 'unmeasured') {
      findings.push({
        headline: p.posts === 1
          ? `1 post went out on ${p.label}, and we cannot see how it did.`
          : `${p.posts} posts went out on ${p.label}, and we cannot see how any of them did.`,
        detail: 'Posts published but no analytics row synced for this period. This is a pipeline gap, not a performance result — ' +
          'no conclusion about this channel is available until the sync runs.',
        confidence: 1,
        novelty: 'new',
        suggested_action: `Check the analytics sync for ${p.label}. Publishing without measurement means this channel cannot be judged at all.`,
        evidence: { platform: p.platform, posts: p.posts, measured: 0, state: p.state },
      })
      continue
    }

    // Measured.
    const sample = `${p.measured} of ${p.posts} post${p.posts === 1 ? '' : 's'} measured`
    const caveat = p.weak ? ` Thin sample (${p.measured} < ${WEAK_SAMPLE}) — directional, not conclusive.` : ''

    if (p.change) {
      findings.push({
        headline: `Our ${p.label} engagement went ${p.change.direction} ${p.change.change_pct}% (${p.change.from} → ${p.change.to} per post).`,
        detail: `Measured, not estimated: ${sample} this period against ${p.measured_prev} last period. ` +
          `Significance: ${p.change.significance}.${caveat}`,
        confidence: 1,
        novelty: 'changed',
        suggested_action: p.change.direction === 'down'
          ? `Establish what changed on ${p.label} before treating this as a trend — check format mix and posting times first.`
          : `Find what drove the rise on ${p.label} and repeat it deliberately.`,
        evidence: { platform: p.platform, ...p.change, measured: p.measured, measured_prev: p.measured_prev },
      })
    } else {
      findings.push({
        headline: `Our ${p.label} averaged ${p.avg_engagement} interactions per post.`,
        detail: `${sample}${p.avg_engagement_prev !== null ? `, against ${p.avg_engagement_prev} last period` : ''}. ` +
          `${p.measured_prev === null || p.measured_prev < MIN_FOR_CHANGE
            ? 'Not enough measured history to call a change yet.'
            : 'No change beyond the noise floor.'}${caveat}`,
        confidence: 1,
        novelty: 'continuing',
        suggested_action: '',
        evidence: { platform: p.platform, measured: p.measured, posts: p.posts, avg_engagement: p.avg_engagement },
      })
    }

    if (p.best_post) {
      findings.push({
        headline: `Best ${p.label} post this period: ${p.best_post.topic || 'untitled'} at ${p.best_post.engagement} interactions.`,
        detail: `Format: ${p.best_post.format || 'unrecorded'}.${p.best_post.url ? ` ${p.best_post.url}` : ''}`,
        confidence: 1,
        novelty: 'new',
        suggested_action: 'Check whether its format and angle are repeatable before assuming the topic was the cause.',
        evidence: { platform: p.platform, ...p.best_post },
      })
    }
  }

  return findings
}

/**
 * The window before a period, same length.
 *
 * Same length is the point: comparing a seven-day week against a nine-day one
 * reports a rise in posting that is really a rise in days.
 */
export function priorPeriod(period) {
  const start = Date.parse(period?.start || '')
  const end = Date.parse(period?.end || '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const span = end - start
  return {
    start: new Date(start - span).toISOString(),
    end: new Date(start).toISOString(),
    days: period?.days ?? Math.round(span / 86_400_000),
  }
}
