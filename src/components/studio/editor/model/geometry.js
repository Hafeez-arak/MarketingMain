import { buildTextBitmap } from './textBitmap'
import { isPath } from './document'

// ─── Layer geometry, in LOCAL (unscaled) document pixels ───────────────────
// One source of truth for "what box is this layer in", shared by the on-canvas
// Transformer, the floating toolbar's screen placement, the align/distribute
// maths and the snapping targets — so none of them can disagree about where a
// layer actually is.

// The layer's own unrotated box, plus which corner Konva pivots rotation
// around for that node type (top-left for Rect/Image, centre for Ellipse,
// since that's where each Konva shape's x/y sits).
export function layerBoundsPx(layer, W, H) {
  if (layer.type === 'text') {
    const bmp = buildTextBitmap(layer, W, H)
    return {
      x: layer.x * W - bmp.offsetX, y: layer.y * H - bmp.offsetY,
      width: bmp.width, height: bmp.height, pivot: 'top-left',
    }
  }
  if (isPath(layer)) {
    const xs = [layer.x1 * W, layer.x2 * W], ys = [layer.y1 * H, layer.y2 * H]
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.abs(xs[1] - xs[0]), height: Math.abs(ys[1] - ys[0]), pivot: 'top-left',
    }
  }
  if (layer.type === 'ellipse') {
    return { x: layer.x * W, y: layer.y * H, width: layer.w * W, height: layer.h * H, pivot: 'center' }
  }
  // Polygons and stars are a closed path whose points are laid out from the
  // box origin (see shapePoints), so their pivot is the top-left like a rect's
  // — not the centre, even though the shape looks radial.
  return { x: layer.x * W, y: layer.y * H, width: layer.w * W, height: layer.h * H, pivot: 'top-left' }
}

// Axis-aligned bounding box of a (possibly rotated) layer box — what "where
// should the toolbar sit", "what edge should this snap to" and "what does
// align left mean" all actually need, since a rotated shape's topmost point
// isn't just its unrotated y any more.
export function rotatedAABB({ x, y, width, height, pivot = 'top-left' }, rotationDeg = 0) {
  if (!rotationDeg) return { x, y, width, height }
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const [px, py] = pivot === 'center' ? [x + width / 2, y + height / 2] : [x, y]
  const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([cx, cy]) => {
    const dx = cx - px, dy = cy - py
    return [px + dx * cos - dy * sin, py + dx * sin + dy * cos]
  })
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1])
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

// The one call every consumer above should make: the on-screen rectangle a
// layer occupies, rotation included, with the edges/centres precomputed.
export function layerRect(layer, W, H) {
  const box = rotatedAABB(layerBoundsPx(layer, W, H), layer.rotation || 0)
  return {
    id: layer.id,
    left: box.x, top: box.y,
    right: box.x + box.width, bottom: box.y + box.height,
    width: box.width, height: box.height,
    cx: box.x + box.width / 2, cy: box.y + box.height / 2,
  }
}

export function unionRect(rects) {
  if (!rects.length) return null
  const left = Math.min(...rects.map(r => r.left))
  const top = Math.min(...rects.map(r => r.top))
  const right = Math.max(...rects.map(r => r.right))
  const bottom = Math.max(...rects.map(r => r.bottom))
  return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 }
}

// Move a layer by a delta expressed in FRACTIONS. Type-agnostic on purpose:
// align, distribute, nudge, multi-drag and paste-offset all reduce to this,
// so none of them need to know that lines carry x1/y1/x2/y2 instead of x/y.
export function translatePatch(layer, dxFrac, dyFrac) {
  if (isPath(layer)) {
    return {
      x1: layer.x1 + dxFrac, y1: layer.y1 + dyFrac,
      x2: layer.x2 + dxFrac, y2: layer.y2 + dyFrac,
    }
  }
  return { x: layer.x + dxFrac, y: layer.y + dyFrac }
}

// Place a layer so its visual bounding box lands at a given pixel position.
// Expressed as a translation rather than by assigning x/y directly because a
// text layer's stored x is its TEXT origin, not the left edge of its bitmap
// (they differ by the shadow padding), and an ellipse's is its box corner
// while Konva draws it from the centre. Going through the delta means neither
// of those has to be re-derived here.
export function moveToPatch(layer, W, H, targetLeftPx, targetTopPx) {
  const r = layerRect(layer, W, H)
  return translatePatch(layer, (targetLeftPx - r.left) / W, (targetTopPx - r.top) / H)
}
