import { loadImage } from '../../overlayModel'
import { isPath } from './document'

// ─── Whole-photo transforms: load, crop, rotate, flip ──────────────────────

// Loads the source image into a canvas at its native resolution — the working
// copy that rotate/flip/crop mutate, and that the export reads from.
export async function loadBaseCanvas(imageUrl) {
  const img = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d').drawImage(img, 0, 0)
  return canvas
}

// `crop` is {x,y,w,h} in NATIVE PIXELS of the document being cropped, not
// fractions — it comes straight off the Konva crop-rect node's own geometry.
export function cropCanvas(sourceCanvas, crop) {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(crop.w))
  out.height = Math.max(1, Math.round(crop.h))
  out.getContext('2d').drawImage(sourceCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height)
  return out
}

// Every stored coordinate is a fraction of the OLD document; after a crop the
// same physical point is a different fraction of the NEW, smaller one. One
// conversion, shared by every layer type that carries x/y (all of them bar
// line/arrow, which carry x1/y1/x2/y2 instead).
function remapPoint(xFrac, yFrac, oldW, oldH, crop, newW, newH) {
  return { x: (xFrac * oldW - crop.x) / newW, y: (yFrac * oldH - crop.y) / newH }
}

export function remapLayersAfterCrop(layers, oldW, oldH, crop, newW, newH) {
  return layers.map(l => {
    if (isPath(l)) {
      const p1 = remapPoint(l.x1, l.y1, oldW, oldH, crop, newW, newH)
      const p2 = remapPoint(l.x2, l.y2, oldW, oldH, crop, newW, newH)
      return { ...l, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
    }
    const p = remapPoint(l.x, l.y, oldW, oldH, crop, newW, newH)
    // Width/height are fractions of the SAME axis they were before — a pure
    // crop (no scale change) means the physical size in pixels is unchanged,
    // so only the denominator (old dim -> new dim) moves.
    const patch = { ...l, x: p.x, y: p.y }
    if (l.w != null) patch.w = (l.w * oldW) / newW
    if (l.h != null) patch.h = (l.h * oldH) / newH
    // Text size/lineHeight/strokeWidth are fractions of HEIGHT specifically
    // (see overlayModel.js's layoutBox) — same rule, height axis only.
    if (l.size != null) patch.size = (l.size * oldH) / newH
    if (l.strokeWidth != null) patch.strokeWidth = (l.strokeWidth * oldH) / newH
    if (l.cornerRadius != null) patch.cornerRadius = (l.cornerRadius * oldH) / newH
    return patch
  })
}

export function rotateCanvas90(canvas, clockwise = true) {
  const out = document.createElement('canvas')
  out.width = canvas.height; out.height = canvas.width
  const ctx = out.getContext('2d')
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return out
}

export function flipCanvas(canvas, axis = 'horizontal') {
  const out = document.createElement('canvas')
  out.width = canvas.width; out.height = canvas.height
  const ctx = out.getContext('2d')
  if (axis === 'horizontal') { ctx.translate(out.width, 0); ctx.scale(-1, 1) }
  else { ctx.translate(0, out.height); ctx.scale(1, -1) }
  ctx.drawImage(canvas, 0, 0)
  return out
}
