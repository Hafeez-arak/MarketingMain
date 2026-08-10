import { layerRect } from './geometry'

// ─── Smart guides ──────────────────────────────────────────────────────────
// Canva's pink guide lines: while you drag, the element's left/centre/right
// edges look for the page's left/centre/right and for every other element's,
// and jump the last few pixels when they get close. Same for the vertical
// axis. That "jump" is the entire reason a Canva design looks aligned even
// when nobody used the align buttons, so it's the highest-value item in the
// whole parity list per line of code.
//
// The threshold is expressed in SCREEN pixels by the caller (divided by the
// current zoom before it gets here) — snapping has to feel the same when
// you're zoomed to 25% as at 400%, and a fixed document-pixel threshold
// would be unusably sticky at one end and useless at the other.

export const SNAP_SCREEN_PX = 6
export const ROTATION_STEP = 15
export const ROTATION_SNAP_DEG = 7

// Every line worth snapping to: the page's own thirds-of-interest, plus each
// unselected, visible layer's edges and centre. Locked layers are included on
// purpose — you can't move them, but they're exactly the kind of fixed
// furniture you want to line something else up against.
export function buildSnapTargets(doc, excludeIds = []) {
  const { width: W, height: H } = doc
  const skip = new Set(excludeIds)
  const v = [0, W / 2, W]
  const h = [0, H / 2, H]
  for (const l of doc.layers) {
    if (skip.has(l.id) || l.visible === false) continue
    const r = layerRect(l, W, H)
    v.push(r.left, r.cx, r.right)
    h.push(r.top, r.cy, r.bottom)
  }
  return { v, h }
}

function nearest(edges, targets, threshold) {
  let best = null
  for (const [, value] of edges) {
    for (const t of targets) {
      const delta = t - value
      const distance = Math.abs(delta)
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { delta, distance, line: t }
      }
    }
  }
  return best
}

// Given where a drag WOULD land, return the correction that makes it snap and
// the guide lines to draw for it. Never returns a correction on an axis that
// found nothing, so a free drag stays free on that axis.
export function computeSnap(rect, targets, threshold) {
  const vHit = nearest([['left', rect.left], ['cx', rect.cx], ['right', rect.right]], targets.v, threshold)
  const hHit = nearest([['top', rect.top], ['cy', rect.cy], ['bottom', rect.bottom]], targets.h, threshold)
  const guides = []
  if (vHit) guides.push({ orientation: 'v', pos: vHit.line })
  if (hHit) guides.push({ orientation: 'h', pos: hHit.line })
  return { dx: vHit ? vHit.delta : 0, dy: hHit ? hHit.delta : 0, guides }
}

// Rotation snaps to 15° the way Canva's does. Separate from the edge snapping
// above because it has no guide lines and no zoom dependence — degrees are
// degrees at any scale.
export function snapRotation(deg, threshold = ROTATION_SNAP_DEG) {
  const step = Math.round(deg / ROTATION_STEP) * ROTATION_STEP
  return Math.abs(deg - step) <= threshold ? step : deg
}

// Shift-drag constrains to whichever axis has moved further, which is what
// every design tool does and what muscle memory expects.
export function constrainAxis(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy }
}
