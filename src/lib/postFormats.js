// ─── Post format & orientation catalog ─────────────────────────────────────
// The single source of truth for "what kinds of post exist on this platform,
// and what orientations does each one support." Everything downstream —
// the plan idea editor, generation, and (later) TikTok/Snapchat — reads
// from here instead of each screen keeping its own copy.
//
// This absorbs what used to be three separate, drifting copies of the same
// information: IG_STYLES/LI_STYLES + TONE_CROSSWALK/crosswalkStyle inside
// CampaignPlanner.jsx, and the now-deleted src/lib/designSuggestion.js.

export const FORMAT_CATALOG = {
  instagram: [
    { id: 'feed_image', label: 'Feed image', media: 'image', ratios: ['4:5', '1:1', '1.91:1'], defaultRatio: '4:5' },
    { id: 'carousel',   label: 'Carousel',    media: 'image', ratios: ['4:5', '1:1'],           defaultRatio: '4:5', slides: { min: 2, max: 10, default: 3 } },
    { id: 'reel',       label: 'Reel',        media: 'video', ratios: ['9:16'],                 defaultRatio: '9:16' },
    { id: 'story',      label: 'Story',       media: 'image', ratios: ['9:16'],                 defaultRatio: '9:16' },
  ],
  // Not wired into generation yet (that's Step 5) — the catalog carries them
  // already so the format system doesn't need a second pass to add them.
  tiktok: [
    { id: 'video',          label: 'Video',          media: 'video', ratios: ['9:16'], defaultRatio: '9:16' },
    { id: 'photo_carousel', label: 'Photo carousel',  media: 'image', ratios: ['9:16'], defaultRatio: '9:16', slides: { min: 2, max: 10, default: 3 } },
  ],
  snapchat: [
    { id: 'story',     label: 'Story',     media: 'image', ratios: ['9:16'], defaultRatio: '9:16' },
    { id: 'spotlight', label: 'Spotlight', media: 'video', ratios: ['9:16'], defaultRatio: '9:16' },
  ],
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
