import {
  createZernio, retryRateLimited, explainZernioError, INSTAGRAM_INSIGHT_METRICS,
  LINKEDIN_PAGE_METRICS, LINKEDIN_MAX_DAYS,
} from '../zernio/_zernio.js'
import { readAccounts } from './_ownData.js'

// ─── Asking Zernio directly ────────────────────────────────────────────────
//
// Everything else in this agent reads `post_analytics`, our own mirror of what
// Zernio knows. That mirror is incomplete, and the gap is not small.
//
// Checked live 2026-09-14 against Arak's Instagram account:
//
//   Zernio holds analytics for   9 posts
//   `post_analytics` holds rows for  3 posts, all of them orphaned
//   `generated_posts` holds          1 published post
//
// Seven of those nine are posts published straight to Instagram rather than
// through this app. Zernio measures them — reach, impressions, likes, real
// numbers — and reports them under `latePostId: null` because no Zernio post
// object ever existed for them. Our sync matches on `zernio_post_id`, so it
// has never written a single one of them down. They are the brand's actual
// history, and the assistant could not see any of it.
//
// Mirroring them properly means a schema that can hold a measurement with no
// post attached, which is a migration and a sync change. This module is the
// other half of the answer and needs neither: when someone asks how the
// account is doing, go and ask Zernio. It is our own API, the key is already
// on this deployment, and the numbers are authoritative rather than a copy.
//
// ── ISOLATION ──
//
// The profile id is NEVER taken from an argument. It is read from
// `social_accounts` for the VERIFIED workspace, exactly like every other tool
// (see the header of src/lib/agent/tools.js). A Zernio profile id the model
// could supply would be a cross-tenant read of another brand's numbers, and
// Zernio would serve it happily — the API key is the deployment's, not the
// workspace's.

/**
 * The widest insights window Meta will actually accept.
 *
 * The documented limit is 30 days — `(#100) There cannot be more than 30 days
 * (2592000 s) between since and until` — but asking for exactly 30 still
 * fails, and the reason is the date format. `since` and `until` are sent as
 * YYYY-MM-DD, and `until` is expanded to the END of that day. So a nominal
 * 30-day span is really 30 days and 23:59:59, which is more than 30 days, and
 * Meta rejects the entire request rather than trimming it.
 *
 * 29 is the largest value that survives that expansion. Verified against the
 * live account: 30 → HTTP 400, 29 → 200.
 *
 * `analyticsPlan` in _zernio.js clamps to the same 29 for the Analytics page,
 * having arrived at it independently. Two callers finding the same boundary
 * the same painful way is the argument for it being written down in both
 * places rather than inferred once.
 */
export const MAX_INSIGHT_DAYS = 29

/** Posts to pull in one go. The account has 9; this is room to grow. */
const POST_LIMIT = 100

function ymd(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * The Zernio profile this workspace publishes as, plus its live accounts.
 *
 * Returns null when the workspace has never connected anything, which is a
 * complete answer rather than an error — a brand with no accounts has no
 * account analytics, and saying so is the job.
 */
export async function zernioProfileFor(workspaceId) {
  const accounts = await readAccounts(workspaceId, { activeOnly: true })
  const live = (accounts || []).filter(a => a.zernio_profile_id)
  if (!live.length) return null
  return {
    profileId: live[0].zernio_profile_id,
    accounts: live,
  }
}

/**
 * Account-level insights for one Instagram account.
 *
 * The window is clamped to 30 days because Meta rejects anything wider with
 * `(#100) There cannot be more than 30 days between since and until` — and it
 * rejects the whole request, so one over-wide ask returns nothing at all
 * rather than a truncated range. Observed on the first call made here.
 *
 * `follower_count` is deliberately NOT requested. Zernio's own error lists the
 * valid metrics and it is not among them: accounts_engaged, comments,
 * follows_and_unfollows, likes, profile_links_taps, reach, replies, reposts,
 * saves, shares, total_interactions, views. Followers come from
 * follower-stats instead, which is a different pipeline with a different
 * freshness guarantee.
 */
export async function accountInsights(z, accountId, days = MAX_INSIGHT_DAYS) {
  const span = Math.min(Math.max(1, days), MAX_INSIGHT_DAYS)
  const until = new Date()
  const since = new Date(until.getTime() - span * 86_400_000)
  try {
    // Metrics named explicitly from the shared list rather than left to the
    // endpoint's default. Zernio's own error enumerates what is valid, and
    // `follower_count` is not among them — asking for it 400s the whole call.
    const out = await retryRateLimited(() => z.request('analytics/instagram/account-insights', {
      query: {
        accountId, since: ymd(since), until: ymd(until),
        metrics: INSTAGRAM_INSIGHT_METRICS.join(','),
      },
    }))
    const metrics = out?.metrics || {}
    return {
      ok: true,
      window: { since: ymd(since), until: ymd(until), days: span },
      reach: metrics.reach?.total ?? null,
      views: metrics.views?.total ?? null,
      accounts_engaged: metrics.accounts_engaged?.total ?? null,
      total_interactions: metrics.total_interactions?.total ?? null,
      // Taps on the link in the bio — Instagram's own count, and the only
      // platform that reports one. Carried through rather than dropped: it is
      // the tap half of the bio-link question the Website tab answers, and its
      // arrivals half (GA4 sessions) is always smaller for reasons that are
      // not a bug. Null, never 0, when Instagram did not report it.
      profile_links_taps: metrics.profile_links_taps?.total ?? null,
      // Carried through verbatim. Zernio states its own staleness and the
      // agent is required to pass that on rather than present a 48-hour-old
      // number as this morning's.
      data_delay: out?.dataDelay || '',
    }
  } catch (err) {
    return { ok: false, error: explainZernioError(err) }
  }
}

/**
 * A LinkedIn company page's own numbers, across every post on the page.
 *
 * Page-level, like Instagram's account insights, and the only place three
 * things live: impressions on posts made directly on LinkedIn, follower gains,
 * and page views. LinkedIn has NO views metric for an ordinary post — it counts
 * impressions — so a question about LinkedIn views is answered with
 * impressions, and says so, never with a zero.
 *
 * The window is capped at 88 days, Zernio's limit for this read (89 → 400).
 * A personal profile is not asked: Zernio refuses it with
 * personal_account_not_supported.
 *
 * `engagement_rate` arrives from LinkedIn as a 0..1 fraction; it is passed on
 * as a percentage so it cannot be read as 0.07%.
 */
export async function linkedinPageInsights(z, account, days = MAX_INSIGHT_DAYS) {
  const base = {
    account_id: account?.zernio_account_id || '',
    name: account?.display_name || account?.username || '',
  }
  if (account?.account_type === 'personal') {
    return { ...base, ok: false, error: 'Page insights exist only for LinkedIn company pages; this account is a personal profile.' }
  }
  const span = Math.min(Math.max(1, Number(days) || MAX_INSIGHT_DAYS), LINKEDIN_MAX_DAYS)
  const until = new Date()
  const since = new Date(until.getTime() - span * 86_400_000)
  try {
    const out = await retryRateLimited(() => z.request('analytics/linkedin/org-aggregate-analytics', {
      query: {
        accountId: base.account_id, since: ymd(since), until: ymd(until),
        metricType: 'total_value', metrics: LINKEDIN_PAGE_METRICS.join(','),
      },
    }))
    const metrics = out?.metrics || {}
    const total = key => metrics[key]?.total ?? null
    const rate = total('engagement_rate')
    return {
      ...base,
      ok: true,
      window: { since: ymd(since), until: ymd(until), days: span },
      impressions: total('impressions'),
      // LinkedIn's unique_impressions: distinct members who saw a post.
      members_reached: total('unique_impressions'),
      clicks: total('clicks'),
      reactions: total('likes'),
      comments: total('comments'),
      reposts: total('shares'),
      engagement_rate_pct: rate === null ? null : Math.round(rate * 10000) / 100,
      followers_gained_organic: total('organic_followers_gained'),
      followers_gained_paid: total('paid_followers_gained'),
      page_views: {
        total: total('page_views_total'),
        overview: total('page_views_overview'),
        careers: total('page_views_careers'),
        jobs: total('page_views_jobs'),
        life: total('page_views_life'),
      },
      data_delay: out?.dataDelay || '',
    }
  } catch (err) {
    return { ...base, ok: false, error: explainZernioError(err) }
  }
}

/**
 * Followers, and how they moved.
 *
 * Separate from insights because it is a separate pipeline: Zernio's daily
 * SNAPSHOTTER writes this, not Meta's insights API. The practical consequence,
 * observed on Arak's account the day it was connected — `currentFollowers: 0`
 * with `dataPoints: 0` and an empty series — is that a freshly connected
 * account has no follower figure at all until the snapshotter next runs, and
 * the zero it reports meanwhile is a default over no observations.
 *
 * `measured` is the flag that keeps that honest. Without it a caller cannot
 * tell "this account has no followers" from "nobody has counted yet", and
 * those are the two answers this whole codebase refuses to collapse.
 */
export async function followerStats(z, profileId) {
  try {
    const out = await retryRateLimited(() => z.request('accounts/follower-stats', { query: { profileId } }))
    return {
      ok: true,
      accounts: (out?.accounts || []).map(a => {
        const points = Number(a?.dataPoints) || 0
        return {
          account_id: a?._id || '',
          platform: a?.platform || '',
          username: a?.username || '',
          // Only a number when something was actually observed.
          followers: points > 0 ? (a?.currentFollowers ?? null) : null,
          growth: points > 0 ? (a?.growth ?? null) : null,
          growth_pct: points > 0 ? (a?.growthPercentage ?? null) : null,
          data_points: points,
          measured: points > 0,
          note: points > 0
            ? ''
            : 'No follower snapshot has been captured for this account yet. Zernio\'s snapshotter ' +
              'runs daily, so a recently connected account has no follower figure until it next ' +
              'runs — the 0 Zernio reports here is a default over an empty series, not a count.',
        }
      }),
    }
  } catch (err) {
    return { ok: false, error: explainZernioError(err) }
  }
}

/**
 * Every post Zernio has numbers for, whether or not we published it.
 *
 * `latePostId` is Zernio's id for a post IT published — the value we store as
 * `zernio_post_id`. It is null for a post made directly on the platform, and
 * that is the whole reason this function exists: those posts are invisible to
 * every other reader in the agent, and on this account they are seven of the
 * nine and hold most of the real engagement.
 *
 * `origin` names which kind each one is, so the agent can say "published
 * through this app" and "posted directly to Instagram" rather than blurring
 * them. They answer different questions: the first is about our workflow, the
 * second is about the account's actual history.
 */
export async function postAnalytics(z, profileId, { limit = POST_LIMIT } = {}) {
  try {
    const out = await retryRateLimited(() => z.request('analytics', { query: { profileId, limit } }))
    const posts = (out?.posts || []).map(p => {
      const a = p?.analytics || {}
      const zernioPostId = p?.latePostId || ''
      const platform = p?.platforms?.[0]?.platform || p?.platform || ''
      // LinkedIn has no views on an ordinary post and a company page has no
      // saves. Zernio fills both with 0; they are passed on as null so neither
      // reads as a measurement of nothing.
      const unmeasured = platform === 'linkedin' ? ['views', 'saves'] : []
      const metric = key => (unmeasured.includes(key) ? null : (a[key] ?? null))
      return {
        zernio_post_id: zernioPostId,
        origin: zernioPostId ? 'published_by_this_app' : 'posted_directly_on_platform',
        content: String(p?.content || '').slice(0, 200),
        published_at: p?.publishedAt || null,
        status: p?.status || '',
        platform,
        platform_post_id: p?.platforms?.[0]?.platformPostId || '',
        platform_post_url: p?.platformPostUrl || p?.platforms?.[0]?.platformPostUrl || '',
        // 'text', 'image', 'video', … when Zernio knows it. The research run
        // quotes it on a best post, so "format: unrecorded" means unknown.
        media_type: p?.mediaType || '',
        likes: metric('likes'),
        comments: metric('comments'),
        shares: metric('shares'),
        saves: metric('saves'),
        reach: metric('reach'),
        impressions: metric('impressions'),
        views: metric('views'),
        clicks: metric('clicks'),
        engagement_rate: a.engagementRate ?? null,
        last_updated: a.lastUpdated || null,
      }
    })
    return {
      ok: true,
      posts,
      total: out?.overview?.totalPosts ?? posts.length,
      published: out?.overview?.publishedPosts ?? null,
      last_sync: out?.overview?.lastSync || null,
    }
  } catch (err) {
    return { ok: false, error: explainZernioError(err) }
  }
}

/**
 * Everything Zernio knows about this workspace's accounts, in one call.
 *
 * Never throws. A tool that dies because one of three upstream calls failed
 * would lose the two that succeeded, and a partial answer clearly labelled is
 * worth much more here than an exception — the same rule stage 0 follows.
 */
export async function liveZernioAnalytics(workspaceId, { days = MAX_INSIGHT_DAYS, apiKey } = {}) {
  const key = apiKey || process.env.ZERNIO_API_KEY || ''
  if (!key) {
    return {
      available: false,
      error: 'ZERNIO_API_KEY is not set on this deployment, so Zernio cannot be asked directly. ' +
        'Stored analytics are still available through get_channel_analytics.',
    }
  }

  const profile = await zernioProfileFor(workspaceId)
  if (!profile) {
    return {
      available: false,
      error: 'No connected account in this workspace carries a Zernio profile id, so there is ' +
        'nothing to ask Zernio about.',
    }
  }

  const z = createZernio({ apiKey: key })
  const instagram = profile.accounts.find(a => String(a.platform).toLowerCase() === 'instagram')

  const linkedinPages = profile.accounts.filter(a => String(a.platform).toLowerCase() === 'linkedin')

  const [followers, posts, insights, linkedin] = await Promise.all([
    followerStats(z, profile.profileId),
    postAnalytics(z, profile.profileId),
    instagram?.zernio_account_id
      ? accountInsights(z, instagram.zernio_account_id, days)
      : Promise.resolve({ ok: false, error: 'No Instagram account connected, so there are no Instagram account insights.' }),
    Promise.all(linkedinPages.map(a => linkedinPageInsights(z, a, days))),
  ])

  const byOrigin = { published_by_this_app: 0, posted_directly_on_platform: 0 }
  for (const p of posts.posts || []) byOrigin[p.origin] = (byOrigin[p.origin] || 0) + 1

  return {
    available: true,
    profile_id: profile.profileId,
    followers,
    account_insights: insights,
    linkedin_page_insights: linkedin,
    metric_notes:
      'LinkedIn does not count views on ordinary posts. Its measure of how often a post was seen is ' +
      'impressions, and members_reached is the number of distinct members who saw it. LinkedIn views ' +
      'and saves are null because LinkedIn does not report them, not because they were zero — answer ' +
      'a question about LinkedIn views with impressions, and say that is what LinkedIn measures.',
    post_analytics: posts,
    counts: byOrigin,
    // The sentence that stops the two numbers being confused. Someone reading
    // "9 posts" next to a schedule holding one will otherwise assume a bug.
    coverage_note:
      `Zernio has analytics for ${posts.total ?? 0} post${posts.total === 1 ? '' : 's'} on this ` +
      `account: ${byOrigin.published_by_this_app} published through this app and ` +
      `${byOrigin.posted_directly_on_platform} posted directly on the platform. The second group ` +
      'is not in our database at all — it has no local post row, and no tool other than this one ' +
      'can see it. Treat it as the account\'s real history, and do not describe it as missing data.',
  }
}
