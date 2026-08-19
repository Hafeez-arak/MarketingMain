import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { brandWallToUtcISO, brandWallString, formatBrandDateTime } from './brandTime'
import { publishPost } from './meta'

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
  from, to, platform, publishStatus, unscheduled = false, limit = 400,
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
  // An array means "any of these" — the tray wants not_published OR failed,
  // and issuing that as two queries would need merging and re-sorting here.
  if (publishStatus) {
    q.push(Array.isArray(publishStatus)
      ? `publish_status=in.(${publishStatus.join(',')})`
      : `publish_status=eq.${publishStatus}`)
  }
  // Ordered by when it goes out when that is what was asked for, otherwise by
  // when it was made — a review queue and a calendar want different spines.
  q.push(`order=${from || to ? 'scheduled_publish_at.asc' : 'created_at.desc'}`)
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
// Who owns "when this goes out" is the whole question, and moving to Meta
// changed the answer. Under Zernio a scheduled post lived AT Zernio; our
// column was a copy, and when the two disagreed Zernio won and the post fired
// at the old time — hence the cancel-the-old-then-create-a-new dance.
//
// The Instagram Graph API cannot schedule at all, so we hold the slot
// outright: `scheduled_publish_at` is the only copy that exists, and there is
// nothing left to desync from.
//
// That does NOT make a scheduled move a plain UPDATE, and this is the part
// worth being careful about. The publish workflow's cron sweeps every five
// minutes and claims due rows by flipping 'scheduled' -> 'publishing'. A
// browser PATCH cannot see that claim, so a drag landing in the same instant
// would rewrite the time of a post already going out — and the post would go
// out anyway, at neither the old time nor the new one. Routing the move
// through the workflow makes it take the same atomic claim the sweeper does,
// so exactly one of them wins.
//
//   not_published / failed  — nobody else can touch it. Update the row, done.
//   scheduled               — ours, but the sweeper is a live second writer.
//                             Go through the workflow so the claim arbitrates.
//   publishing              — mid-flight at Instagram. Refuse.
//   published               — already out. Nothing to move.
//
// `movePost` below is the single entry point; this function just names the
// decision so the UI can grey out a drag before the user starts it, rather
// than failing after the drop.
export function moveKindFor(post) {
  const status = post?.publish_status || 'not_published'
  if (status === 'published')  return { kind: 'blocked', reason: 'Already published — this post has gone out.' }
  if (status === 'publishing') return { kind: 'blocked', reason: 'Publishing right now — wait for it to finish before moving it.' }
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
  const result = await publishPost(webhooks?.metaPublish, {
    postId: post.id, postTable: post.post_table, workspaceId,
    platform: post.platform,
    accountId: post.zernio_account_id || undefined,
    caption: post.caption || '',
    hashtags: post.hashtags || '',
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
  const url = webhooks?.metaPublish
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
