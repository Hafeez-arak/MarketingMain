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
  linkedin: [
    { id: 'feed_image', label: 'Feed image', media: 'image', ratios: ['1.91:1', '1:1', '4:5'], defaultRatio: '1.91:1' },
    { id: 'carousel',   label: 'Carousel',    media: 'image', ratios: ['1.91:1', '1:1', '4:5'], defaultRatio: '1.91:1', slides: { min: 2, max: 10, default: 3 } },
    { id: 'video',      label: 'Video',       media: 'video', ratios: ['16:9', '1:1', '9:16'],  defaultRatio: '16:9' },
    { id: 'text_only',  label: 'Text only',   media: 'none',  ratios: [],                       defaultRatio: '' },
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
const LI_STYLES = [
  { value: 'photorealistic',  label: 'Photorealistic' },
  { value: 'dramatic',        label: 'Dramatic' },
  { value: 'minimalist',      label: 'Minimalist' },
  { value: 'warm_interior',   label: 'Warm interior' },
  { value: 'cool_commercial', label: 'Cool commercial' },
  { value: 'facade_exterior', label: 'Facade / exterior' },
]
export function stylesFor(platform) {
  return platform === 'linkedin' ? LI_STYLES : IG_STYLES
}

// ── Tone/style crosswalk (moved from CampaignPlanner.jsx) — IG and LinkedIn
// don't share a tone vocabulary, so fanning an idea out to another platform
// needs a sensible equivalent, not a raw copy the target dropdown won't
// recognize. Style is shared except one naming difference (warm_residential
// vs warm_interior) for what's really the same look. ──
const TONE_CROSSWALK = {
  instagram_to_linkedin: { professional: 'thought_leader', inspirational: 'thought_leader', educational: 'technical_expert', casual: 'warm_human', promotional: 'promotional' },
  linkedin_to_instagram: { thought_leader: 'professional', executive: 'professional', technical_expert: 'educational', warm_human: 'casual', promotional: 'promotional' },
}
export function crosswalkTone(tone, fromPlatform, toPlatform) {
  if (fromPlatform === toPlatform) return tone
  const map = TONE_CROSSWALK[`${fromPlatform}_to_${toPlatform}`]
  return map?.[tone] || (toPlatform === 'linkedin' ? 'thought_leader' : 'professional')
}
export function crosswalkStyle(style, fromPlatform, toPlatform) {
  if (fromPlatform === toPlatform || !style) return style
  if (style === 'warm_residential' && toPlatform === 'linkedin') return 'warm_interior'
  if (style === 'warm_interior' && toPlatform === 'instagram') return 'warm_residential'
  return style
}
// The other platform's format id when fanning an idea out — most format ids
// (feed_image, carousel) are shared verbatim; only the video/text formats
// have per-platform names.
export function crosswalkFormat(formatId, fromPlatform, toPlatform) {
  if (fromPlatform === toPlatform) return formatId
  const targetFormats = formatsFor(toPlatform)
  if (targetFormats.some(f => f.id === formatId)) return formatId
  const sameMedia = getFormat(fromPlatform, formatId)?.media
  return targetFormats.find(f => f.media === sameMedia)?.id || defaultFormat(toPlatform)
}

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
