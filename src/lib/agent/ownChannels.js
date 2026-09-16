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
import { engagementOf, indexAnalytics, analyticsFor } from './aggregate.js'

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

/** A count for a sentence: 2,351, or "an unknown number of" when unmeasured. */
function fmtCount(value) {
  const n = num(value)
  return n === null ? 'an unknown number of' : n.toLocaleString('en-US')
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

/**
 * Posts that carry no date at all, so no window can contain them.
 *
 * Not a hypothetical. Checked live on 2026-09-14: this workspace's one
 * published Instagram post has `status: "published"`, `publish_status:
 * "publishing"`, and NULL for both `published_at` and `scheduled_date` —
 * Zernio has taken it and the timestamp lands when the publish settles.
 *
 * `postsIn` correctly refuses to place it in a week, which made the platform
 * read `silent` and the brief say "nothing went out on Instagram this period"
 * about a post that was going out at that moment. Counting these separately is
 * what lets the agent say the true thing instead: something is in flight, and
 * it has no numbers yet because it has not finished publishing.
 */
export function undatedIn(posts) {
  return (posts || []).filter(p =>
    !Number.isFinite(Date.parse(p?.published_at || '')) &&
    !Number.isFinite(Date.parse(p?.scheduled_date || '')))
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

/**
 * post_analytics rows grouped by the post they belong to.
 *
 * DELEGATES to indexAnalytics, for the same reason engagementIn delegates to
 * engagementOf: the rule about which id a metric row is keyed under — ours or
 * Zernio's — is a rule, and a second copy of it is a copy that will eventually
 * disagree. The original version here keyed on `post_id` alone and dropped
 * every row the sync had written under the provider's id.
 */
export function analyticsByPost(analytics) {
  return indexAnalytics(analytics)
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
    const e = engagementIn(analyticsFor(byPostId, p))
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
 * A post's first line as plain words.
 *
 * LinkedIn's text arrives with its own markup: punctuation escaped as `\(MoU\)`
 * and a mention as `@[TAWAL](urn:li:organization:14784924)`. Quoted as-is, the
 * brief's "best post" line reads like a stack trace.
 */
export function plainTopic(content) {
  return String(content || '')
    .split('\n')[0]
    .replace(/@\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\()[\]*_#.!-])/g, '$1')
    .trim()
    .slice(0, 120)
}

/**
 * Posts made directly on a platform, turned into the rows everything here reads.
 *
 * Our tables only hold posts published THROUGH this app. On 2026-09-14 ARAK
 * Lighting's LinkedIn page had two posts Zernio could measure and neither was
 * made here, so the run saw a connected page with nothing on it and would have
 * said "nothing went out on LinkedIn" about a page with 4,779 followers.
 *
 * `postAnalytics` in api/agent/_zernioLive.js reads them. This keeps only the
 * ones with no Zernio post id: a post the app published is also in Zernio's
 * list, and is already counted from `generated_posts`, so taking it twice
 * would double it in every average.
 *
 * Pure: rows in, rows out.
 */
export function externalRows(external = []) {
  const posts = []
  const analytics = []
  const seen = new Set()
  for (const e of external || []) {
    if (!e || e.zernio_post_id || e.origin === 'published_by_this_app') continue
    const platform = String(e.platform || '').toLowerCase()
    const key = e.platform_post_id || e.platform_post_url || ''
    if (!platform || !key || seen.has(key)) continue
    seen.add(key)
    const id = `external:${key}`
    posts.push({
      id,
      platform,
      published_at: e.published_at || null,
      scheduled_date: null,
      // The first line of the post, which is its headline on both platforms.
      topic: plainTopic(e.content),
      format: e.media_type || '',
      platform_post_url: e.platform_post_url || '',
      origin: 'external',
    })
    analytics.push({
      post_id: id,
      metric_date: String(e.last_updated || e.published_at || '').slice(0, 10),
      likes: e.likes, comments: e.comments, shares: e.shares,
      // null, not 0, where the platform does not count it (LinkedIn saves):
      // engagementOf skips a null rather than averaging in a zero.
      saves: e.saves,
      reach: e.reach, impressions: e.impressions, views: e.views, clicks: e.clicks,
      origin: 'external',
    })
  }
  return { posts, analytics }
}

/**
 * The newest date any of these posts went out, or null.
 *
 * Nothing after `before` counts. A post scheduled for next month has a
 * `scheduled_date` too, and on 2026-09-14 Instagram's "last post" read as
 * 2026-10-16 — a date that has not happened.
 */
export function lastPostAt(posts, before = Date.now()) {
  const ceiling = typeof before === 'number' ? before : Date.parse(before || '')
  let best = null
  for (const p of posts || []) {
    const when = Date.parse(p?.published_at || p?.scheduled_date || '')
    if (!Number.isFinite(when)) continue
    if (Number.isFinite(ceiling) && when > ceiling) continue
    if (best === null || when > best) best = when
  }
  return best === null ? null : new Date(best).toISOString()
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
 * @param {Array}  external  Zernio's post list (postAnalytics().posts); only
 *                           posts made directly on the platform are used
 * @param {object} pageInsights  page-level totals by platform, e.g.
 *                           { linkedin: linkedinPageInsights(...) }
 */
export function ownChannels({ accounts = [], posts = [], analytics = [], period, prior, external = [], pageInsights = {} } = {}) {
  const live = new Map()
  for (const a of accounts) {
    const key = String(a?.platform || '').toLowerCase()
    if (!key || a?.is_active === false) continue
    // First active account per platform wins. A workspace with two TikTok
    // accounts is not a case this reports on yet, and silently summing them
    // would produce an average belonging to neither.
    if (!live.has(key)) live.set(key, a)
  }

  // Posts made directly on a platform count only where an account is
  // connected: a post from an account that has since been disconnected is not
  // this brand's channel any more.
  const ext = externalRows(external)
  const allPosts = [...(posts || []), ...ext.posts.filter(p => live.has(p.platform))]
  const byPostId = analyticsByPost([...(analytics || []), ...ext.analytics])

  const platforms = LIVE_PLATFORMS.map(platform => {
    const account = live.get(platform) || null
    const mine = allPosts.filter(p => String(p?.platform || '').toLowerCase() === platform)
    const now = windowStats(postsIn(mine, period), byPostId)
    const prev = prior ? windowStats(postsIn(mine, prior), byPostId) : null
    const state = stateOf({ connected: !!account, posts: now.posts, measured: now.measured })
    const label = PLATFORM_META[platform]?.label || platform
    const undated = undatedIn(mine).length
    const last = lastPostAt(mine, period?.end || Date.now())
    const insights = pageInsights?.[platform] || null

    return {
      platform,
      label,
      connected: !!account,
      username: account?.username || '',
      followers: num(account?.followers_count),
      needs_reconnection: account?.needs_reconnection === true,
      ...now,
      // How many of this period's posts were made directly on the platform
      // rather than through this app. Both kinds are in `posts`.
      posted_directly: postsIn(mine.filter(p => p.origin === 'external'), period).length,
      // The newest post on the channel in anything we can see, so a quiet
      // week can say how long the quiet has lasted.
      last_post_at: last,
      // Page-level totals (LinkedIn company pages), or null. Includes every
      // post on the page and the page's own views and follower gains.
      page_insights: insights,
      // Posts that exist but sit in no window, because publishing has not
      // settled and stamped them yet. Reported as its own number so it can
      // never be read as either "we posted" or "we did not".
      undated,
      // Quoted, but flagged. The codebase's existing instinct is to show a
      // thin number with a warning rather than withhold it — withholding
      // teaches people the page is broken, flagging teaches them to wait.
      weak: now.measured > 0 && now.measured < WEAK_SAMPLE,
      posts_prev: prev?.posts ?? null,
      measured_prev: prev?.measured ?? null,
      avg_engagement_prev: prev?.avg_engagement ?? null,
      change: changeFor(now, prev),
      state,
      // "Nothing went out" is only true if nothing is on its way out. An
      // in-flight post makes the stock silent note a confident falsehood, so
      // it is replaced rather than appended to.
      note: state === 'silent' && undated > 0
        ? `${undated} ${label} post${undated === 1 ? ' is' : 's are'} mid-publish — accepted by ` +
          'Zernio but not yet stamped with a publish time, so nothing can be placed in this ' +
          'period or measured yet. This is publishing in progress, not a quiet week.'
        : state === 'silent' && last
          ? `${NOTES.silent(label)} The last post went out on ${last.slice(0, 10)}.`
          : NOTES[state](label),
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

// ─── Two true numbers for the same week ────────────────────────────────────
//
// The 15 Sep report said our Instagram posting went "from 4 to 7 posts a week"
// in its Top 3, "5 posts" in the social table, and "7 posts/week" again in the
// limitations — three figures for one channel in one document, and a
// recommendation to shift channel weight resting on the gap between them.
//
// Neither number was wrong. They count different things:
//
//   the ACCOUNT    business_discovery reads the Instagram profile itself, so
//                  it sees every post on the account, including ones nobody
//                  made through this app. It is a rate: posts per week.
//   OUR PUBLISHING `own_performance` counts the rows in our own tables for
//                  this exact window, and only those can carry analytics.
//
// A reader cannot be expected to hold that distinction while skimming, so it
// is resolved here, once, in code: each platform carries both figures and a
// sentence saying why they differ, and the synthesis is handed the sentence
// rather than left to reconcile two numbers it was given separately.
export function reconcileAccountPosting(own, snapshots = []) {
  if (!own) return own
  const self = (snapshots || []).find(s => s?.is_self && s?.data_source === 'instagram')
  if (!self) return own
  const accountPosts = num(self.posts_in_period)
  if (accountPosts === null) return own

  return {
    ...own,
    platforms: (own.platforms || []).map(p => {
      if (p.platform !== 'instagram') return p
      const mine = Number(p.posts) || 0
      const agrees = accountPosts === mine
      return {
        ...p,
        account_posts: accountPosts,
        account_posts_per_week: num(self.posts_per_week),
        posting_note: agrees
          ? ''
          : `The Instagram account itself shows ${accountPosts} post${accountPosts === 1 ? '' : 's'} in this ` +
            `window against ${mine} we published through this app${p.posted_directly ? '' : ''} — the account ` +
            'number counts everything on the profile, ours counts what we can measure. Both are correct; ' +
            'they are not the same measurement and must never be quoted as one.',
      }
    }),
  }
}

/**
 * The posting facts, in the words the brief must use.
 *
 * Handed to synthesis as given numbers so it has no reason to compute a third
 * one, and so the one comparison that is NOT available — our per-post
 * engagement against a rival's page totals — is named as unavailable rather
 * than left for the model to notice.
 */
export function ownPostingFacts(own) {
  return (own?.platforms || []).map(p => ({
    platform: p.platform,
    label: p.label,
    state: p.state,
    posts_we_published: p.posts ?? 0,
    posts_on_the_account: p.account_posts ?? null,
    measured: p.measured ?? 0,
    avg_engagement_per_post: p.avg_engagement ?? null,
    page_totals: p.page_insights?.ok
      ? { impressions: p.page_insights.impressions, clicks: p.page_insights.clicks, days: p.page_insights.window?.days }
      : null,
    note: [p.posting_note, p.weak ? `Thin sample: ${p.measured} measured post${p.measured === 1 ? '' : 's'}.` : ''].filter(Boolean).join(' '),
  }))
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
    const page = p.page_insights
    if (p.connected && page?.ok) {
      // Page totals come first and stand on their own. A quiet week on the
      // page is still a week in which the page was seen, clicked and followed,
      // and on LinkedIn that is most of what a B2B page is for.
      const days = page.window?.days
      const bits = [
        page.members_reached != null ? `${fmtCount(page.members_reached)} members reached` : '',
        page.engagement_rate_pct != null ? `engagement rate ${page.engagement_rate_pct}%` : '',
        page.page_views?.total != null ? `${fmtCount(page.page_views.total)} page views` : '',
      ].filter(Boolean)
      findings.push({
        headline: `Our ${p.label} page: ${fmtCount(page.impressions)} impressions, ${fmtCount(page.clicks)} clicks ` +
          `and ${fmtCount(page.followers_gained_organic)} new followers over the last ${days} days.`,
        detail: `${bits.length ? `${bits.join(', ')}. ` : ''}Page totals across every post on the page, ` +
          `including ones made directly on ${p.label}. ${page.data_delay || ''}`.trim(),
        confidence: 1,
        novelty: 'continuing',
        suggested_action: '',
        evidence: {
          platform: p.platform, kind: 'page_insights', window: page.window,
          impressions: page.impressions, members_reached: page.members_reached, clicks: page.clicks,
          reactions: page.reactions, comments: page.comments, reposts: page.reposts,
          engagement_rate_pct: page.engagement_rate_pct,
          followers_gained_organic: page.followers_gained_organic, page_views: page.page_views,
        },
      })
    }

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
      // An in-flight post is not a quiet week, and reporting it as one sends
      // someone to schedule content they have already published.
      if (p.undated > 0) {
        findings.push({
          headline: p.undated === 1
            ? `A ${p.label} post is mid-publish and has no timestamp yet.`
            : `${p.undated} ${p.label} posts are mid-publish and have no timestamps yet.`,
          detail: 'Accepted by Zernio but not yet stamped with a publish time, so they fall in no ' +
            'reporting period and have no analytics. Nothing is wrong unless this persists — ' +
            'the timestamp lands when the publish settles and the daily sync runs.',
          confidence: 1,
          novelty: 'new',
          suggested_action: `Check back after the next sync. If ${p.label} posts stay unstamped for ` +
            'more than a day, the publish is stuck rather than slow.',
          evidence: { platform: p.platform, undated: p.undated, state: p.state },
        })
        continue
      }

      const lastLine = p.last_post_at ? ` The last post went out on ${p.last_post_at.slice(0, 10)}.` : ''
      findings.push({
        headline: `Nothing went out on ${p.label} this period.`,
        detail: `The account @${p.username || p.label} is connected${p.needs_reconnection ? ' but is flagged as needing reconnection' : ''} and published no posts in this window.${lastLine}`,
        confidence: 1,
        novelty: 'changed',
        suggested_action: p.needs_reconnection
          ? `Reconnect the ${p.label} account — publishing may be failing rather than paused.`
          : `Either schedule for ${p.label} or accept it as dormant and say so.`,
        evidence: { platform: p.platform, posts: 0, state: p.state, last_post_at: p.last_post_at || null },
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
    // The reconciliation sentence rides on every measured finding for this
    // platform, because the contradiction it prevents appeared in the TOP 3 of
    // the 15 Sep report — a section written from the findings, not from the
    // table underneath it.
    const sample = `${p.measured} of ${p.posts} post${p.posts === 1 ? '' : 's'} measured` +
      (p.posting_note ? `. ${p.posting_note}` : '')
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

    // `topic` is often empty — plenty of posts are published without one, and
    // "Best: untitled" printed in the 15 Sep report's social table is a null
    // leaking into a sentence. Where there is no topic the post is named by
    // what we do know: its format, and failing that its number.
    if (p.best_post) {
      const named = String(p.best_post.topic || '').trim() || (p.best_post.format ? `a ${p.best_post.format} post` : 'one post')
      findings.push({
        headline: `Best ${p.label} post this period: ${named} at ${p.best_post.engagement} interactions.`,
        detail: `Format: ${p.best_post.format || 'unrecorded'}.${p.best_post.url ? ` ${p.best_post.url}` : ''}` +
          (p.posted_directly
            ? ` ${p.posted_directly} of this period's ${p.posts} ${p.label} post${p.posts === 1 ? '' : 's'} ` +
              `${p.posted_directly === 1 ? 'was' : 'were'} made directly on ${p.label}, not through this app.`
            : ''),
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
