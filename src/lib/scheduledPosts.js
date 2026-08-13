import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

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
  'linkedin_generated_posts',
  'generated_posts',
]

// Every post for a workspace, newest first, across all three tables in ONE
// ordered query — the thing a client-side union cannot do.
//
// `from`/`to` filter on scheduled_publish_at for the calendar; omitted, you
// get the review queue's view of the world (everything, by creation).
export async function fetchScheduledPosts(workspaceId, accessToken, {
  from, to, platform, publishStatus, limit = 400,
} = {}) {
  if (!workspaceId) return []
  const q = [
    `workspace_id=eq.${workspaceId}`,
    'select=*',
    `limit=${limit}`,
  ]
  if (from) q.push(`scheduled_publish_at=gte.${from}`)
  if (to)   q.push(`scheduled_publish_at=lte.${to}`)
  if (platform) q.push(`platform=eq.${platform}`)
  if (publishStatus) q.push(`publish_status=eq.${publishStatus}`)
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
//
// LinkedIn is the case that stops this being a pass-through: the view
// synthesises `caption` from hook + body, so writing `caption` back would put
// text in a column LinkedIn never reads and leave the real hook/body stale.
// Patching caption on a LinkedIn row therefore splits it the same way the
// Studio sheet does — first line is the hook, the rest is the body.
export async function patchPost(accessToken, postTable, postId, patch) {
  if (!POST_TABLES.includes(postTable)) return { error: `Unknown post table: ${postTable}` }
  if (!postId) return { error: 'No post id.' }

  const body = { ...patch, updated_at: new Date().toISOString() }
  if (postTable === 'linkedin_generated_posts' && typeof body.caption === 'string') {
    const text = body.caption.trim()
    const nl = text.indexOf('\n')
    body.hook = nl > 0 ? text.slice(0, nl).trim() : text
    body.body = nl > 0 ? text.slice(nl + 1).trim() : ''
    delete body.caption
  }

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

// Move a post to a different slot.
//
// Only touches our own row. A post already handed to Zernio carries a
// zernio_post_id, and Zernio owns its schedule at that point — so this
// reports that the caller must re-send it rather than silently letting the two
// disagree about when it goes out.
export async function reschedulePost(accessToken, post, whenISO) {
  const res = await patchPost(accessToken, post.post_table, post.id, {
    scheduled_publish_at: whenISO || null,
  })
  if (res.error) return res
  return {
    ...res,
    needsRepublish: !!post.zernio_post_id && post.publish_status === 'scheduled',
  }
}
