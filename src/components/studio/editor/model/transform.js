import { loadImage } from '../../overlayModel'
import { buildTextBitmap } from './textBitmap'
import { isPath, normalizeCrop, docSize } from './document'

// ─── Whole-photo transforms: load, crop, rotate, flip ──────────────────────

// Loads the source image into a canvas at its native resolution. This canvas
// is the UNCROPPED, unadjusted original and stays that way for the life of the
// session — crop and adjustments are document state applied at draw time (see
// document.js), so the only things that ever rewrite these pixels are the two
// lossless 90°/mirror operations at the bottom of this file.
export async function loadBaseCanvas(imageUrl) {
  const img = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d').drawImage(img, 0, 0)
  return canvas
}

// ── Crop ───────────────────────────────────────────────────────────────────
// Changing the crop moves the page's frame over a fixed photo. Everything
// sitting on that page should stay where it is RELATIVE TO THE PHOTO — pull
// the left edge in and a caption keeps covering the same part of the image —
// so every layer's fractions are re-expressed against the new frame.
//
// Both crops are fractions of the same base image, which is what makes this a
// pure function of the two rects: no canvas, no pixels, and exactly reversible,
// so widening a crop puts everything back where it was before it was narrowed.
export function remapLayersForCrop(layers, baseW, baseH, oldCrop, newCrop) {
  const from = normalizeCrop(oldCrop)
  const to = normalizeCrop(newCrop)
  if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return layers

  const oldSize = docSize(baseW, baseH, from)
  const newSize = docSize(baseW, baseH, to)
  // Where the new frame's origin sits inside the old frame, in old-doc pixels.
  const offsetX = ((to.x - from.x) * baseW)
  const offsetY = ((to.y - from.y) * baseH)

  const point = (xf, yf) => ({
    x: (xf * oldSize.width - offsetX) / newSize.width,
    y: (yf * oldSize.height - offsetY) / newSize.height,
  })
  // A pure crop never changes anything's physical pixel size, so a size
  // fraction only changes denominator: old dimension over new.
  const sx = oldSize.width / newSize.width
  const sy = oldSize.height / newSize.height

  return layers.map(l => {
    if (isPath(l)) {
      const a = point(l.x1, l.y1), b = point(l.x2, l.y2)
      const patch = { ...l, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
      if (l.strokeWidth != null) patch.strokeWidth = l.strokeWidth * sy
      return patch
    }
    const p = point(l.x, l.y)
    const patch = { ...l, x: p.x, y: p.y }
    if (l.w != null) patch.w = l.w * sx
    if (l.h != null) patch.h = l.h * sy
    // Text size, stroke width and corner radius are fractions of HEIGHT
    // specifically (see overlayModel.js's layoutBox) — same rule, height axis.
    if (l.size != null) patch.size = l.size * sy
    if (l.strokeWidth != null) patch.strokeWidth = l.strokeWidth * sy
    if (l.cornerRadius != null) patch.cornerRadius = l.cornerRadius * sy
    return patch
  })
}

// ── Rotate and flip ────────────────────────────────────────────────────────
// These DO rewrite the base pixels, because a 90° turn and a mirror are both
// lossless and because keeping them as state would mean carrying an
// orientation through every coordinate conversion in the editor for no gain.
//
// They used to be gated to a document with no layers on it, with the note that
// remapping a turn across live text and shapes was "real geometry". It is, and
// it's below. The trick that makes it tractable is to transform each layer's
// PIVOT — the point Konva actually rotates that node type around — and add 90°
// to the layer's own rotation, rather than trying to transform a bounding box.
// Done that way it is exact for a layer that was already rotated, which the
// bounding-box approach is not.

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

// The crop frame turns with the photo, so whatever was framed stays framed.
// Derived the same way as a layer: map the rect's corners through the rotation
// and read the new min/extent off them.
export function rotateCrop(crop, clockwise) {
  const c = normalizeCrop(crop)
  return clockwise
    ? { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w }
    : { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w }
}

export function flipCrop(crop, axis) {
  const c = normalizeCrop(crop)
  return axis === 'horizontal'
    ? { ...c, x: 1 - c.x - c.w }
    : { ...c, y: 1 - c.y - c.h }
}

// Kept in (-180, 180], which is the range the Position panel's rotation field
// offers. Without this, turning the page four times leaves every layer on
// rotation: 360 — visually identical, but out of range in the one place you
// can type a rotation, and it keeps climbing with every further turn.
function normalizeAngle(deg) {
  return ((((deg % 360) + 540) % 360) - 180) || 0
}

// The point Konva rotates each node type around, in document pixels. Rect,
// image and text all pivot on their top-left; an ellipse pivots on its centre,
// because that's where Konva's Ellipse puts its x/y. A text layer's stored x/y
// is its TEXT origin, which sits inside the bitmap's padding, so the node's
// own position is that minus the offset.
function pivotPx(layer, W, H) {
  if (layer.type === 'text') {
    const bmp = buildTextBitmap(layer, W, H)
    return { x: layer.x * W - bmp.offsetX, y: layer.y * H - bmp.offsetY, offsetX: bmp.offsetX, offsetY: bmp.offsetY }
  }
  if (layer.type === 'ellipse') {
    return { x: (layer.x + layer.w / 2) * W, y: (layer.y + layer.h / 2) * H }
  }
  return { x: layer.x * W, y: layer.y * H }
}

// Rotate the whole page by 90°. W/H are the OLD document size; the new one has
// them swapped, which is what every scale factor below is derived from.
export function rotateLayers90(layers, W, H, clockwise) {
  const W2 = H, H2 = W
  // Every stored fraction keeps its PIXEL value across the turn and only gets
  // a new denominator, so each one is re-derived as (fraction × old dimension)
  // ÷ new dimension rather than multiplied by a precomputed ratio. Two
  // roundings instead of three, which matters because these values are turned
  // back into pixels and then rounded — see ceilPx in overlayModel.js for what
  // a single ulp of drift costs there.
  const reFrac = (frac, oldDim, newDim) => (frac * oldDim) / newDim

  const mapPoint = (px, py) => (clockwise
    ? { x: H - py, y: px }
    : { x: py, y: W - px })

  return layers.map(l => {
    if (isPath(l)) {
      const a = mapPoint(l.x1 * W, l.y1 * H)
      const b = mapPoint(l.x2 * W, l.y2 * H)
      return {
        ...l,
        x1: a.x / W2, y1: a.y / H2, x2: b.x / W2, y2: b.y / H2,
        strokeWidth: l.strokeWidth != null ? reFrac(l.strokeWidth, H, H2) : l.strokeWidth,
      }
    }

    const pivot = pivotPx(l, W, H)
    const moved = mapPoint(pivot.x, pivot.y)
    const patch = { ...l, rotation: normalizeAngle((l.rotation || 0) + (clockwise ? 90 : -90)) }

    // A box's physical pixel width and height are unchanged — it turned with
    // the page as a rigid body and its own `rotation` absorbed the 90°.
    if (l.w != null) patch.w = reFrac(l.w, W, W2)
    if (l.h != null) patch.h = reFrac(l.h, H, H2)
    if (l.size != null) patch.size = reFrac(l.size, H, H2)
    if (l.strokeWidth != null) patch.strokeWidth = reFrac(l.strokeWidth, H, H2)
    if (l.cornerRadius != null) patch.cornerRadius = reFrac(l.cornerRadius, H, H2)

    if (l.type === 'text') {
      // Back from the node position to the stored text origin, using the
      // offsets of the bitmap as it will be AFTER the turn — not the one from
      // before it. The two are nearly identical (the turn leaves size*H and
      // w*W unchanged, so the raster is the same pixels) but buildTextBitmap
      // rounds its padding to whole pixels, and reusing the old offsets let
      // that rounding difference through as about half a pixel of drift per
      // turn, which visibly accumulated: four turns moved a caption 2px.
      // The bitmap cache is keyed on exactly these values, so asking for it
      // here costs a lookup rather than a rasterise.
      const next = buildTextBitmap({ ...l, ...patch }, W2, H2)
      patch.x = (moved.x + next.offsetX) / W2
      patch.y = (moved.y + next.offsetY) / H2
    } else if (l.type === 'ellipse') {
      patch.x = moved.x / W2 - patch.w / 2
      patch.y = moved.y / H2 - patch.h / 2
    } else {
      patch.x = moved.x / W2
      patch.y = moved.y / H2
    }
    return patch
  })
}
