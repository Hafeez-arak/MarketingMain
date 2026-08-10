import Konva from 'konva'
import { buildTextBitmap } from './textBitmap'
import { applyAdjustments, hasAdjustments } from './adjust'
import { ensureLayerImages, getCachedImage } from './imageCache'

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
      fill: layer.fill || undefined, stroke: layer.stroke || undefined,
      strokeWidth: (layer.strokeWidth || 0) * H,
    })
  }
  const points = [layer.x1 * W, layer.y1 * H, layer.x2 * W, layer.y2 * H]
  if (layer.type === 'arrow') {
    return new Konva.Arrow({
      ...common, points, stroke: layer.stroke || undefined, fill: layer.stroke || undefined,
      strokeWidth: (layer.strokeWidth || 0) * H,
      pointerLength: (layer.strokeWidth || 0.01) * H * 3,
      pointerWidth: (layer.strokeWidth || 0.01) * H * 3,
    })
  }
  return new Konva.Line({ ...common, points, stroke: layer.stroke || undefined, strokeWidth: (layer.strokeWidth || 0) * H })
}

// `textOnly` renders JUST the text layers on a transparent background,
// preserving the output the video step composites over a finished clip
// without a re-render.
export async function renderDocument(baseCanvas, doc, { textOnly = false } = {}) {
  const { width: W, height: H, layers, adjust } = doc
  // Await the bytes before drawing anything: a slow upload must not silently
  // drop an image layer the user could plainly see in the editor.
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

    if (!textOnly) {
      const img = new Konva.Image({ image: baseCanvas, x: 0, y: 0, width: W, height: H, listening: false })
      layer.add(img)
      if (hasAdjustments(adjust)) {
        // The export deliberately caches at NATIVE resolution — the live
        // Stage's downscaled preview (see adjust.js) exists only to keep the
        // sliders responsive and never reaches a shipped file.
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
          width: bmp.width, height: bmp.height, opacity: l.opacity ?? 1,
          listening: false, rotation: l.rotation || 0,
        }))
      } else if (!textOnly) {
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

// The one function the Save button calls. baseCanvas is the current working
// image (already rotated/flipped/cropped, if any of those were used).
//
// Three outputs, not two: `compositeBlob` (photo + adjustments + every layer,
// flattened — "the asset" shown everywhere) and `textLayerBlob` (just the
// text, transparent, for later video compositing) existed already.
// `cleanBlob` — photo + adjustments + crop/rotate/flip, but NO text, shapes or
// image layers — is what the NEXT edit session opens against. Without it,
// reopening the editor had nowhere non-destructive to load: using
// `compositeBlob` as next time's base image bakes this round's layers into
// pixels while ALSO replaying the same layers on top from overlay_state, so
// the "original" text becomes an unselectable, undeletable part of the photo
// and every edit looks like it duplicates on top of it.
export async function exportDocument(baseCanvas, doc) {
  const [composite, textLayer, clean] = await Promise.all([
    renderDocument(baseCanvas, doc, { textOnly: false }),
    renderDocument(baseCanvas, doc, { textOnly: true }),
    renderDocument(baseCanvas, { ...doc, layers: [] }, { textOnly: false }),
  ])
  const [compositeBlob, textLayerBlob, cleanBlob] = await Promise.all([
    canvasToBlob(composite), canvasToBlob(textLayer), canvasToBlob(clean),
  ])
  return { compositeBlob, textLayerBlob, cleanBlob, width: doc.width, height: doc.height }
}
