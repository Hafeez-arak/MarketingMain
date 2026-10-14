// ─── The Instagram page's one post list ────────────────────────────────────
//
// Two sources, one list. Our own rows (drafts, the queue, what we sent) come
// from the database; what is actually live on the account comes from Zernio's
// feed, which also carries posts made in the Instagram app. Before this the
// page showed them as two separate tabs, and the stat tiles counted only the
// first — so "Published 0" sat above a list with a live post in it.
//
// Which posts are ours: a feed post with `zernio_post_id` (Zernio's
// latePostId) went out through this app; one without it was posted on
// Instagram directly. NOT `isExternal` — Zernio sets that on every row. See
// feedPost in api/zernio/_zernio.js.

export const ORIGIN = {
  app:       { label: 'Made in app',         title: 'Made in this app' },
  instagram: { label: 'Posted on Instagram', title: 'Posted on Instagram directly, not through this app' },
}

// Chip order is the page's order: everything first, then our own stages.
// Published is "live on the account", so it holds direct posts too — a post
// made in the Instagram app is as published as one we sent.
export const POST_FILTERS = [
  { key: 'all',             label: 'All posts' },
  { key: 'draft',           label: 'Drafts' },
  { key: 'pending_publish', label: 'Pending' },
  { key: 'scheduled',       label: 'Scheduled' },
  { key: 'published',       label: 'Published' },
]

export function matchesFilter(row, key) {
  if (key === 'all') return true
  return row.status === key
}

export function countPosts(rows) {
  const out = {}
  for (const f of POST_FILTERS) out[f.key] = rows.filter(r => matchesFilter(r, f.key)).length
  return out
}

// Reel / Carousel / Post, the words Instagram itself uses.
export function feedPostType(media) {
  const m = String(media || '').toLowerCase()
  if (m === 'video' || m === 'reel' || m === 'reels') return 'Reel'
  if (m === 'carousel' || m === 'carousel_album') return 'Carousel'
  return 'Post'
}

export function appPostType(post) {
  const raw = post?._raw || {}
  if (raw.media_type === 'video' || raw.video_url || post?.videoUrl) return 'Reel'
  if ((post?.mediaUrls || []).length > 1) return 'Carousel'
  return 'Post'
}

// Only numbers Zernio actually has. Instagram's reach arrives about a day
// late, so a fresh post shows likes and comments first rather than "0 reach".
export function feedStats(post) {
  if (!post) return []
  return [
    ['likes', 'like'], ['comments', 'comment'], ['reach', 'reached'], ['views', 'view'],
  ]
    .filter(([key]) => post[key] != null)
    .map(([key, word]) => {
      const n = post[key]
      const label = key === 'reach' ? word : `${word}${n === 1 ? '' : 's'}`
      return `${n.toLocaleString()} ${label}`
    })
}

// The Zernio id a row was sent as. An empty string is "never sent", not an id
// — the column has held '' before, and matching on it would pair every unsent
// post with every direct one.
function sentId(post) {
  const id = post?._raw?.zernio_post_id ?? post?.zernioPostId ?? ''
  return String(id || '').trim()
}

const time = v => {
  const t = Date.parse(v || '')
  return Number.isFinite(t) ? t : 0
}

// The moment a row is about: when it goes out, when it went out, or (for a
// draft) when it was made.
function appWhen(post, feed) {
  const raw = post._raw || {}
  if ((post.status === 'scheduled' || post.status === 'publishing') && raw.scheduled_publish_at) return raw.scheduled_publish_at
  if (post.status === 'published') return raw.published_at || feed?.published_at || post.createdAt
  return post.createdAt
}

// One row per post, de-duplicated where a post we made is also in the feed
// (it is then one "Made in app" row carrying the feed's numbers and link).
//
// Order: posts still to go out first, soonest at the top — they are the ones
// that need attention — then everything else newest first.
export function buildAllPosts(appPosts = [], feedPosts = [], now = Date.now()) {
  const byId = new Map()
  for (const p of appPosts) {
    const id = sentId(p)
    if (id) byId.set(id, p)
  }

  const feedFor = new Map()
  const rows = []
  for (const f of feedPosts) {
    const zid = String(f?.zernio_post_id || '').trim()
    const mine = zid && byId.get(zid)
    if (mine) { if (!feedFor.has(mine)) feedFor.set(mine, f); continue }
    rows.push({
      key: `feed:${f.id}`,
      origin: f.zernio_post_id ? 'app' : 'instagram',
      status: 'published',
      type: feedPostType(f.media_type),
      when: f.published_at || null,
      post: null,
      feed: f,
    })
  }

  for (const p of appPosts) {
    const feed = feedFor.get(p) || null
    rows.push({
      key: `app:${p.id}`,
      origin: 'app',
      // On the account is published, whatever our row last heard.
      status: feed ? 'published' : p.status,
      type: feed?.media_type ? feedPostType(feed.media_type) : appPostType(p),
      when: appWhen(p, feed),
      post: p,
      feed,
    })
  }

  const upcoming = r => (r.status === 'scheduled' || r.status === 'publishing') && time(r.when) > now
  return rows.sort((a, b) => {
    const ua = upcoming(a), ub = upcoming(b)
    if (ua !== ub) return ua ? -1 : 1
    return ua ? time(a.when) - time(b.when) : time(b.when) - time(a.when)
  })
}
