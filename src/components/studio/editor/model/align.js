import { layerRect, unionRect, translatePatch } from './geometry'

// ─── Align, distribute, tidy up ────────────────────────────────────────────
// Canva's split, followed exactly: with ONE element selected the alignment
// reference is the page; with two or more it's the bounding box of the
// selection itself. Same six buttons either way, which is why the panel can
// show one control set and just change what it means.

export const ALIGN_MODES = ['left', 'center-h', 'right', 'top', 'center-v', 'bottom']

function targetFor(mode, ref, rect) {
  switch (mode) {
    case 'left':     return { left: ref.left }
    case 'center-h': return { left: ref.cx - rect.width / 2 }
    case 'right':    return { left: ref.right - rect.width }
    case 'top':      return { top: ref.top }
    case 'center-v': return { top: ref.cy - rect.height / 2 }
    case 'bottom':   return { top: ref.bottom - rect.height }
    default:         return {}
  }
}

// Returns { [id]: patch } so the caller can apply every move in a single
// document update — one undo step for the whole align, and no chance of a
// half-applied alignment if one layer type misbehaves.
export function alignPatches(doc, ids, mode) {
  const { width: W, height: H, layers } = doc
  const picked = layers.filter(l => ids.includes(l.id) && !l.locked)
  if (!picked.length) return {}

  const rects = picked.map(l => layerRect(l, W, H))
  // One selected → align to the page. Two or more → align to each other.
  const ref = picked.length === 1
    ? { left: 0, top: 0, right: W, bottom: H, cx: W / 2, cy: H / 2 }
    : unionRect(rects)

  const out = {}
  picked.forEach((l, i) => {
    const rect = rects[i]
    const t = targetFor(mode, ref, rect)
    const dx = t.left != null ? (t.left - rect.left) / W : 0
    const dy = t.top != null ? (t.top - rect.top) / H : 0
    if (dx || dy) out[l.id] = translatePatch(l, dx, dy)
  })
  return out
}

// Distribute: equalise the GAPS between neighbours, not their centres. Canva
// calls this "Tidy up", and equal gaps is what it actually produces — centre
// spacing looks wrong the moment two elements have different sizes.
// The outermost two stay put and define the span, so the operation is stable
// under repetition (running it twice changes nothing the second time).
export function distributePatches(doc, ids, axis) {
  const { width: W, height: H, layers } = doc
  const picked = layers.filter(l => ids.includes(l.id) && !l.locked)
  if (picked.length < 3) return {}

  const horizontal = axis === 'horizontal'
  const rows = picked
    .map(l => ({ layer: l, rect: layerRect(l, W, H) }))
    .sort((a, b) => (horizontal ? a.rect.left - b.rect.left : a.rect.top - b.rect.top))

  const first = rows[0].rect, last = rows[rows.length - 1].rect
  const span = horizontal ? last.right - first.left : last.bottom - first.top
  const totalSize = rows.reduce((sum, r) => sum + (horizontal ? r.rect.width : r.rect.height), 0)
  const gap = (span - totalSize) / (rows.length - 1)

  const out = {}
  let cursor = horizontal ? first.left : first.top
  rows.forEach(({ layer, rect }, i) => {
    if (i > 0 && i < rows.length - 1) {
      const dx = horizontal ? (cursor - rect.left) / W : 0
      const dy = horizontal ? 0 : (cursor - rect.top) / H
      if (dx || dy) out[layer.id] = translatePatch(layer, dx, dy)
    }
    cursor += (horizontal ? rect.width : rect.height) + gap
  })
  return out
}

// "Tidy up" with no axis given: pick whichever axis the selection is actually
// laid out along, so one button does the obvious thing for both a row and a
// column — which is how Canva's ⌥⇧T behaves.
export function tidyUpPatches(doc, ids) {
  const rects = doc.layers.filter(l => ids.includes(l.id)).map(l => layerRect(l, doc.width, doc.height))
  if (rects.length < 3) return {}
  const box = unionRect(rects)
  return distributePatches(doc, ids, box.width >= box.height ? 'horizontal' : 'vertical')
}
