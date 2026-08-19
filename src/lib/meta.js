import { BRAND_TIMEZONE } from './brandTime'

// ─── Meta Graph API (publishing + insights) ────────────────────────────────
// The ACTIVE publishing path. Instagram's own Graph API, reached through our
// own developer-portal app and access token — no third party between us and
// Meta, which is what the company requires.
//
// The browser NEVER calls graph.facebook.com directly and never sees the
// access token. That token lives only in n8n's environment (META_IG_TOKEN /
// META_IG_USER_ID), exactly like every other provider secret in this project,
// and the functions below hit our own n8n webhooks, which do the real Meta
// calls server-side and write the result back to Supabase.
//
// The request and response shapes here are DELIBERATELY identical to the
// Zernio module this replaces, so the four call sites changed an import and
// nothing else. src/lib/zernio.js is left in place, unchanged and unimported —
// the fallback stays until Meta has proven itself in production.
//
// One real behavioural difference, and it is worth knowing about: the
// Instagram Graph API cannot schedule. Passing `scheduledFor` does NOT hand
// the post to Instagram early — nothing is sent to Meta at all. It books the
// slot in our own row, and the publish workflow's 5-minute cron is what
// eventually publishes it. See the workflow's sticky note.

const POST_TABLES = ['instagram_generated_posts', 'generated_posts']

// Publish (or schedule) one already-approved post.
//
// `force` bypasses the workflow's duplicate guard. The workflow claims a post
// atomically before publishing (PATCH filtered on publish_status), so a second
// tab, a double-click, a retried webhook or the scheduler's own tick is
// refused rather than posting to Instagram twice. Default false: forcing is
// how you publish twice on purpose.
//
// `reschedule: true` widens that claim to accept a row already in 'scheduled'.
// Under Zernio this also triggered a cancel-then-recreate against the
// provider, because Zernio owned the slot and would otherwise fire at the old
// time. Here we own the slot outright, so a reschedule is just an update —
// the flag survives only because the call sites still send it and refusing a
// scheduled row without it remains the correct default.
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
        // Sent for shape compatibility only. Which Instagram account we post
        // as is decided by META_IG_USER_ID in n8n, not by the browser — a
        // caller cannot redirect a post to a different account by asking.
        account_id: accountId || undefined,
        caption: caption || '', hashtags: hashtags || '',
        image_url: imageUrl || '', image_urls: imageUrls || undefined,
        video_url: videoUrl || '', cover_image_url: coverImageUrl || '', alt_text: altText || '',
        // A schedule is a wall-clock time plus the zone to read it in, and the
        // zone is the BRAND's, never the browser's. Sending the browser's zone
        // is how scheduling from a laptop outside KSA published at the wrong
        // local hour — the times in a content plan have always meant Riyadh.
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

// On-demand refresh — hits the same workflow the daily schedule trigger runs,
// just synchronously so a "Refresh" button gets a real result.
//
// Worth knowing what this actually does, because it is not merely a cache
// refresh: Instagram reports LIFETIME totals per post and keeps no history for
// us, so this call is what records today's point on every time series the
// Analytics page draws. Skipping it does not delay data, it loses a day.
export async function syncMetaInsights(webhookUrl, workspaceId) {
  if (!webhookUrl) return { error: 'Meta Insights Sync webhook not configured — set it in Settings → Integrations.' }
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

// Live read for the Analytics page. Returns the same section keys the Zernio
// dashboard did (overview / daily / bestTime / frequency / decay / followers),
// but Meta pre-aggregates none of them — the workflow derives each one from
// live Graph reads plus the daily rows the sync has accumulated. Which is why
// `workspaceId` matters here and did not with Zernio: the time-shaped sections
// come out of OUR tables, and those are workspace-scoped.
export async function fetchMetaDashboard(webhookUrl, { platform = '', accountId = '', days = 30, workspaceId = '' } = {}) {
  if (!webhookUrl) return { error: 'Meta Dashboard webhook not configured — set it in Settings → Integrations.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: platform || undefined,
        account_id: accountId || undefined,
        workspace_id: workspaceId || undefined,
        days,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { error: data.error || `Dashboard fetch failed (${res.status}).` }
    return data
  } catch (err) {
    return { error: err.message }
  }
}

// Re-exported so a screen needs one import for "everything social", the way it
// did when these lived beside the provider calls. They are plain Supabase
// reads shared by both providers — see socialAnalytics.js.
export {
  fetchSocialAccounts,
  fetchLatestAnalytics,
  fetchPostAnalyticsTimeline,
} from './socialAnalytics'
