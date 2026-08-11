import Konva from 'konva'
import { buildTextBitmap } from './textBitmap'
import { applyAdjustments, hasAdjustments } from './adjust'
import { ensureLayerImages, getCachedImage } from './imageCache'
import { cropPx, dashFor, docSize, isPoly, layerTiming, shapePoints, timingKey } from './document'

// ─── Headless render + export ──────────────────────────────────────────────
// Renders the full document (base image + adjustments + every visible layer)
// to a native-resolution canvas. The live Stage builds its nodes from
// react-konva components rather than these constructors, but both are fed the
// SAME layer values through the same fraction→pixel arithmetic, and text goes
// through the same buildTextBitmap — so what the marketer approves on screen
// is what comes out of the export.

export function buildLayerNode(layer, W, H) {
  const common = {
    id: layer.id, opacity: layer.opacity ?? 1, rotation: layer.rotation || 0,
    listening: false, visible: layer.visible !== false,
  }

  if (layer.type === 'image') {
    const img = getCachedImage(layer.url)
    if (!img) return null
    return new Konva.Image({
      ...common, image: img,
      x: layer.x * W, y: layer.y * H, width: layer.w * W, height: layer.h * H,
      cornerRadius: (layer.cornerRadius || 0) * H,
    })
  }
  const strokeWidth = (layer.strokeWidth || 0) * H
  const dash = dashFor(layer, strokeWidth)
  const paint = {
    fill: layer.fill || undefined, stroke: layer.stroke || undefined,
    strokeWidth, dash, lineCap: layer.dashStyle === 'dotted' ? 'round' : undefined,
  }

  if (layer.type === 'rect') {
    return new Konva.Rect({
      ...common, ...paint, x: layer.x * W, y: layer.y * H,
      width: layer.w * W, height: layer.h * H,
      cornerRadius: (layer.cornerRadius || 0) * H,
    })
  }
  if (layer.type === 'ellipse') {
    return new Konva.Ellipse({
      ...common, ...paint, x: (layer.x + layer.w / 2) * W, y: (layer.y + layer.h / 2) * H,
      radiusX: (layer.w / 2) * W, radiusY: (layer.h / 2) * H,
    })
  }
  if (isPoly(layer)) {
    return new Konva.Line({
      ...common, ...paint, x: layer.x * W, y: layer.y * H,
      points: shapePoints(layer, W, H), closed: true, lineJoin: 'round',
    })
  }

  const points = [layer.x1 * W, layer.y1 * H, layer.x2 * W, layer.y2 * H]
  if (layer.type === 'arrow') {
    const head = (layer.strokeWidth || 0.01) * H * 3
    return new Konva.Arrow({
      ...common, ...paint, points, fill: layer.stroke || undefined,
      pointerLength: head, pointerWidth: head,
      // Old arrows carry no arrowStart/arrowEnd, so an absent value has to
      // mean the shape they already had: a head on the end only.
      pointerAtBeginning: !!layer.arrowStart,
      pointerAtEnding: layer.arrowEnd !== false,
    })
  }
  return new Konva.Line({ ...common, ...paint, points, fill: undefined })
}

// Two ways of leaving the photo out, and they are not the same cut:
//  · `textOnly` — JUST the text layers on transparency. The image path's
//    long-standing third export.
//  · `overlayOnly` — EVERY visible layer except the photo and its adjustments.
//    This is what gets composited onto a clip: scrims, logos and shapes are as
//    compositable as text (they're static pixels over a moving plate), so
//    text-only would throw away most of what a brand layer actually is.
//  · `only` — restrict to a named subset of layer ids, which is how the video
//    export splits a document into one image per timing group.
export async function renderDocument(baseCanvas, doc, { textOnly = false, overlayOnly = false, only = null } = {}) {
  const { layers, adjust } = doc
  const bare = textOnly || overlayOnly
  const wanted = only ? new Set(only) : null
  // The page size comes from the base image seen through the crop, not from
  // doc.width/height — the crop is state now (see document.js), and deriving
  // it here is what guarantees the export frames exactly what the editor did.
  const { width: W, height: H } = docSize(baseCanvas.width, baseCanvas.height, doc.crop)
  // Await the bytes before drawing anything: a slow upload must not silently
  // drop an image layer the user could plainly see in the editor. textOnly is
  // the one mode that never draws an image layer; overlayOnly still does.
  if (!textOnly) await ensureLayerImages(layers)

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  document.body.appendChild(container)
  try {
    const stage = new Konva.Stage({ container, width: W, height: H })
    const layer = new Konva.Layer()
    stage.add(layer)

    if (!bare) {
      const img = new Konva.Image({
        image: baseCanvas, x: 0, y: 0, width: W, height: H, listening: false,
        // The crop is a source rectangle on the untouched base image, so the
        // export frames the photo the same way the editor did without ever
        // having cut the pixels.
        crop: cropPx(baseCanvas.width, baseCanvas.height, doc.crop),
      })
      layer.add(img)
      if (hasAdjustments(adjust)) {
        // The export deliberately caches at NATIVE resolution — the live
        // Stage's downscaled preview (see adjust.js) exists only to keep the
        // sliders responsive and never reaches a shipped file.
        img.cache()
        applyAdjustments(img, adjust, { docHeight: H, cachePixelRatio: 1 })
      }
    }

    for (const l of layers) {
      if (l.visible === false) continue
      if (wanted && !wanted.has(l.id)) continue
      if (l.type === 'text') {
        const bmp = buildTextBitmap(l, W, H)
        layer.add(new Konva.Image({
          image: bmp.canvas, x: l.x * W - bmp.offsetX, y: l.y * H - bmp.offsetY,
          width: bmp.width, height: bmp.height, opacity: l.opacity ?? 1,
          listening: false, rotation: l.rotation || 0,
        }))
      } else if (!textOnly) {
        // overlayOnly keeps shapes and images — only the photo underneath is
        // withheld — where textOnly drops everything that isn't a word.
        const node = buildLayerNode(l, W, H)
        if (node) layer.add(node)
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

// The one function the Save button calls.
//
// Three outputs. `compositeBlob` is the asset: photo, adjustments, crop and
// every layer, flattened, at native resolution. `textLayerBlob` is just the
// text on transparency, for the video step to composite over a finished clip.
//
// `cleanBlob` is what the NEXT edit session opens against, and what it should
// contain changed with this pass. It used to be the photo WITH adjustments and
// the crop baked in — while `overlay_state` also stored those same values and
// replayed them on reopen. So every adjustment was applied twice: set
// brightness +40, save, reopen, and the photo was at +80 with the slider still
// reading +40. A crop was worse than double-applied — the pixels were gone, so
// it could never be widened again.
//
// The clean plate is now the UNTOUCHED base image: no adjustments, no crop.
// Everything that isn't pixels lives in overlay_state and is replayed exactly
// once, which is what makes adjust and crop re-editable across sessions. (The
// one thing still baked in is rotate/flip, deliberately — they're lossless
// pixel moves rather than settings, and carrying an orientation through every
// coordinate conversion in the editor would buy nothing.)
//
// What it must NOT become is `compositeBlob`: that bakes this round's layers
// into the photo while overlay_state replays the same layers on top, so the
// old text turns into an unselectable part of the image and every edit looks
// like it duplicated itself.
export async function exportDocument(baseCanvas, doc) {
  const [composite, textLayer] = await Promise.all([
    renderDocument(baseCanvas, doc, { textOnly: false }),
    renderDocument(baseCanvas, doc, { textOnly: true }),
  ])
  const [compositeBlob, textLayerBlob, cleanBlob] = await Promise.all([
    canvasToBlob(composite), canvasToBlob(textLayer), canvasToBlob(baseCanvas),
  ])
  const { width, height } = docSize(baseCanvas.width, baseCanvas.height, doc.crop)
  return { compositeBlob, textLayerBlob, cleanBlob, width, height }
}

// ── Video export ───────────────────────────────────────────────────────────
// What the Save button calls in video mode. No composite and no clean plate:
// the footage is the plate and it lives in storage untouched, so all the editor
// owes the compose step is the brand layer.
//
// ONE PNG PER TIMING GROUP, not one per layer. A document whose headline,
// subline and logo all run the full clip — the overwhelmingly common case —
// comes back as a single image and costs a single ffmpeg overlay; only a
// document that actually uses timing pays for more. Groups are emitted in first
// -appearance order, which preserves the document's own bottom-to-top layer
// order through the filter chain, so a scrim stays behind the text it dims.
export async function exportOverlay(baseCanvas, doc) {
  const groups = []
  const byKey = new Map()
  for (const l of doc.layers) {
    if (l.visible === false) continue
    const key = timingKey(l)
    let g = byKey.get(key)
    if (!g) {
      g = { ...layerTiming(l), ids: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.ids.push(l.id)
  }

  const canvases = await Promise.all(
    groups.map(g => renderDocument(baseCanvas, doc, { overlayOnly: true, only: g.ids })),
  )
  const blobs = await Promise.all(canvases.map(c => canvasToBlob(c)))
  const { width, height } = docSize(baseCanvas.width, baseCanvas.height, doc.crop)
  return {
    overlays: groups.map((g, i) => ({ blob: blobs[i], tIn: g.tIn, tOut: g.tOut, fade: g.fade })),
    width, height,
  }
}
