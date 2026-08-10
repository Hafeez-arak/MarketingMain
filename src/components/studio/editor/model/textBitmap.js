import { layoutBox, drawBox, textPadding } from '../../overlayModel'

// ─── Text → bitmap, memoised ───────────────────────────────────────────────
// A text layer draws through the SAME layoutBox/drawBox as the rest of the
// app (Arabic shaping, wrapping, shadow — all of it), just onto a small local
// canvas instead of the full document, so it can be a normal Konva.Image node
// and get drag/resize/z-order for free. layoutBox only uses docW/docH to size
// the font and the wrap width, never the layer's own x/y, so drawing at a
// local (pad, pad) origin is safe — the Konva.Image node's own x/y
// (layer.x*docW - pad, …) puts it back exactly where it belongs.
//
// WHY THE CACHE: rasterising is not cheap (a full canvas allocation plus a
// text layout plus fillText per line, at document resolution), and the same
// bitmap is wanted from three places at once — the Konva node, the inline
// editor's overlay geometry, and layerBoundsPx (which the floating toolbar,
// the snapping targets and the align maths all read). Before this cache a
// single keystroke while editing text triggered three independent
// rasterisations at native resolution. Now the first caller pays and the rest
// are a Map lookup.
//
// Keyed on everything drawBox actually reads plus the document size, so a
// crop or a font change invalidates correctly and nothing else does. Bounded
// and LRU-ordered because these canvases are large: a Map preserves insertion
// order, so re-inserting on hit moves an entry to the end and the oldest key
// is always the first one the iterator yields.

const CACHE_LIMIT = 24
const cache = new Map()

// `epoch` is bumped by the editor when a webfont finishes loading. It carries
// no information about the layer — it exists so bitmaps drawn in a fallback
// face (most visibly: Arabic rendered unshaped) are invalidated the moment
// the real face arrives, without every caller needing to know fonts are why.
export function textSignature(layer, W, H, epoch = 0) {
  return [
    layer.text, layer.family, layer.weight, layer.size, layer.w, layer.color,
    layer.align, layer.dir, layer.lineHeight, layer.shadow ? 1 : 0,
    layer.tracking, layer.italic ? 1 : 0, layer.underline ? 1 : 0, layer.strike ? 1 : 0,
    layer.uppercase ? 1 : 0, layer.anchor, layer.effect, layer.effectColor,
    layer.effectIntensity, layer.bgColor, W, H, epoch,
  ].join('')
}

export function buildTextBitmap(layer, W, H, epoch = 0) {
  const key = textSignature(layer, W, H, epoch)
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key); cache.set(key, hit)   // LRU touch
    return hit
  }

  const { fontPx, boxW, blockH } = layoutBox(layer, W, H)
  // Padding absorbs the drop shadow's blur and offset, whatever the active
  // effect draws outside the glyphs (a neon glow, an echo's offset copies),
  // the highlight box, and the overhang of glyphs that draw beyond their own
  // advance width — so nothing is clipped by the edge of the local canvas.
  const pad = textPadding(layer, fontPx)
  const width = Math.max(1, Math.ceil(boxW) + pad * 2)
  const height = Math.max(1, Math.ceil(blockH) + pad * 2)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  drawBox(canvas.getContext('2d'), { ...layer, x: pad / W, y: pad / H }, W, H)

  // The vertical anchor lives HERE rather than in drawBox, as a shift in the
  // bitmap's offset. drawBox always draws a block from its top; the anchor
  // only changes which edge of that block sits at the layer's y. Folding it
  // into offsetY means the Konva node, the layer bounds, the export and the
  // inline editor all pick it up from the one place they already read the
  // offset from, and none of them needs to know the anchor exists.
  const anchorShift = layer.anchor === 'middle' ? blockH / 2 : layer.anchor === 'bottom' ? blockH : 0

  const out = { canvas, width, height, offsetX: pad, offsetY: pad + anchorShift, blockH }
  cache.set(key, out)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
  return out
}

// Fonts load asynchronously and canvas draws with whatever is resolved at the
// moment fillText runs (see fonts.js). Any bitmap rasterised before a face
// arrived is wrong, so the cache has to be dropped when one does.
export function clearTextBitmapCache() {
  cache.clear()
}
