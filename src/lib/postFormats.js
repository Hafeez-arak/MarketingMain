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
  if (f.id === 'carousel' || f.id === 'photo_carousel') return 'carousel'
  if ((imageText || '').trim()) return 'text_image'
  if (!wantsCaption) return 'image_only'
  return 'caption_image'
}
