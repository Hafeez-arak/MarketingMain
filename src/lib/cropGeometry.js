// ─── The pan/zoom arithmetic behind a crop frame ───────────────────────────
//
// Pure, so it can be asserted in a test rather than only observed in a modal.
// Nothing here touches the DOM or a canvas — imageRender.js does the drawing;
// this decides what it draws. Separate from lib/imageFit.js on purpose: that
// module is about Instagram's automatic padding (what happens to a picture
// nobody touched), and this is about a picture somebody chose to reframe by
// hand. The two never need to agree with each other, only with themselves.

/** '4:5' → 0.8. Null for anything that is not two positive numbers. */
export function parseRatio(label) {
  const m = /^\s*([\d.]+)\s*:\s*([\d.]+)\s*$/.exec(String(label || ''))
  if (!m) return null
  const w = Number(m[1]); const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return null
  return w / h
}

/** width ÷ height, or null when either is missing — an unknown, not a 0. */
export function aspectOf(width, height) {
  const w = Number(width); const h = Number(height)
  if (!(w > 0) || !(h > 0)) return null
  return w / h
}

/** The offered shape closest to what the image already is — the default chip. */
export function nearestRatio(ratio, labels = []) {
  if (!labels.length) return ''
  if (ratio == null) return labels[0]
  return labels.reduce((best, label) => {
    const d = Math.abs(Math.log(parseRatio(label) / ratio))
    return d < best.d ? { label, d } : best
  }, { label: labels[0], d: Infinity }).label
}

// ── Pan and zoom, the avatar-cropper way ──────────────────────────────────
//
// The frame is fixed; the image moves behind it. `scale` is image pixels →
// frame pixels, and (offsetX, offsetY) is the image's top-left corner relative
// to the frame's. Everything below is in frame units, so the same numbers
// drive the on-screen preview and the canvas render at output resolution —
// one arithmetic, not a preview that lies about what gets saved.

/** The smallest scale at which the image still covers the frame with no gap. */
export function coverScale({ imgW, imgH, frameW, frameH }) {
  if (!(imgW > 0) || !(imgH > 0) || !(frameW > 0) || !(frameH > 0)) return 1
  return Math.max(frameW / imgW, frameH / imgH)
}

/** The largest scale at which the whole image is inside the frame. */
export function containScale({ imgW, imgH, frameW, frameH }) {
  if (!(imgW > 0) || !(imgH > 0) || !(frameW > 0) || !(frameH > 0)) return 1
  return Math.min(frameW / imgW, frameH / imgH)
}

// Centred at the given scale — where a freshly opened image sits.
export function centreOffset({ imgW, imgH, frameW, frameH, scale }) {
  return {
    offsetX: (frameW - imgW * scale) / 2,
    offsetY: (frameH - imgH * scale) / 2,
  }
}

// The rule that makes dragging feel right: the image may never pull away from
// an edge and leave a hole. One expression covers both modes because the sign
// of the slack says which one we are in — when the image is larger than the
// frame the span is negative and the offset is trapped between "far edge
// flush" and "near edge flush"; when it is smaller (padding, the point of
// `fit`) the span is positive and the same two numbers keep it inside.
export function clampOffset({ imgW, imgH, frameW, frameH, scale, offsetX, offsetY }) {
  const spanX = frameW - imgW * scale
  const spanY = frameH - imgH * scale
  return {
    offsetX: Math.min(Math.max(spanX, 0), Math.max(Math.min(spanX, 0), offsetX)),
    offsetY: Math.min(Math.max(spanY, 0), Math.max(Math.min(spanY, 0), offsetY)),
  }
}

// ── What gets written ─────────────────────────────────────────────────────
//
// 1080 is Instagram's feed width; a 4:5 render lands at 1080 × 1350 and a
// story at 1080 × 1920, which is exactly what the app serves. The long edge is
// capped so a very tall custom ratio cannot produce a canvas so large that the
// browser quietly fails to allocate it — a blank image being worse than a
// slightly smaller one.
//
// ── WHY THE ROUNDING HAS A DIRECTION ──
//
// 1.91 is a rounded decimal of a ratio that is really 1.91:1, and no integer
// height divides 1080 into exactly that. Rounding one way over the other has
// no correctness stake here (nothing downstream refuses a shape any more —
// see lib/imageFit.js's own padding pass), but a consistent direction keeps
// repeated renders of the same ratio byte-identical in size. Height rounds
// toward the square: UP for a landscape target, DOWN for a portrait one.
export function outputSize(ratio, { baseWidth = 1080, maxEdge = 1920 } = {}) {
  if (!(ratio > 0)) return { width: baseWidth, height: baseWidth }
  const toSquare = ratio > 1 ? Math.ceil : Math.floor
  let width = baseWidth
  let height = Math.max(1, toSquare(baseWidth / ratio))
  const longest = Math.max(width, height)
  if (longest > maxEdge) {
    const k = maxEdge / longest
    width = Math.max(1, Math.round(width * k))
    height = Math.max(1, toSquare(width / ratio))
  }
  return { width, height }
}

/**
 * The transform, restated at output resolution. One multiplication, kept here
 * so the component never re-derives it and the two can never disagree about
 * where the picture sits.
 */
export function drawRect({ imgW, imgH, frameW, scale, offsetX, offsetY, outWidth }) {
  const k = outWidth / frameW
  return {
    x: offsetX * k,
    y: offsetY * k,
    width: imgW * scale * k,
    height: imgH * scale * k,
  }
}
