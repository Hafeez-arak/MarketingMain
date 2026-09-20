import { mediaKindOf } from './composerMedia'

// ─── A post's media, in the order it was chosen ────────────────────────────
//
// NOT to be confused with ./postMedia.js, which is a different question about
// a different object: that one reads the slides of a PUBLISHED post as Zernio
// reports it back for analytics. This one describes a post of OUR OWN, on its
// way out — what the composer holds, what the row stores, what gets published.
//
// ── THE BUG THIS EXISTS TO KILL ──
// Five places independently decided a post is images OR a video, never both,
// and each dropped a different half of a mixed carousel:
//
//   studioBridge.manualMediaFor   a video blanked image_urls outright, so the
//                                 images never reached the row at all
//   studioBridge.mediaFieldsFor   same, on the Creative Studio path
//   composerState.composerFromPost  `video ? [video] : images` — reopening a
//                                 mixed post showed only the video, and the
//                                 next save wrote image_urls: [] over the rest
//   publishPost.mediaFields       `if (videos.length) return { videoUrl }` —
//                                 published the video, dropped the pictures
//   the n8n publish node          `if (videoUrl) {...} else {...}`
//
// Meanwhile PostPanel, the Post Queue and the planner cards all read
// image_urls, so they showed the images and nothing else. Four readers, each
// telling the truth about a different half, which is exactly what "at some
// places I find the 2 pics and at some places only the video" looks like.
//
// Instagram supports mixed carousels and so does Zernio: up to 10 items,
// images and videos mixed, every item sharing the aspect ratio of the first.
// The provider payload has always been an ordered array of { type, url }. The
// only thing missing was anywhere to KEEP the order.
//
// ── THE SHAPE ──
// `media` (jsonb on generated_posts) is that place, and it is authoritative
// when present:
//
//   [{ "type": "image", "url": "…" }, { "type": "video", "url": "…" }]
//
// The legacy columns are kept in step as a PROJECTION of it, never as a second
// source of truth — see projectionFor below for why that is what keeps this
// change small.

export const MAX_CAROUSEL_ITEMS = 10

const urlOf = m => String(m?.url || '').trim()

// Normalise anything media-shaped into [{ type, url }], in order, with blanks
// and duplicates removed. Duplicates matter: a carousel with the same picture
// twice is a mistake every time, and the platforms count it against the limit.
export function normaliseMedia(list) {
  const out = []
  const seen = new Set()
  for (const m of Array.isArray(list) ? list : []) {
    const url = urlOf(m)
    if (!url || seen.has(url)) continue
    seen.add(url)
    // Trust an explicit type; fall back to sniffing the url/mime, which is how
    // a row written before `media` existed gets classified.
    const type = m?.type === 'video' || m?.type === 'image' ? m.type : mediaKindOf(m)
    out.push({ type, url })
  }
  return out
}

// ── Reading a row ────────────────────────────────────────────────────────
// `media` when the row has it, otherwise rebuilt from the legacy columns.
//
// The fallback is not a nicety: every row written before this column existed
// has no `media`, and the planner, Creative Studio and the n8n generation
// workflows all still write the legacy columns. Reconstructing images-then-
// video is the best order available for those — it is what the old code would
// have published had it not been dropping half of it.
export function mediaOfPost(row) {
  if (!row) return []
  const stored = normaliseMedia(row.media)
  if (stored.length) return stored

  const images = Array.isArray(row.image_urls) && row.image_urls.length
    ? row.image_urls
    : [row.image_url].filter(Boolean)
  const legacy = [
    ...images.filter(Boolean).map(url => ({ type: 'image', url })),
    ...(row.video_url ? [{ type: 'video', url: row.video_url }] : []),
  ]
  return normaliseMedia(legacy)
}

// ── Writing a row ────────────────────────────────────────────────────────
// The ordered list, PLUS the legacy columns derived from it.
//
// Keeping the old columns populated is the single decision that stops this
// from being a rewrite. PostPanel, the Post Queue, the planner cards, the
// dashboard, post_analytics and several n8n nodes all read image_url /
// image_urls / video_url, and none of them has to change or even know this
// column exists — they keep reading a faithful projection. The rule is one
// way only: `media` is the truth, the columns are derived from it, and
// nothing writes a column without writing `media` too.
export function projectionFor(list) {
  const media = normaliseMedia(list)
  const images = media.filter(m => m.type === 'image').map(m => m.url)
  const videos = media.filter(m => m.type === 'video').map(m => m.url)
  return {
    media,
    image_url: images[0] || '',
    image_urls: images,
    video_url: videos[0] || '',
    // media_type answers "what is this post mostly?" for the screens that show
    // one icon. A mixed carousel is a carousel, so it reads as an image post
    // unless there is nothing but video in it.
    media_type: media.length === 0 ? 'none' : images.length ? 'image' : 'video',
  }
}

export const isMixed = list => {
  const m = normaliseMedia(list)
  return m.some(x => x.type === 'image') && m.some(x => x.type === 'video')
}

export const countsOf = list => {
  const m = normaliseMedia(list)
  return { images: m.filter(x => x.type === 'image').length, videos: m.filter(x => x.type === 'video').length, total: m.length }
}
