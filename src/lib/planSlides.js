// ─── A plan idea's slides ──────────────────────────────────────────────────
// One ordered list of media for one idea, where each slide knows where it
// came from. This replaces a model that could only answer "all of it is from
// the Studio" or "all of it is yours".
//
// WHAT WAS WRONG BEFORE
//
// An idea carried `image_mode` (one mode for the whole post), a single
// `preview_image_url` (the Studio render) and `reference_image_urls` (your
// uploads). Every reader then did some version of:
//
//     const images = idea.previewImageUrl ? [idea.previewImageUrl] : refs
//
// — the Studio render WINS and the uploads are discarded. So a four-slide
// carousel could be four AI images or four of your own, never two and two,
// and the moment a Studio render landed on an idea that already had uploads
// they stopped being reachable. Nothing said so; the slides simply changed.
//
// THE SHAPE
//
//   { url, type: 'image' | 'video', source: 'studio' | 'upload' | 'library',
//     versionId?: string }
//
// `source` is kept because the three are not interchangeable to a reader:
// a Studio slide can be reopened and re-rendered, an uploaded one can be
// replaced, and a library one points at an asset used elsewhere. `versionId`
// is how a Studio slide finds its way back to the session that made it.
//
// BACKWARD COMPATIBILITY IS NOT OPTIONAL HERE
//
// Every plan that exists predates this column, and a plan mid-flight has real
// pictures attached. So an idea with no `slides` is not an idea with no
// slides — it is an old idea, and `slidesFor` derives the list from the old
// fields exactly as the old readers did, including the Studio-render-wins
// rule. That rule is wrong going forward and faithful going backward, which
// is the only combination that does not silently rearrange someone's month.

const SOURCES = ['studio', 'upload', 'library']

/** One slide, normalised. Returns null for anything without a usable url. */
function normaliseSlide(raw) {
  if (!raw) return null
  const url = String(typeof raw === 'string' ? raw : raw.url || '').trim()
  if (!url) return null
  const type = (typeof raw === 'object' && raw.type === 'video') ? 'video' : 'image'
  const source = (typeof raw === 'object' && SOURCES.includes(raw.source)) ? raw.source : 'upload'
  const slide = { url, type, source }
  const versionId = typeof raw === 'object' ? String(raw.versionId || '').trim() : ''
  if (versionId) slide.versionId = versionId
  return slide
}

/**
 * The canonical, ordered slides for one idea.
 *
 * Reads `idea.slides` when the idea has them. Falls back to the legacy fields
 * otherwise — see the note above on why the fallback deliberately reproduces
 * the old Studio-render-wins behaviour rather than the new one.
 */
export function slidesFor(idea) {
  if (!idea) return []

  const explicit = Array.isArray(idea.slides) ? idea.slides.map(normaliseSlide).filter(Boolean) : []
  if (explicit.length) return explicit

  // ── Legacy ──
  const out = []
  const studio = String(idea.previewImageUrl || '').trim()
  const refs = (idea.references || []).map(u => String(u || '').trim()).filter(Boolean)

  if (studio) {
    out.push({ url: studio, type: 'image', source: 'studio' })
  } else if (idea.imageMode === 'use_reference') {
    for (const url of refs) out.push({ url, type: 'image', source: 'upload' })
  }

  const video = String(idea.previewVideoUrl || '').trim()
  if (video) out.push({ url: video, type: 'video', source: 'studio' })

  return out
}

/** Just the urls, in order — what most callers actually want. */
export const slideUrls = idea => slidesFor(idea).map(s => s.url)

/** Does this idea have anything to show yet? */
export const hasSlides = idea => slidesFor(idea).length > 0

/** True once at least one slide came from somewhere other than the Studio. */
export const hasOwnSlides = idea => slidesFor(idea).some(s => s.source !== 'studio')

/**
 * What to write back to the legacy columns whenever `slides` changes.
 *
 * The old columns are still read by the caption workflow, by screens that
 * were not touched by this change, and by every row written before it. Left
 * to drift they would describe a different post from the one the slides
 * describe — so they are not deprecated, they are DERIVED, and this is the
 * one place that derives them.
 *
 * `image_mode` follows the first slide because that is what the old readers
 * branch on: a post whose first slide is yours must not read as a Studio post
 * and send anyone back to a session that made something else.
 */
export function legacyFieldsFor(slides) {
  const list = (slides || []).map(normaliseSlide).filter(Boolean)
  const images = list.filter(s => s.type === 'image')
  const video = list.find(s => s.type === 'video')
  const firstIsStudio = images.length > 0 && images[0].source === 'studio'

  return {
    // Only a Studio image belongs in preview_image_url — it is the field the
    // Studio round trip writes and reads. An uploaded first slide leaves it
    // empty and travels in reference_image_urls instead.
    preview_image_url: firstIsStudio ? images[0].url : '',
    reference_image_urls: firstIsStudio ? images.slice(1).map(s => s.url) : images.map(s => s.url),
    preview_video_url: video ? video.url : '',
    image_mode: firstIsStudio ? 'studio' : images.length || video ? 'use_reference' : 'studio',
    media_type: !list.length ? 'image' : images.length ? 'image' : 'video',
    slide_count: Math.max(1, list.length),
  }
}

/** Append one slide, keeping order. Returns a new array. */
export function addSlide(slides, slide) {
  const next = normaliseSlide(slide)
  return next ? [...(slides || []), next] : [...(slides || [])]
}

/** Drop the slide at `index`. */
export function removeSlide(slides, index) {
  const list = [...(slides || [])]
  if (index < 0 || index >= list.length) return list
  list.splice(index, 1)
  return list
}

/** Move the slide at `from` to `to`, the way the slide strip's ‹ › do. */
export function moveSlide(slides, from, to) {
  const list = [...(slides || [])]
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const [picked] = list.splice(from, 1)
  list.splice(to, 0, picked)
  return list
}

/**
 * Fold a finished Studio render into an idea's slides.
 *
 * REPLACES the Studio slide it already had rather than appending, because
 * re-rendering is iteration on one picture, not a second picture. Appending
 * was the obvious thing and it is wrong: three passes in the Studio would
 * quietly turn a single-image post into a three-slide carousel of near
 * duplicates. Your own slides are never touched — which is the whole point
 * of this module.
 */
export function withStudioRender(slides, { url, versionId = '', type = 'image' } = {}) {
  const clean = String(url || '').trim()
  if (!clean) return [...(slides || [])]
  const list = (slides || []).map(normaliseSlide).filter(Boolean)
  const slide = normaliseSlide({ url: clean, type, source: 'studio', versionId })
  const at = list.findIndex(s => s.source === 'studio' && s.type === type)
  if (at === -1) return [...list, slide]
  const next = [...list]
  next[at] = slide
  return next
}
