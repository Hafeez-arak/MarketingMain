import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { BRAND_TIMEZONE } from './brandTime'

// ─── Zernio (publishing + analytics) ─────────────────────────────────────
// The browser NEVER calls zernio.com directly and never sees the Zernio
// API key — that key lives only in n8n's environment (same as every other
// provider secret in this project). The two functions below hit our own
// n8n webhooks, which do the real Zernio calls server-side and write the
// result back to Supabase; everything else here just reads what n8n wrote.

// Publish (or schedule) one already-approved post. Pass either
// `scheduledFor` (ISO datetime, no timezone suffix — Zernio takes it
// separately) or nothing for publishNow. `postTable` must be one of the
// three generated-post tables — see the workflow's own ALLOWED_TABLES
// guard, which this mirrors so a typo fails fast in the browser instead of
// as an opaque n8n error.
const POST_TABLES = ['instagram_generated_posts', 'linkedin_generated_posts', 'generated_posts']

// `force` bypasses the workflow's duplicate guard. The workflow claims a post
// atomically before publishing (PATCH filtered on publish_status), so a second
// tab, a double-click or a retried webhook is refused rather than posting to
// the platform twice. The one case that legitimately needs overriding is a run
// that died between claiming and writing the id back, leaving the row stuck on
// 'publishing' — nothing else can move it until a stale-job reconciler exists.
// Default false: forcing is how you publish twice on purpose.
// `reschedule: true` means "this post is already scheduled at Zernio, move
// it": the workflow cancels the existing Zernio post before creating the new
// one, and widens its claim guard to accept a row in 'scheduled'. Without the
// flag a scheduled row is refused, which is the correct default — an
// unqualified second publish of a scheduled post is a double-post.
export async function publishPost(webhookUrl, {
  postId, postTable, workspaceId, platform, accountId,
  caption, hashtags, imageUrl, imageUrls, videoUrl, coverImageUrl, altText,
  scheduledFor, timezone, force = false, reschedule = false,
}) {
  if (!webhookUrl) return { error: 'Publish webhook not configured — set it in Settings → Integrations.' }
  if (!POST_TABLES.includes(postTable)) return { error: `Unknown post table: ${postTable}` }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_id: postId, post_table: postTable, workspace_id: workspaceId, platform,
        account_id: accountId || undefined,
        caption: caption || '', hashtags: hashtags || '',
        image_url: imageUrl || '', image_urls: imageUrls || undefined,
        video_url: videoUrl || '', cover_image_url: coverImageUrl || '', alt_text: altText || '',
        // A schedule is a wall-clock time plus the zone to read it in, and the
        // zone is the BRAND's, never the browser's. This used to send
        // Intl.DateTimeFormat().resolvedOptions().timeZone, so scheduling from
        // a laptop outside KSA published at the wrong local hour — the times in
        // a content plan have always meant Riyadh time.
        scheduled_for: scheduledFor || undefined,
        timezone: scheduledFor ? (timezone || BRAND_TIMEZONE) : undefined,
        force: force === true ? true : undefined,
        reschedule: reschedule === true ? true : undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { error: data.error || `Publish failed (${res.status}).` }
    return { ok: true, ...data }
  } catch (err) {
    return { error: err.message }
  }
}

// On-demand refresh — hits the same workflow the daily schedule trigger
// runs, just synchronously so a "Refresh" button gets a real result.
export async function syncZernio(webhookUrl, workspaceId) {
  if (!webhookUrl) return { error: 'Zernio Sync webhook not configured — set it in Settings → Integrations.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { error: data.error || `Sync failed (${res.status}).` }
    return { ok: true, ...data }
  } catch (err) {
    return { error: err.message }
  }
}

// Live proxy read — hits Zernio's own analytics-add-on endpoints (best
// time to post, posting-frequency, content-decay, daily rollups, follower
// history) through n8n and returns them as-is. Nothing here is stored in
// Supabase; it's fetched fresh on every dashboard load, same as Zernio's
// own dashboard does.
export async function fetchZernioDashboard(webhookUrl, { platform = '', accountId = '', days = 30 } = {}) {
  if (!webhookUrl) return { error: 'Zernio Dashboard webhook not configured — set it in Settings → Integrations.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: platform || undefined, account_id: accountId || undefined, days }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { error: data.error || `Dashboard fetch failed (${res.status}).` }
    return data
  } catch (err) {
    return { error: err.message }
  }
}

// ── Reads (straight Supabase — no secret involved, RLS-scoped like every
// other table in this app) ──────────────────────────────────────────────

export async function fetchSocialAccounts(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/social_accounts?workspace_id=eq.${workspaceId}&select=*&order=platform.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` } },
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}

// Latest metric row per (zernio_post_id, platform) — the running totals,
// not the whole daily time series (see fetchPostAnalyticsTimeline for
// that). Done client-side with a Map rather than a second query shape,
// since post_analytics is small per workspace (dozens to low hundreds of
// rows) and this avoids a Postgres DISTINCT ON round-trip for now.
export async function fetchLatestAnalytics(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/post_analytics?workspace_id=eq.${workspaceId}&select=*&order=metric_date.desc&limit=1000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return []
    const rows = await res.json()
    const latest = new Map()
    for (const r of rows) {
      const key = `${r.zernio_post_id}::${r.platform}`
      if (!latest.has(key)) latest.set(key, r) // rows already ordered newest-first
    }
    return [...latest.values()]
  } catch { return [] }
}

export async function fetchPostAnalyticsTimeline(workspaceId, accessToken, zernioPostId) {
  if (!workspaceId || !zernioPostId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/post_analytics?workspace_id=eq.${workspaceId}&zernio_post_id=eq.${zernioPostId}&select=*&order=metric_date.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` } },
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}
