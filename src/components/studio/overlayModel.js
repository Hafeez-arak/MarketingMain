import { ensureFontsLoaded, STUDIO_FONTS } from './fonts'

// ─── Overlay text: the data model and the renderer ─────────────────────────
// Kept out of the editor component on purpose. The editor is one consumer;
// the video step is the other — it re-renders the same boxes at the clip's
// resolution to produce the transparent PNG that gets composited over the
// footage. Both must lay text out identically, so there is exactly one
// implementation of the layout and exactly one of the drawing.
//
// EVERY geometric value is a FRACTION of the image (0–1), never a pixel.
// That is what lets a 480px preview and a 4096px export agree: same numbers,
// different multiplier.

// Arabic, Arabic Supplement/Extended-A, and the presentation-form blocks.
// Written as escapes rather than literal glyphs — the ranges end on U+FEFF,
// which is invisible in source and trips linters and diff tools alike.
export const ARABIC_RE = new RegExp('[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]')

export function newTextBox(overrides = {}) {
  return {
    id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    text: 'Your text here',
    x: 0.08, y: 0.08, w: 0.84,      // fractions of image width/height
    size: 0.075,                     // font size as a fraction of image HEIGHT
    family: 'Cairo',
    weight: 700,
    color: '#ffffff',
    align: 'center',                 // physical: left | center | right
    dir: 'ltr',
    lineHeight: 1.25,
    shadow: true,                    // legibility over photography
    dirTouched: false,               // once the user picks a direction, stop auto-detecting
    ...overrides,
  }
}

// Which direction/font a box should switch to as text is typed. Typing Arabic
// almost always means the box wants to be RTL in an Arabic-capable face, and
// a marketer shouldn't have to know that — but only until they choose for
// themselves, after which we never override them again.
export function autoDirectionPatch(box, text) {
  const patch = { text }
  if (box.dirTouched) return patch
  const wantsRtl = ARABIC_RE.test(text)
  patch.dir = wantsRtl ? 'rtl' : 'ltr'
  if (wantsRtl && !STUDIO_FONTS.find(f => f.value === box.family)?.arabic) patch.family = 'Cairo'
  return patch
}

// Shared text-measuring context. Layout has to be measurable with no DOM
// involved (on export there are no elements to read), so all measurement
// goes through this rather than through the live preview.
let measureCanvas = null
function measureCtx() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  return measureCanvas.getContext('2d')
}

// Break a box's text into rendered lines at a given target size. Explicit
// newlines are honoured first, then each paragraph wraps on spaces to fit.
// Splitting on spaces is correct for Arabic too — it's the joining WITHIN a
// word that's delicate, and that belongs to the font, not to us.
export function layoutBox(box, W, H) {
  const fontPx = box.size * H
  const boxW = box.w * W
  const ctx = measureCtx()
  ctx.font = `${box.weight} ${fontPx}px "${box.family}", sans-serif`

  const lines = []
  for (const paragraph of String(box.text ?? '').split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let current = ''
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (current && ctx.measureText(candidate).width > boxW) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }

  return { lines, fontPx, lineHeightPx: fontPx * box.lineHeight, boxW, x: box.x * W, y: box.y * H }
}

export function drawBox(ctx, box, W, H) {
  const { lines, fontPx, lineHeightPx, boxW, x, y } = layoutBox(box, W, H)
  ctx.save()
  ctx.font = `${box.weight} ${fontPx}px "${box.family}", sans-serif`
  // Shapes and orders the glyphs. Alignment below stays PHYSICAL, so what the
  // preview shows on the left is on the left in the export too, whatever the
  // script.
  ctx.direction = box.dir
  ctx.fillStyle = box.color
  ctx.textBaseline = 'top'
  ctx.textAlign = box.align

  if (box.shadow) {
    // Scaled off the font size so the shadow keeps its proportions whether
    // this is a 512px preview or a 4K export.
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = fontPx * 0.18
    ctx.shadowOffsetY = fontPx * 0.05
  }

  const anchorX = box.align === 'center' ? x + boxW / 2 : box.align === 'right' ? x + boxW : x
  lines.forEach((line, i) => ctx.fillText(line, anchorX, y + i * lineHeightPx))
  ctx.restore()
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Required to read pixels back out of the canvas afterwards. Supabase
    // Storage serves permissive CORS headers, so this holds for our own
    // buckets; a third-party URL that doesn't will taint the canvas and make
    // toBlob throw, which is caught and surfaced at export time.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the image.'))
    img.src = url
  })
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export produced no file.'))), type)
    } catch {
      reject(new Error("The image couldn't be exported because it's served without CORS headers."))
    }
  })
}

// Render `boxes` over `imageUrl` at the image's NATIVE resolution — never the
// on-screen size, which would quietly downscale everything the team exports.
//
// Two files come out of the one pass: the flattened image to post, and the
// text alone on transparency. The second is what makes editable text on video
// possible — it composites over the finished clip, so changing a word is a
// re-composite (seconds, identical footage) instead of a re-generation
// (minutes, and a visibly different clip).
export async function renderOverlay(imageUrl, boxes, { targetWidth, targetHeight } = {}) {
  await ensureFontsLoaded(boxes)
  const img = await loadImage(imageUrl)
  const W = targetWidth || img.naturalWidth
  const H = targetHeight || img.naturalHeight

  const composite = document.createElement('canvas')
  composite.width = W; composite.height = H
  const cctx = composite.getContext('2d')
  cctx.drawImage(img, 0, 0, W, H)
  boxes.forEach(b => drawBox(cctx, b, W, H))

  const textLayer = document.createElement('canvas')
  textLayer.width = W; textLayer.height = H
  const tctx = textLayer.getContext('2d')
  boxes.forEach(b => drawBox(tctx, b, W, H))

  const [compositeBlob, textLayerBlob] = await Promise.all([
    canvasToBlob(composite),
    canvasToBlob(textLayer),
  ])
  return { compositeBlob, textLayerBlob, width: W, height: H }
}
