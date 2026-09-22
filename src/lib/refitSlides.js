import { autoFit } from './imageRender'
import { uploadToMediaLibrary } from './mediaLibrary'

// ─── Putting every slide in one shape ──────────────────────────────────────
//
// Instagram crops a carousel to the FIRST slide's shape, so a mixed set loses
// edges silently — nothing warns, the post simply goes out with two of its
// pictures trimmed. When the fitter is asked to apply its shape to the rest,
// each other slide is re-rendered centred and covering, which is the least
// opinionated placement available without asking; any of them can still be
// opened and adjusted by hand afterwards.
//
// ── WHY THIS IS NOT A METHOD ON THE COMPOSER ──
//
// It lived inside PostComposer until the planner grew its own "adjust" button
// on a carousel slide. The fitter shows its "apply to every slide" checkbox
// whenever `total > 1`, which is ALWAYS true of a strip the planner draws — so
// the second caller either shared this or shipped a checkbox that quietly did
// nothing. A tickbox that does nothing is the worst of the three options: it
// is indistinguishable from one that worked and found nothing to change.
//
// Kept free of React on purpose. The two callers hold their media differently
// — the composer in `state.media`, the planner in an idea's `slides` row — and
// the only thing they genuinely share is "re-render these, upload them, hand
// me back the list". So this takes a list and returns a list.

/**
 * Re-render every slide but one into `ratioLabel`, and upload each result.
 *
 * @param {Array}  media        the list to work from, INCLUDING the already
 *                              adjusted slide at `keepIndex`
 * @param {number} keepIndex    the slide the user adjusted by hand — left alone
 * @param {string} ratioLabel   e.g. '4:5'
 * @param {string} mode         'fill' (crop) or 'fit' (pad)
 * @param {object} ctx          { workspaceId, accessToken, platform }
 * @returns {Promise<Array>}    a new list, same length and order
 *
 * Takes the list to work from rather than reading it back out of a store,
 * because it runs AFTER the adjusted slide has been put into that store.
 * Re-reading here would see the array as it was BEFORE the adjustment — every
 * upload below takes a second or two — and the wholesale write at the end
 * would then put the un-adjusted picture back, silently undoing the edit that
 * started the whole thing.
 */
export async function refitSlides(media, keepIndex, ratioLabel, mode, {
  workspaceId, accessToken, platform = '',
} = {}) {
  return Promise.all((media || []).map(async (m, i) => {
    // `!== 'image'` rather than `=== 'video'`: a slide whose type nobody set
    // is left alone. Re-rendering an unknown is how a video gets fed to a
    // canvas that will only ever throw on it.
    if (i === keepIndex || !m || m.type !== 'image') return m
    try {
      const { blob, width, height } = await autoFit(m.url, ratioLabel, { mode })
      const base = (m.name || 'image').replace(/\.[a-z0-9]+$/i, '')
      const file = new File([blob], `${base}-${ratioLabel.replace(':', 'x')}.jpg`, { type: 'image/jpeg' })
      const res = await uploadToMediaLibrary(workspaceId, accessToken, file, {
        source: 'adjusted', tags: ['adjusted', platform, ratioLabel].filter(Boolean),
      })
      // A slide that could not be re-rendered is left EXACTLY as it was. Half
      // a carousel in one shape and half in another is worse than the mixture
      // the user already had, and nothing here can name which half failed.
      if (res.error || !res.asset?.url) return m
      return { ...m, url: res.asset.url, name: file.name, mimeType: 'image/jpeg', bytes: blob.size, width, height }
    } catch { return m }
  }))
}
