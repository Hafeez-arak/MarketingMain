import { db } from './_supabase.js'

// ─── Where our own numbers actually live ───────────────────────────────────
//
// One module, because there were two readers and they had drifted.
//
// The research run read its own posts out of BOTH `generated_posts` and the
// frozen `instagram_generated_posts`, and joined analytics carefully. The chat
// assistant's tools read `generated_posts` alone and joined on `post_id`
// alone. Same question, same workspace, two different answers — and the wrong
// one was the one a person actually talks to.
//
// ── WHAT ZERNIO IS, IN ONE PARAGRAPH ──
//
// Zernio is the publishing provider. Every platform this product posts to goes
// out through it, and Zernio syncs each post's numbers back into
// `post_analytics` on a daily cadence. So "our analytics" and "the Zernio
// analytics" are the same thing said two ways, and they are OURS — they live
// in our Supabase, not behind a live call to Zernio. Nothing here talks to
// Zernio's API; it reads the tables Zernio's sync writes.
//
// Two consequences the readers below are built around:
//
//   1. A metric row is identified by `zernio_post_id`, the PROVIDER's id.
//      `post_id` is a pointer at whichever of our tables the post came from,
//      named by `post_table`. Joining on `post_id` alone silently misses every
//      row whose post has since moved tables. See indexAnalytics.
//
//   2. `last_synced_at` on an account is the honest ceiling on how fresh any
//      of this is. A newly connected account reads empty and 0 followers for
//      roughly the first 40 minutes, until the first snapshot lands — which is
//      a fact about the sync, not about the brand, and must be reported as
//      such rather than as "you have no audience".

/** Posts older than this are outside any window a chat question means. */
const MAX_POSTS = 500
const MAX_ANALYTICS = 2000

const ws = workspaceId => `workspace_id=eq.${encodeURIComponent(workspaceId)}`

/**
 * Every social account on this workspace, on every platform.
 *
 * Inactive rows included by default and FLAGGED rather than hidden, because
 * the two states answer different questions. "Which accounts are live" wants
 * active only; "why can you not see my Instagram numbers" is very often
 * answered by a row sitting there with `is_active: false` — the disconnected
 * test account, for one. Hiding it turns a one-line answer into a mystery.
 */
export async function readAccounts(workspaceId, { activeOnly = false } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : ''
  return db(
    `social_accounts?${ws(workspaceId)}${filter}&order=platform.asc&limit=50` +
    `&select=id,platform,username,display_name,is_active,needs_reconnection,followers_count,` +
    `last_synced_at,connected_at,publish_provider,login_method,zernio_account_id,profile_url`,
  ).catch(() => [])
}

/**
 * Our posts from BOTH tables, normalised into one shape.
 *
 * The legacy read is the same one gatherOwnChannels already does. It is kept
 * here for parity rather than because it currently returns anything: checked
 * with the service role on 2026-09-14, `instagram_generated_posts` holds ZERO
 * rows and `generated_posts` holds all of them. What it costs is one empty
 * query; what it buys is that the assistant and the research run cannot
 * disagree about which tables "our posts" means, which is the drift this whole
 * module exists to end.
 *
 * Read-only and additive. `generated_posts` stays the single write target.
 */
export async function readOwnPosts(workspaceId, { from, platform = '', limit = MAX_POSTS } = {}) {
  const cap = Math.min(limit, MAX_POSTS)
  const platformFilter = platform ? `&platform=eq.${encodeURIComponent(platform)}` : ''
  // `published_at` decides which week a post belongs to but is null for
  // anything that never went out, so the window is widened by every fallback
  // column here and bucketed precisely in code, where it is testable.
  //
  // `created_at` is in the OR deliberately. Without it a post that was never
  // published AND never scheduled — a draft sitting in the composer — matches
  // nothing and disappears from `posts_total`, which is how "we have six
  // drafts and no numbers" becomes the much more alarming "we have no posts".
  // Callers that care about the precise window narrow it in code.
  const window = from
    ? `&or=(published_at.gte.${from},scheduled_date.gte.${String(from).slice(0, 10)},created_at.gte.${from})`
    : ''

  const current = await db(
    `generated_posts?${ws(workspaceId)}${platformFilter}${window}` +
    `&order=created_at.desc&limit=${cap}` +
    `&select=id,platform,format,media_type,post_kind,topic,status,publish_status,` +
    `published_at,scheduled_date,platform_post_url,zernio_post_id`,
  ).catch(() => [])

  // The legacy table predates a world with more than one platform: it has no
  // `platform`, `format` or `media_type` column at all. So a platform filter
  // for anything but Instagram excludes it by definition, and asking Postgres
  // for those columns would 400 the whole query.
  const wantsLegacy = !platform || platform.toLowerCase() === 'instagram'
  const legacy = wantsLegacy
    ? await db(
        `instagram_generated_posts?${ws(workspaceId)}${window}` +
        `&order=created_at.desc&limit=${cap}` +
        `&select=id,topic,post_kind,status,publish_status,published_at,scheduled_date,` +
        `platform_post_url,zernio_post_id`,
      ).catch(() => [])
    : []

  return [
    ...(current || []),
    ...(legacy || []).map(p => ({ ...p, platform: 'instagram', format: '', media_type: '', legacy: true })),
  ]
}

/**
 * The metric rows for a set of posts, matched under EITHER id.
 *
 * Both id sets go into the filter because either one can be the match — see
 * indexAnalytics in aggregate.js for why. `zernio_post_id` is stored as ''
 * for a post never sent to Zernio, and an empty string in an `in.()` list
 * would match every unpublished row, so blanks are dropped before it is built.
 */
export async function readAnalyticsFor(workspaceId, posts) {
  const ourIds = (posts || []).map(p => p?.id).filter(Boolean)
  const theirIds = (posts || []).map(p => p?.zernio_post_id).filter(id => id && String(id).trim())
  if (!ourIds.length && !theirIds.length) return []

  const clauses = []
  if (ourIds.length) clauses.push(`post_id.in.(${ourIds.join(',')})`)
  if (theirIds.length) clauses.push(`zernio_post_id.in.(${theirIds.join(',')})`)

  return db(
    `post_analytics?${ws(workspaceId)}&or=(${clauses.join(',')})&limit=${MAX_ANALYTICS}` +
    `&select=post_id,zernio_post_id,post_table,platform,metric_date,likes,comments,shares,` +
    `saves,reach,views,impressions,synced_at,publish_provider`,
  ).catch(() => [])
}

/**
 * Every metric row in the workspace, regardless of which post it belongs to.
 *
 * Deliberately NOT joined to anything. The point is to make orphans visible:
 * on 2026-09-14 this workspace held 14 `post_analytics` rows whose `post_id`
 * and `zernio_post_id` match nothing in either posts table, because the post
 * they measured has since been deleted. Every join-based reader correctly
 * shows them as nothing — and "correctly shows nothing" is indistinguishable
 * from "the sync has never run", which is a completely different problem with
 * a completely different fix.
 *
 * Capped and thin: ids and dates, no metrics. This answers "does data exist
 * and is it attached", not "how did we do".
 */
export async function readAnalyticsOverview(workspaceId) {
  return db(
    `post_analytics?${ws(workspaceId)}&order=metric_date.desc&limit=${MAX_ANALYTICS}` +
    `&select=post_id,zernio_post_id,post_table,platform,metric_date,synced_at,publish_provider`,
  ).catch(() => [])
}

/**
 * How fresh any of this is, stated rather than implied.
 *
 * The agent is required to be able to say it does not know. This is the shape
 * that lets it say WHY it does not know, which is the difference between "no
 * analytics" and "the sync last ran eleven hours ago and this post went out
 * twenty minutes ago" — one of those sends someone to debug a pipeline, the
 * other tells them to wait.
 */
export function syncHealth(accounts, analytics) {
  const rows = analytics || []
  const dates = rows.map(a => a?.metric_date).filter(Boolean).sort()
  const synced = rows.map(a => a?.synced_at).filter(Boolean).sort()
  const accountSyncs = (accounts || []).map(a => a?.last_synced_at).filter(Boolean).sort()

  return {
    analytics_rows: rows.length,
    latest_metric_date: dates.length ? dates[dates.length - 1] : null,
    last_synced_at: synced.length ? synced[synced.length - 1] : null,
    account_last_synced_at: accountSyncs.length ? accountSyncs[accountSyncs.length - 1] : null,
    providers: [...new Set(rows.map(a => a?.publish_provider).filter(Boolean))],
    note: rows.length
      ? ''
      : 'No analytics rows exist for these posts yet. Zernio syncs a post\'s numbers on a daily ' +
        'cadence, and a newly connected account reads empty for roughly its first 40 minutes — ' +
        'so this is a statement about the sync, not about how the posts performed.',
  }
}
