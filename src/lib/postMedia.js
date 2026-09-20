// ─── What a post has to look at ────────────────────────────────────────────
//
// Zernio carries `mediaItems` — one `{ type, url, thumbnail }` per slide —
// alongside a single `thumbnailUrl`. For a carousel the thumbnail is only the
// FIRST frame, so opening it alone would answer "which post is this" a second
// time instead of "what was in it".

/**
 * Every slide worth showing, thumbnail-only posts included.
 *
 * A post with no `mediaItems` still has a picture worth enlarging — for a
 * single-image post the thumbnail IS the image — so it becomes a one-item
 * carousel rather than nothing to click. A post with neither returns an empty
 * list, and the caller shows a plain, unclickable placeholder instead of a
 * zoom affordance that opens onto nothing.
 *
 * @param {object} post A Zernio analytics post.
 * @returns {Array<{type: string, url?: string, thumbnail?: string}>}
 */
export function mediaItemsOf(post) {
  const items = Array.isArray(post?.mediaItems)
    ? post.mediaItems.filter(m => m?.url || m?.thumbnail)
    : []
  if (items.length) return items
  return post?.thumbnailUrl ? [{ type: 'image', url: post.thumbnailUrl }] : []
}
