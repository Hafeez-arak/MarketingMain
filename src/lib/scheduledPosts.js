import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { brandWallToUtcISO, brandWallString, formatBrandDateTime } from './brandTime'
import { publishPost } from './zernio'
import { defaultWebhookUrl } from './n8nWebhooks'
import { postLock } from './postLock'
import { mediaOfPost } from './mediaOrder'

// ─── Posts, across all three tables ────────────────────────────────────────
// Reads go through the scheduled_posts view (20260813_scheduled_posts_view.sql);
// writes still go to the base tables, because a view is read-only. Every row
// the view returns carries `post_table`, which is what a write is keyed on —
// so callers never assemble a table name themselves.
//
// This module is the ONLY place that knows the three table names. That is the
// point: the split leaked into every screen that wanted "all posts", and the
// screen that hand-unioned two of the three is exactly why TikTok and Snapchat
// posts were invisible in the app. Adding a platform should be a change here
// and nowhere else.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}
function jsonHeaders(accessToken, prefer = 'return=representation') {
  return { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: prefer }
}

export const POST_TABLES = [
  'instagram_generated_posts',
  'generated_posts',
]

// Every post for a workspace, newest first, across both tables in ONE
// ordered query — the thing a client-side union cannot do.
//
// `from`/`to` filter on scheduled_publish_at for the calendar; omitted, you
// get the review queue's view of the world (everything, by creation).
export async function fetchScheduledPosts(workspaceId, accessToken, {
  from, to, platform, publishStatus, status, unscheduled = false, limit = 400,
  planIdeaIds, ids, publishedSince, order,
} = {}) {
  if (!workspaceId) return []
  const q = [
    `workspace_id=eq.${workspaceId}`,
    'select=*',
    `limit=${limit}`,
  ]
  // The calendar's staging tray: posts that exist and are movable but have no
  // slot yet. A gte/lte range can never return these — NULL fails both — so it
  // has to be its own query shape rather than a wider range.
  if (unscheduled) q.push('scheduled_publish_at=is.null')
  if (from) q.push(`scheduled_publish_at=gte.${from}`)
  if (to)   q.push(`scheduled_publish_at=lte.${to}`)
  if (platform) q.push(`platform=eq.${platform}`)
  // A plan's own posts (the planner's lock check), or specific rows.
  if (planIdeaIds) {
    if (!planIdeaIds.length) return []
    q.push(`plan_idea_id=in.(${planIdeaIds.join(',')})`)
  }
  if (ids) {
    if (!ids.length) return []
    q.push(`id=in.(${ids.join(',')})`)
  }
  // An array means "any of these" — the tray wants not_published OR failed,
  // and issuing that as two queries would need merging and re-sorting here.
  if (publishStatus) {
    q.push(Array.isArray(publishStatus)
      ? `publish_status=in.(${publishStatus.join(',')})`
      : `publish_status=eq.${publishStatus}`)
  }
  // The REVIEW status, which is a different column and a different question
  // from publish_status: `status` says whether a person signed off,
  // publish_status says what the platform did. The Schedule page needs both —
  // "approved" and "not booked" is exactly the strip. See lib/postStage.js.
  if (status) {
    q.push(Array.isArray(status)
      ? `status=in.(${status.join(',')})`
      : `status=eq.${status}`)
  }
  // Everything that went out since an instant — what the publish watcher asks
  // on each poll, so it reads a handful of rows rather than the whole history.
  if (publishedSince) q.push(`published_at=gte.${publishedSince}`)
  // Ordered by when it goes out when that is what was asked for, otherwise by
  // when it was made — a review queue and a calendar want different spines.
  q.push(`order=${order || (from || to ? 'scheduled_publish_at.asc' : 'created_at.desc')}`)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scheduled_posts?${q.join('&')}`, {
      headers: authHeaders(accessToken),
    })
    return res.ok ? await res.json() : []
  } catch { return [] }
}

// Write back to the row's own table.
export async function patchPost(accessToken, postTable, postId, patch) {
  if (!POST_TABLES.includes(postTable)) return { error: `Unknown post table: ${postTable}` }
  if (!postId) return { error: 'No post id.' }

  const body = { ...patch, updated_at: new Date().toISOString() }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${postTable}?id=eq.${postId}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify(body),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, post: row }
  } catch (err) { return { error: err.message } }
}

// ─── Moving a post to a different time ─────────────────────────────────────
//
// Who owns "when this goes out" is the whole question. A scheduled post lives
// AT Zernio; our `scheduled_publish_at` is a copy, and when the two disagree
// Zernio wins and the post fires at the old time. So a scheduled move cannot
// be a browser PATCH — that would change our copy and nothing else. It goes
// through the publish workflow, which cancels the Zernio post and books a new
// one under the same atomic claim that guards publishing.
//
//   not_published / failed  — nobody else can touch it. Update the row, done.
//   scheduled               — booked at Zernio. Go through the workflow.
//   publishing              — mid-flight at the platform. Refuse.
//   published               — already out. Nothing to move.
//
// `movePost` below is the single entry point; this function just names the
// decision so the UI can grey out a drag before the user starts it, rather
// than failing after the drop.
export function moveKindFor(post) {
  const status = post?.publish_status || 'not_published'
  if (status === 'publishing') return { kind: 'blocked', reason: 'Publishing right now — wait for it to finish before moving it.' }
  // Published, or scheduled for a moment that has already passed — gone out
  // either way, and "moving" it would re-book a post that is already live.
  const lock = postLock(post)
  if (lock.locked) return { kind: 'blocked', reason: lock.reason }
  if (status === 'scheduled')  return { kind: 'remote',  reason: 'Scheduled — moving it re-books the slot.' }
  return { kind: 'local', reason: '' }
}

export function canMove(post) {
  return moveKindFor(post).kind !== 'blocked'
}

// Move a post to `dateKey` ('YYYY-MM-DD') at `time` ('HH:MM'), both read as
// BRAND wall-clock time.
//
// Takes the wall clock rather than an instant on purpose: the calendar's cells
// are brand-time days and its lanes are brand-time hours, so an instant would
// mean converting twice and getting to disagree with itself once. The single
// conversion lives in brandTime.js.
//
// `webhooks` is only consulted on the workflow path; a purely local move needs
// no webhook configured, and requiring one would block rescheduling drafts.
export async function movePost({ accessToken, post, dateKey, time, webhooks, workspaceId }) {
  const plan = moveKindFor(post)
  if (plan.kind === 'blocked') return { error: plan.reason }

  const whenISO = brandWallToUtcISO(dateKey, time)
  if (!whenISO) return { error: `Not a valid date/time: ${dateKey} ${time}` }

  // ── Ours alone ──────────────────────────────────────────────────────────
  if (plan.kind === 'local') {
    const res = await patchPost(accessToken, post.post_table, post.id, {
      scheduled_publish_at: whenISO,
    })
    return res.error ? res : { ok: true, post: res.post, movedVia: 'local', scheduledPublishAt: whenISO }
  }

  // ── Through the publish workflow, so the claim arbitrates ───────────────
  // Deliberately NOT patching our row first. The workflow owns every
  // publish_status transition — that is what lets its atomic claim mean
  // anything — and a browser write that moved the time before the claim was
  // taken would be the one writer the guard cannot see.
  const result = await publishPost((webhooks?.publishPost || defaultWebhookUrl('publishPost')), {
    postId: post.id, postTable: post.post_table, workspaceId,
    platform: post.platform,
    accountId: post.zernio_account_id || undefined,
    caption: post.caption || '',
    hashtags: post.hashtags || '',
    // The ordered list, so re-booking a mixed carousel sends the same items in
    // the same order it was published with. Reading only image_urls/video_url
    // here would re-book it as video-only — the exact half-a-post this change
    // exists to stop, arriving by a different door.
    media: mediaOfPost(post),
    imageUrl: post.image_url || '',
    imageUrls: Array.isArray(post.image_urls) && post.image_urls.length > 1 ? post.image_urls : undefined,
    videoUrl: post.video_url || '',
    coverImageUrl: post.cover_image_url || '',
    scheduledFor: brandWallString(dateKey, time),
    reschedule: true,
  })

  if (result.error) {
    return {
      error: result.error,
      // The workflow sets this when it cancelled the old slot but could not
      // book the new one. The post is now scheduled NOWHERE, which the UI has
      // to say out loud rather than leaving it looking merely unchanged.
      unscheduled: result.unscheduled === true,
    }
  }
  return {
    ok: true, movedVia: 'workflow', scheduledPublishAt: whenISO,
    zernioPostId: result.zernio_post_id || '',
    label: formatBrandDateTime(whenISO),
  }
}

// Clear a post's slot without deleting the post itself. Same ownership rules
// as a move: a scheduled row has the cron as a second writer, so the cancel
// goes through the workflow and takes the claim rather than racing it.
export async function unschedulePost({ accessToken, post, webhooks, workspaceId }) {
  const plan = moveKindFor(post)
  if (plan.kind === 'blocked') return { error: plan.reason }

  if (plan.kind === 'local') {
    const res = await patchPost(accessToken, post.post_table, post.id, {
      scheduled_publish_at: null,
    })
    return res.error ? res : { ok: true }
  }

  // There is no "cancel only" webhook, and adding one would be a second place
  // that knows how to move publish state. Reuse the reschedule path by asking
  // the workflow to move it nowhere — see cancel_only in the workflow.
  const result = await cancelScheduled({ webhooks, post, workspaceId })
  return result
}

async function cancelScheduled({ webhooks, post, workspaceId }) {
  const url = (webhooks?.publishPost || defaultWebhookUrl('publishPost'))
  if (!url) return { error: 'Publish webhook not configured — set it in Settings → Integrations.' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_id: post.id, post_table: post.post_table, workspace_id: workspaceId,
        platform: post.platform, reschedule: true, cancel_only: true,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { error: data.error || `Cancel failed (${res.status}).` }
    return { ok: true }
  } catch (err) { return { error: err.message } }
}
