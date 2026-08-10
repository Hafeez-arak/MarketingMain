import Konva from 'konva'

// ─── Photo adjustments ─────────────────────────────────────────────────────
// Konva's filter math, read straight from node_modules/konva/lib/filters/
// (Brighten.js, Contrast.js, HSL.js) rather than assumed:
//   · brightness: adds brightness()*255 to every RGB channel. 0 = no change;
//     the UI's -100..100 slider is stored /100 so it lands in Konva's own
//     -1..1 range (full black shift .. full white shift).
//   · contrast: adjust = ((contrast()+100)/100)^2, applied around the 0.5
//     midpoint. 0 = no change (adjust=1); -100 flattens to flat grey
//     (adjust=0). Fed the -100..100 slider value directly — it's already in
//     Konva's own units.
//   · saturation (HSL filter): multiplier is 2^saturation(). 0 = no change;
//     the UI's -100..100 slider is stored /50 so it lands in -2..2 (0.25x to
//     4x saturation), a wide but sane range.
export const ADJUST_RANGE = { brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100] }

export const ADJUST_KEYS = ['brightness', 'contrast', 'saturation']

export function hasAdjustments(adjust) {
  return !!adjust && ADJUST_KEYS.some(k => adjust[k])
}

export function applyAdjustments(node, adjust) {
  if (!node) return
  node.filters([Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL])
  node.brightness((adjust?.brightness || 0) / 100)
  node.contrast(adjust?.contrast || 0)
  node.saturation((adjust?.saturation || 0) / 50)
}

// ── Why the live Stage does not draw the native-resolution photo ───────────
// Konva applies pixel filters by caching a node to an offscreen canvas and
// running every filter over every pixel of it, synchronously, on the main
// thread — and it has to redo that whenever a filter value changes. A 4096²
// generation is 16.7M pixels: three filter passes over a ~67MB buffer, per
// pointer-move event, is a guaranteed stutter on the brightness slider.
//
// So the live Stage draws a downscaled copy instead. This is safe precisely
// BECAUSE all three filters are pointwise (each output pixel depends only on
// the input pixel at the same position) — resolution changes how many pixels
// are processed, never what any one of them becomes. The preview and the
// export therefore still agree; only the sampling does. The export path
// (render.js) keeps using the native canvas, so nothing shipped is downscaled.
//
// Capped by the longest edge rather than by area so that tall 4:5 and wide
// 16:9 documents both come out at a comparable on-screen sharpness.
export const PREVIEW_MAX_EDGE = 1600

export function makePreviewCanvas(sourceCanvas, maxEdge = PREVIEW_MAX_EDGE) {
  if (!sourceCanvas) return null
  const longest = Math.max(sourceCanvas.width, sourceCanvas.height)
  if (longest <= maxEdge) return sourceCanvas
  const ratio = maxEdge / longest
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sourceCanvas.width * ratio))
  out.height = Math.max(1, Math.round(sourceCanvas.height * ratio))
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height)
  return out
}
