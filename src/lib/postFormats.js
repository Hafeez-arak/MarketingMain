// ─── Post format & orientation catalog ─────────────────────────────────────
// The single source of truth for "what kinds of post exist on this platform,
// and what orientations does each one support." Everything downstream —
// the plan idea editor, generation, and (later) TikTok/Snapchat — reads
// from here instead of each screen keeping its own copy.
//
// This absorbs what used to be three separate, drifting copies of the same
// information: IG_STYLES/LI_STYLES + TONE_CROSSWALK/crosswalkStyle inside
// CampaignPlanner.jsx, and the now-deleted src/lib/designSuggestion.js.

// `zernioContentType` / `zernioMediaType` are what the publish payload carries
// for this format. Mostly absent on purpose: Zernio infers feed vs carousel
// from how many mediaItems you send, and a lone video posts as a Reel by
// itself — only Stories and TikTok photo carousels need saying out loud.
// Recording the absence here beats every caller remembering which formats
// are implicit.
export const FORMAT_CATALOG = {
  instagram: [
    { id: 'feed_image', label: 'Feed image', media: 'image', ratios: ['4:5', '1:1', '1.91:1'], defaultRatio: '4:5' },
    { id: 'carousel',   label: 'Carousel',    media: 'image', ratios: ['4:5', '1:1'],           defaultRatio: '4:5', slides: { min: 2, max: 10, default: 3 } },
    { id: 'reel',       label: 'Reel',        media: 'video', ratios: ['9:16'],                 defaultRatio: '9:16' },
    { id: 'story',      label: 'Story',       media: 'image', ratios: ['9:16'],                 defaultRatio: '9:16', zernioContentType: 'story' },
  ],
  tiktok: [
    { id: 'video',          label: 'Video',          media: 'video', ratios: ['9:16'], defaultRatio: '9:16' },
    { id: 'photo_carousel', label: 'Photo carousel',  media: 'image', ratios: ['9:16'], defaultRatio: '9:16', slides: { min: 2, max: 10, default: 3 }, zernioMediaType: 'photo' },
  ],
  // LinkedIn leads with TEXT, unlike every other platform here — a post with
  // no media is the normal case rather than a degenerate one, which is why it
  // is first and therefore the default. The others follow LinkedIn's own
  // composer: one image, several images, one video, or a poll.
  //
  // `media: 'none'` is load-bearing. It is what tells the composer not to ask
  // for an image, and what lets a LinkedIn post be finished without uploading
  // anything at all.
  //
  // NOT here, deliberately: document (PDF/carousel) posts. LinkedIn supports
  // them and so does Zernio, but a PDF has nowhere to live in this app — the
  // media library records images and videos, and generated_posts stores an
  // image_url and a video_url with no third column. Adding the format without
  // that plumbing would put a choice on screen that cannot round-trip through
  // a draft, which is the same "field that silently does nothing" this
  // composer's header refuses elsewhere.
  linkedin: [
    { id: 'text',        label: 'Text post',   media: 'none',  ratios: [] },
    { id: 'feed_image',  label: 'Single image', media: 'image', ratios: ['1.91:1', '1:1', '4:5'], defaultRatio: '1.91:1' },
    { id: 'multi_image', label: 'Multi-image',  media: 'image', ratios: ['1:1', '1.91:1'],        defaultRatio: '1:1', slides: { min: 2, max: 20, default: 3 } },
    { id: 'video',       label: 'Video',        media: 'video', ratios: ['16:9', '1:1', '9:16'],  defaultRatio: '16:9' },
    { id: 'poll',        label: 'Poll',         media: 'none',  ratios: [] },
  ],
  snapchat: [
    { id: 'story',     label: 'Story',     media: 'image', ratios: ['9:16'], defaultRatio: '9:16' },
    { id: 'spotlight', label: 'Spotlight', media: 'video', ratios: ['9:16'], defaultRatio: '9:16' },
  ],
}

// ── Hard publish limits, for pre-flight validation ────────────────────────
// Deliberately separate from FORMAT_CATALOG.slides, which is a GENERATION
// concern — "how many slides should we make?" — tuned to what the team
// actually wants produced. These are the PLATFORM's refusal thresholds: the
// numbers that decide whether a publish call fails. TikTok will accept 35
// photos in a carousel; nobody here wants to generate 35. Both are true, and
// they belong in different places.
//
// Checked in the browser before publishing so that a too-long video is a
// sentence in the composer rather than an opaque provider error minutes
// later with the post row stuck mid-publish. The workflow re-checks
// server-side regardless — this is a courtesy, not the guard.
export const PLATFORM_LIMITS = {
  instagram: {
    caption:       2200,
    carouselMax:   10,
    collaborators: 3,
    video: { minSeconds: 3, maxSeconds: 900, maxBytes: 1024 ** 3,      types: ['video/mp4', 'video/quicktime'] },
    image: { maxBytes: 8 * 1024 ** 2,                                  types: ['image/jpeg', 'image/png'] },
  },
  tiktok: {
    caption:       2200,
    carouselMax:   35,
    video: { minSeconds: 3, maxSeconds: 600, maxBytes: 4 * 1024 ** 3,  types: ['video/mp4', 'video/quicktime', 'video/webm'] },
    image: { maxBytes: 20 * 1024 ** 2,                                 types: ['image/jpeg', 'image/png', 'image/webp'] },
  },
  // LinkedIn. The caption ceiling is LinkedIn's own 3,000 for a post body —
  // the one number here that is a hard API refusal rather than a threshold.
  //
  // carouselMax and the poll numbers come from Zernio's OpenAPI spec, which is
  // what this app actually publishes through: "Up to 20 images, no
  // multi-video" and a poll of 2–4 options, question ≤140, each option ≤30.
  // The video bounds are LinkedIn's published upload limits (3 seconds to 15
  // minutes, up to 5GB); the image size is advisory and is warned about rather
  // than refused, the same as everywhere else here.
  linkedin: {
    caption:       3000,
    carouselMax:   20,
    video: { minSeconds: 3, maxSeconds: 900, maxBytes: 5 * 1024 ** 3,  types: ['video/mp4', 'video/quicktime'] },
    image: { maxBytes: 10 * 1024 ** 2,                                 types: ['image/jpeg', 'image/png', 'image/gif'] },
    poll:  { minOptions: 2, maxOptions: 4, questionMax: 140, optionMax: 30 },
  },
  snapchat: {
    caption:       250,
    carouselMax:   1,
    video: { minSeconds: 5, maxSeconds: 60,  maxBytes: 1024 ** 3,      types: ['video/mp4'] },
    image: { maxBytes: 5 * 1024 ** 2,                                  types: ['image/jpeg', 'image/png'] },
  },
}

export function limitsFor(platform) {
  return PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.instagram
}

// The contentType / media_type a format needs in the publish payload, or an
// empty object when the platform infers it. Spread the result rather than
// assigning it, so an absent field stays absent from the JSON instead of
// becoming an explicit null the API then has to reject.
export function zernioFormatFields(platform, formatId) {
  const f = getFormat(platform, formatId)
  if (!f) return {}
  return {
    ...(f.zernioContentType ? { contentType: f.zernioContentType } : {}),
    ...(f.zernioMediaType   ? { media_type:  f.zernioMediaType   } : {}),
  }
}

export function formatsFor(platform) {
  return FORMAT_CATALOG[platform] || FORMAT_CATALOG.instagram
}
export function getFormat(platform, formatId) {
  const list = formatsFor(platform)
  return list.find(f => f.id === formatId) || list[0]
}
export function defaultFormat(platform) {
  return formatsFor(platform)[0]?.id || 'feed_image'
}
export function aspectRatiosFor(platform, formatId) {
  return getFormat(platform, formatId)?.ratios || []
}
export function defaultAspectRatio(platform, formatId) {
  return getFormat(platform, formatId)?.defaultRatio || ''
}
export function slideRange(platform, formatId) {
  return getFormat(platform, formatId)?.slides || null
}

const ASPECT_LABELS = { '1:1': 'Square', '4:5': 'Portrait', '1.91:1': 'Landscape', '9:16': 'Vertical / Story', '16:9': 'Widescreen' }
export function aspectLabel(ratio) {
  return ASPECT_LABELS[ratio] || ratio || ''
}

// ── Visual styles (moved from CampaignPlanner.jsx IG_STYLES/LI_STYLES) ──
const IG_STYLES = [
  { value: 'photorealistic',   label: 'Photorealistic' },
  { value: 'dramatic',         label: 'Dramatic' },
  { value: 'minimalist',       label: 'Minimalist' },
  { value: 'warm_residential', label: 'Warm residential' },
  { value: 'cool_commercial',  label: 'Cool commercial' },
  { value: 'facade_exterior',  label: 'Facade / exterior' },
]
export function stylesFor() {
  return IG_STYLES
}

// The other platform's format id when fanning an idea out — most format ids
// (feed_image, carousel) are shared verbatim; only the video/text formats
// have per-platform names.

// ── post_kind: a derived compatibility value only ──────────────────────────
// The current generation engine (v2 workflows) branches on post_kind, not on
// format/media_type/wants_caption. Rather than teach it a new vocabulary
// mid-build, this stays the ONE place that translates the new, more precise
// fields (format, wants_caption, image_text) into the value the engine
// already understands. Never set post_kind independently elsewhere — every
// write goes through this function so the two can't drift into a
// nonsensical combination (e.g. format='reel' + post_kind='carousel').
export function derivePostKind({ platform, format, wantsCaption = true, imageText = '' }) {
  const f = getFormat(platform, format)
  if (!f || f.media === 'none') return 'text_only'
  if (f.media === 'video') return 'video'
  // LinkedIn's multi-image is a carousel in every sense the engine cares about
  // — several slides, one post. Its id differs only because LinkedIn calls it
  // that; left out here it was stored as a single caption_image.
  if (f.id === 'carousel' || f.id === 'photo_carousel' || f.id === 'multi_image') return 'carousel'
  if ((imageText || '').trim()) return 'text_image'
  if (!wantsCaption) return 'image_only'
  return 'caption_image'
}

// The format an idea should carry on ANOTHER platform it is sent to.
//
// An idea's format belongs to its main platform. When it also targets a
// second one, the id is kept if that platform has it (feed_image, video),
// otherwise the first format there with the same kind of media — a reel sent
// to LinkedIn is a video, an Instagram carousel is a multi-image. Null when
// the platform has nothing that carries this media at all, which is the
// caller's cue to refuse rather than write a row that cannot publish.
export function formatForTarget(platform, formatId, mediaType) {
  const list = FORMAT_CATALOG[platform]
  if (!list) return null
  const exact = list.find(f => f.id === formatId)
  if (exact) return exact.id
  const wantsSlides = !!Object.values(FORMAT_CATALOG).flat().find(f => f.id === formatId)?.slides
  const sameMedia = list.filter(f => f.media === (mediaType || 'image'))
  return (sameMedia.find(f => !!f.slides === wantsSlides) || sameMedia[0])?.id || null
}
