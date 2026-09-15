import { isConfigured } from './_supabase.js'
import { readAccounts, readOwnPosts, readAnalyticsFor } from './_ownData.js'
import { gatherZernioOwn } from './_gather.js'
import { authorise } from './_serviceAuth.js'
import {
  ownChannels, priorPeriod, externalRows, postsIn, analyticsByPost,
} from '../../src/lib/agent/ownChannels.js'
import { analyticsFor, engagementOf } from '../../src/lib/agent/aggregate.js'
import { periodFor } from '../../src/lib/agent/gather.js'
import { PLATFORM_META } from '../../src/lib/utils.js'

// ─── GET /api/agent/performance ────────────────────────────────────────────
// How our own posts did, as one JSON payload a report page can render.
//
// Query: ?workspace_id=…&period_days=30
//
// ── WHY THIS IS A SERVER ROUTE AND NOT A SUPABASE READ IN THE BROWSER ──
//
// Most of this page's data IS reachable with the anon key — generated_posts
// and post_analytics are RLS'd per workspace and the rest of the app reads
// them directly. Two pieces are not:
//
//   1. Posts made DIRECTLY on a platform (ARAK's LinkedIn page is published to
//      by hand, not through this app), and
//   2. the LinkedIn company page's own totals — impressions, page views,
//      follower gains.
//
// Both come from Zernio, behind ZERNIO_API_KEY, which is a deployment secret
// and must never enter the bundle. LinkedIn is this brand's best-performing
// channel and almost none of it goes through the app, so a browser-only
// report would show the one channel that matters as silent — the exact
// failure gatherZernioOwn was written to fix one layer down.
//
// ── AND WHY IT RE-READS RATHER THAN CALLING gatherOwnChannels ──
//
// gatherOwnChannels returns the folded per-platform shape and throws the posts
// away. This route needs the posts themselves for the "best posts" list, so it
// does the same four reads and folds twice. It deliberately does NOT touch
// _gather's own path: the weekly run is the expensive, scheduled thing, and a
// report page is not a reason to refactor it.
//
// Reads only. Nothing here writes a row, spends a model token, or starts a run.

/** LinkedIn's page insights refuse a window longer than 88 days. */
const MAX_DAYS = 88
const DEFAULT_DAYS = 30

/** Up to this many posts on the report's "best posts" list. */
const TOP_N = 5

function firstOf(value) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The request's parameters, from wherever this runtime happens to put them.
 *
 * Vercel parses the query string onto `req.query`; the Vite dev server hands
 * the handler a plain Node request where it is still sitting in `req.url`.
 * Reading only `req.query` therefore works in production and answers
 * "workspace_id is required" on every local call — a difference that shows up
 * as a broken feature on a laptop and nowhere else, which is the most
 * expensive kind of difference. run.js already sets the precedent by reading
 * its own body rather than trusting `req.body`.
 */
export function params(req) {
  const out = {}
  try {
    const url = new URL(req?.url || '', 'http://localhost')
    for (const [k, v] of url.searchParams) out[k] = v
  } catch { /* no query string to read */ }
  for (const [k, v] of Object.entries(req?.query || {})) out[k] = firstOf(v)
  if (req?.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) {
      if (v !== undefined && v !== null && v !== '') out[k] = v
    }
  }
  return out
}

/**
 * The best-performing posts of the period, across every platform.
 *
 * Built from the SAME post list and the SAME analytics index ownChannels
 * folds, so a post cannot appear here with one engagement number and inside
 * its platform's average with another. Posts with no analytics row are absent
 * rather than zero — see engagementOf.
 */
export function bestPosts(posts, byPostId, period, limit = TOP_N) {
  const scored = []
  for (const p of postsIn(posts, period)) {
    const stats = engagementOf(analyticsFor(byPostId, p))
    if (!stats) continue
    scored.push({
      id: p.id,
      platform: p.platform,
      label: PLATFORM_META[p.platform]?.label || p.platform,
      topic: p.topic || '',
      format: p.format || p.media_type || '',
      url: p.platform_post_url || '',
      published_at: p.published_at || p.scheduled_date || '',
      posted_directly: p.origin === 'external',
      engagement: stats.engagement,
      likes: stats.likes,
      comments: stats.comments,
      shares: stats.shares,
      saves: stats.saves,
      reach: stats.reach,
      views: stats.views,
    })
  }
  return scored
    .sort((a, b) => b.engagement - a.engagement
      || String(b.published_at).localeCompare(String(a.published_at)))
    .slice(0, limit)
}

/**
 * The totals across every channel, for the band at the top of the report.
 *
 * `avg_engagement` is computed over MEASURED posts only and is null when none
 * were measured — an average over zero posts is not 0, and printing 0 next to
 * "posts published: 6" is the kind of quiet lie this whole module's
 * neighbours are organised against.
 */
export function totalsFor(own) {
  const platforms = own?.platforms || []
  let posts = 0
  let measured = 0
  let engagement = 0
  let followers = null

  for (const p of platforms) {
    posts += p.posts || 0
    measured += p.measured || 0
    if (p.total_engagement !== null && p.total_engagement !== undefined) {
      engagement += p.total_engagement
    }
    if (p.connected && p.followers !== null && p.followers !== undefined) {
      followers = (followers || 0) + p.followers
    }
  }

  return {
    posts,
    measured,
    total_engagement: measured ? engagement : null,
    avg_engagement: measured ? Math.round((engagement / measured) * 100) / 100 : null,
    followers,
    connected_count: own?.connected_count || 0,
    measured_count: own?.measured_count || 0,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'GET or POST only.' })
    return
  }
  if (!isConfigured) {
    res.status(500).json({ error: 'Supabase is not configured on this deployment.' })
    return
  }

  const q = params(req)
  const workspaceId = String(q.workspace_id || '').trim()
  if (!workspaceId) {
    res.status(400).json({ error: 'workspace_id is required.' })
    return
  }

  // A workspace_id in a query string is not evidence of anything. Same gate as
  // the run: a signed-in member of THIS workspace, or the service secret.
  const auth = await authorise(req, workspaceId)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  const days = Math.min(MAX_DAYS, Math.max(1, Number(q.period_days) || DEFAULT_DAYS))
  const period = periodFor(days)
  const prior = priorPeriod(period)

  try {
    const accounts = await readAccounts(workspaceId, { activeOnly: true })
    // Widened to the prior window's start so the comparison has something to
    // compare against; postsIn does the precise bucketing in code.
    const posts = await readOwnPosts(workspaceId, { from: prior?.start || period.start })
    const analytics = await readAnalyticsFor(workspaceId, posts)
    const zernio = await gatherZernioOwn(accounts, period)

    const own = ownChannels({
      accounts: accounts || [],
      posts: posts || [],
      analytics: analytics || [],
      period,
      prior,
      external: zernio.external,
      pageInsights: zernio.pageInsights,
    })

    // The same two folds ownChannels performs internally, repeated here so the
    // best-posts list is drawn from exactly the set it measured.
    const live = new Set(
      (accounts || [])
        .filter(a => a?.is_active !== false)
        .map(a => String(a?.platform || '').toLowerCase()),
    )
    const ext = externalRows(zernio.external)
    const allPosts = [...(posts || []), ...ext.posts.filter(p => live.has(p.platform))]
    const byPostId = analyticsByPost([...(analytics || []), ...ext.analytics])

    res.status(200).json({
      ok: true,
      period,
      prior,
      own,
      totals: totalsFor(own),
      best_posts: bestPosts(allPosts, byPostId, period),
      // Named rather than swallowed: a report that silently omits LinkedIn
      // because a key is missing looks identical to a quiet month.
      zernio_note: zernio.note || '',
      generated_at: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err).slice(0, 300) })
  }
}
