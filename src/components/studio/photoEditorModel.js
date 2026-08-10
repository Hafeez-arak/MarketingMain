import Konva from 'konva'
import { layoutBox, drawBox, loadImage, newTextBox } from './overlayModel'

// ─── Photo editor: document model, layer factories, export ─────────────────
// The successor to the old text-only OverlayEditor. Same coordinate
// philosophy as overlayModel.js (every geometric value is a FRACTION of the
// current document, never a pixel — see that file's header) so a small
// on-screen preview and a native-resolution export always agree; the only
// thing that differs between them is the Konva Stage's own `scale`, not the
// numbers stored on any layer.
//
// A document is { width, height, layers, adjust }:
//  · width/height — the CURRENT native pixel size (changes on crop; rotate/
//    flip is intentionally only offered before any layer exists, so it never
//    has to remap one — see PhotoEditor.jsx's ROTATE_REQUIRES_EMPTY note).
//  · layers — z-ordered bottom-to-top, one of: 'text' | 'rect' | 'ellipse' |
//    'line' | 'arrow'. Every layer has {id, type, visible, locked, opacity}.
//  · adjust — { brightness, contrast, saturation }, applied to the base
//    photo only (Konva.Filters — see APPLY_FILTERS below for the exact,
//    source-verified value ranges; nothing here is guessed).

function id() { return `${Date.now()}${Math.random().toString(36).slice(2, 7)}` }

export function newTextLayer(overrides = {}) {
  return { ...newTextBox(), type: 'text', visible: true, locked: false, opacity: 1, ...overrides }
}

export function newShapeLayer(type, overrides = {}) {
  const base = {
    id: id(), type, x: 0.3, y: 0.3, w: 0.3, h: 0.2,
    fill: type === 'line' || type === 'arrow' ? '' : '#d4af37',
    stroke: '#1a1410', strokeWidth: 0.006,   // strokeWidth is a fraction of doc height, like text size
    cornerRadius: 0, rotation: 0, opacity: 1, visible: true, locked: false,
  }
  if (type === 'line' || type === 'arrow') {
    return { ...base, x1: 0.25, y1: 0.5, x2: 0.6, y2: 0.5, stroke: '#d4af37', strokeWidth: 0.01, ...overrides }
  }
  return { ...base, ...overrides }
}

// Old creative_versions.overlay_state rows only ever had { boxes, width,
// height } (plain text boxes, no `type` field, no shapes). Reopening one of
// those in the new editor must not lose the text — each box becomes a
// layer with type:'text'. Already-migrated documents pass straight through.
export function migrateDocument(state, fallbackW, fallbackH) {
  if (state && Array.isArray(state.layers)) {
    return {
      width: state.width || fallbackW, height: state.height || fallbackH,
      layers: state.layers.map(l => ({ ...l })),
      adjust: { brightness: 0, contrast: 0, saturation: 0, ...(state.adjust || {}) },
    }
  }
  if (state && Array.isArray(state.boxes)) {
    return {
      width: state.width || fallbackW, height: state.height || fallbackH,
      layers: state.boxes.map(b => newTextLayer({ ...b })),
      adjust: { brightness: 0, contrast: 0, saturation: 0 },
    }
  }
  return { width: fallbackW, height: fallbackH, layers: [], adjust: { brightness: 0, contrast: 0, saturation: 0 } }
}

// A text layer draws through the SAME layoutBox/drawBox as the old editor
// (Arabic shaping, wrapping, shadow — all of it), just onto a small local
// canvas instead of the full document, so it can be a normal Konva.Image
// node and get drag/resize/z-order for free. layoutBox only uses docW/docH
// to size the font and the wrap width, never the layer's own x/y, so drawing
// at a local (pad, pad) origin instead of the real position is safe — the
// Konva.Image node's own x/y (layer.x*docW - pad, ...) puts it back exactly
// where it belongs.
export function buildTextBitmap(layer, docW, docH) {
  const { lines, fontPx, lineHeightPx, boxW } = layoutBox(layer, docW, docH)
  const pad = Math.ceil(fontPx * 0.3) + 2
  const width = Math.max(1, Math.ceil(boxW) + pad * 2)
  const height = Math.max(1, Math.ceil(lines.length * lineHeightPx) + pad * 2)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  drawBox(ctx, { ...layer, x: pad / docW, y: pad / docH }, docW, docH)
  return { canvas, width, height, offsetX: pad, offsetY: pad }
}

// ── Crop ─────────────────────────────────────────────────────────────────

// `crop` is {x,y,w,h} in NATIVE PIXELS of the document being cropped, not
// fractions — it comes straight off the Konva crop-rect node's own geometry.
export function cropCanvas(sourceCanvas, crop) {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(crop.w))
  out.height = Math.max(1, Math.round(crop.h))
  out.getContext('2d').drawImage(sourceCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height)
  return out
}

// Every stored coordinate is a fraction of the OLD document; after a crop
// the same physical point is a different fraction of the NEW, smaller one.
// One conversion, shared by every layer type that carries x/y (all of them
// bar line/arrow, which carry x1/y1/x2/y2 instead).
function remapPoint(xFrac, yFrac, oldW, oldH, crop, newW, newH) {
  return {
    x: (xFrac * oldW - crop.x) / newW,
    y: (yFrac * oldH - crop.y) / newH,
  }
}

export function remapLayersAfterCrop(layers, oldW, oldH, crop, newW, newH) {
  return layers.map(l => {
    if (l.type === 'line' || l.type === 'arrow') {
      const p1 = remapPoint(l.x1, l.y1, oldW, oldH, crop, newW, newH)
      const p2 = remapPoint(l.x2, l.y2, oldW, oldH, crop, newW, newH)
      return { ...l, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
    }
    const p = remapPoint(l.x, l.y, oldW, oldH, crop, newW, newH)
    // Width/height are fractions of the SAME axis they were before — a
    // pure crop (no scale change) means the physical size in pixels is
    // unchanged, so only the denominator (old dim -> new dim) moves.
    const patch = { ...l, x: p.x, y: p.y }
    if (l.w != null) patch.w = (l.w * oldW) / newW
    if (l.h != null) patch.h = (l.h * oldH) / newH
    // Text size/lineHeight/strokeWidth are fractions of HEIGHT specifically
    // (see overlayModel.js's layoutBox) — same rule, height axis only.
    if (l.size != null) patch.size = (l.size * oldH) / newH
    if (l.strokeWidth != null) patch.strokeWidth = (l.strokeWidth * oldH) / newH
    return patch
  })
}

// ── Adjustments ─────────────────────────────────────────────────────────
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

export function applyAdjustments(node, adjust) {
  if (!node) return
  node.filters([Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL])
  node.brightness((adjust.brightness || 0) / 100)
  node.contrast(adjust.contrast || 0)
  node.saturation((adjust.saturation || 0) / 50)
}

// ── Shared node builders (used by both the live Stage and the headless
// export Stage, so preview and export can never visually drift — they're
// literally the same Konva node constructors fed the same layer values) ──

function addShapeNode(layer, W, H) {
  const common = {
    id: layer.id, opacity: layer.opacity ?? 1, rotation: layer.rotation || 0,
    listening: layer.visible !== false,
    visible: layer.visible !== false,
  }
  if (layer.type === 'rect') {
    return new Konva.Rect({
      ...common, x: layer.x * W, y: layer.y * H, width: layer.w * W, height: layer.h * H,
      fill: layer.fill || undefined, stroke: layer.stroke || undefined,
      strokeWidth: (layer.strokeWidth || 0) * H, cornerRadius: (layer.cornerRadius || 0) * H,
    })
  }
  if (layer.type === 'ellipse') {
    return new Konva.Ellipse({
      ...common, x: (layer.x + layer.w / 2) * W, y: (layer.y + layer.h / 2) * H,
      radiusX: (layer.w / 2) * W, radiusY: (layer.h / 2) * H,
      fill: layer.fill || undefined, stroke: layer.stroke || undefined, strokeWidth: (layer.strokeWidth || 0) * H,
    })
  }
  const points = [layer.x1 * W, layer.y1 * H, layer.x2 * W, layer.y2 * H]
  if (layer.type === 'arrow') {
    return new Konva.Arrow({
      ...common, points, stroke: layer.stroke || undefined, fill: layer.stroke || undefined,
      strokeWidth: (layer.strokeWidth || 0) * H, pointerLength: (layer.strokeWidth || 0.01) * H * 3,
      pointerWidth: (layer.strokeWidth || 0.01) * H * 3,
    })
  }
  return new Konva.Line({ ...common, points, stroke: layer.stroke || undefined, strokeWidth: (layer.strokeWidth || 0) * H })
}

// Renders the full document (base image + adjustments + every visible
// layer) to a native-resolution canvas — used for the flattened export.
// `textOnly` renders JUST the text layers on a transparent background,
// preserving the original OverlayEditor's second output: a layer that can
// later be composited over a finished video clip without a re-render.
export async function renderDocument(baseCanvas, doc, { textOnly = false } = {}) {
  const { width: W, height: H, layers, adjust } = doc
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  document.body.appendChild(container)
  try {
    const stage = new Konva.Stage({ container, width: W, height: H })
    const layer = new Konva.Layer()
    stage.add(layer)

    if (!textOnly) {
      const img = new Konva.Image({ image: baseCanvas, x: 0, y: 0, width: W, height: H, listening: false })
      layer.add(img)
      if (adjust && (adjust.brightness || adjust.contrast || adjust.saturation)) {
        img.cache()
        applyAdjustments(img, adjust)
      }
    }

    for (const l of layers) {
      if (l.visible === false) continue
      if (l.type === 'text') {
        const bmp = buildTextBitmap(l, W, H)
        layer.add(new Konva.Image({
          image: bmp.canvas, x: l.x * W - bmp.offsetX, y: l.y * H - bmp.offsetY,
          width: bmp.width, height: bmp.height, opacity: l.opacity ?? 1, listening: false,
        }))
      } else if (!textOnly) {
        layer.add(addShapeNode(l, W, H))
      }
    }

    layer.draw()
    const canvas = stage.toCanvas({ pixelRatio: 1 })
    stage.destroy()
    return canvas
  } finally {
    document.body.removeChild(container)
  }
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export produced no file.'))), type)
  })
}

// The one function PhotoEditor's Save button calls. baseCanvas is the
// current working image (already rotated/flipped/cropped, if any of those
// were used) — loaded once via loadBaseCanvas below and kept in the
// editor's own state.
export async function exportDocument(baseCanvas, doc) {
  const [composite, textLayer] = await Promise.all([
    renderDocument(baseCanvas, doc, { textOnly: false }),
    renderDocument(baseCanvas, doc, { textOnly: true }),
  ])
  const [compositeBlob, textLayerBlob] = await Promise.all([canvasToBlob(composite), canvasToBlob(textLayer)])
  return { compositeBlob, textLayerBlob, width: doc.width, height: doc.height }
}

// Loads the source image into a canvas at its native resolution — the
// working copy that rotate/flip/crop mutate in place, and that renderDocument
// reads from. Re-exported here (rather than used inline) so PhotoEditor
// doesn't need its own image-loading logic.
export async function loadBaseCanvas(imageUrl) {
  const img = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d').drawImage(img, 0, 0)
  return canvas
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
