import { STUDIO_FONTS } from './fonts'

// ─── Overlay text: the data model and the renderer ─────────────────────────
// Kept out of the editor component on purpose. The editor is one consumer;
// the video step is the other — it re-renders the same boxes at the clip's
// resolution to produce the transparent PNG that gets composited over the
// footage. Both must lay text out identically, so there is exactly one
// implementation of the layout and exactly one of the drawing.
//
// EVERY geometric value is a FRACTION of the image (0–1), never a pixel.
// That is what lets a 480px preview and a 4096px export agree: same numbers,
// different multiplier. Anything measured in type — letter spacing, an
// effect's offset, an underline's thickness — is a fraction of the FONT SIZE
// instead, so it stays proportional when the type is resized.

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
    align: 'center',                 // physical: left | center | right | justify
    dir: 'ltr',
    rotation: 0,
    lineHeight: 1.25,
    tracking: 0,                     // letter spacing, in em (fraction of font size)
    italic: false,
    underline: false,
    strike: false,
    uppercase: false,
    anchor: 'top',                   // which edge of the block sits at y
    shadow: true,                    // legibility over photography
    effect: 'none',                  // see EFFECTS below
    effectColor: '#000000',
    effectIntensity: 50,             // 0–100, meaning depends on the effect
    bgColor: '',                     // highlight behind the text; '' = none
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

// ─── Effects ───────────────────────────────────────────────────────────────
// Canva's text-effect set, minus the ones that don't survive Arabic shaping or
// don't earn their complexity. Each is a small number of extra canvas passes
// around the same fillText, so preview and export stay one implementation.
//   · lift    — a soft shadow directly under the text; lifts it off a photo.
//   · hollow  — outline only, no fill.
//   · splice  — an offset solid copy behind hollow text.
//   · echo    — two fading offset copies, like a print misregistration.
//   · neon    — a glow in the text's own colour.
// Deliberately absent: curve (needs per-glyph placement, which breaks the
// Arabic shaper) and glitch (chromatic offsets, no real use here).
export const EFFECTS = [
  { value: 'none',   label: 'None' },
  { value: 'lift',   label: 'Lift' },
  { value: 'hollow', label: 'Hollow' },
  { value: 'splice', label: 'Splice', usesColor: true },
  { value: 'echo',   label: 'Echo',   usesColor: true },
  { value: 'neon',   label: 'Neon' },
]

export const ANCHORS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
]

// Shared text-measuring context. Layout has to be measurable with no DOM
// involved (on export there are no elements to read), so all measurement
// goes through this rather than through the live preview.
let measureCanvas = null
function measureCtx() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  return measureCanvas.getContext('2d')
}

export function fontString(box, fontPx) {
  return `${box.italic ? 'italic ' : ''}${box.weight} ${fontPx}px "${box.family}", sans-serif`
}

// Applied to whatever context is about to measure or draw. Always set, never
// conditionally — the measuring context is shared and reused, so leaving a
// previous box's tracking on it would silently mis-wrap the next one.
function applyTypeSettings(ctx, box, fontPx) {
  ctx.font = fontString(box, fontPx)
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(box.tracking || 0) * fontPx}px`
}

// Uppercase has to be applied BEFORE wrapping, not at draw time — capitals are
// wider, so laying out the original casing and shouting it afterwards would
// overflow the box.
export function displayText(box) {
  const raw = String(box.text ?? '')
  return box.uppercase ? raw.toUpperCase() : raw
}

// Break a box's text into rendered lines at a given target size. Explicit
// newlines are honoured first, then each paragraph wraps on spaces to fit.
// Splitting on spaces is correct for Arabic too — it's the joining WITHIN a
// word that's delicate, and that belongs to the font, not to us.
//
// Lines come back as objects rather than strings because justification needs
// to know which line ENDS a paragraph: that one keeps its natural spacing,
// exactly as it does in every text engine, or the last line of a paragraph
// gets stretched across the full column.
export function layoutBox(box, W, H) {
  const fontPx = box.size * H
  const boxW = box.w * W
  const ctx = measureCtx()
  applyTypeSettings(ctx, box, fontPx)

  const lines = []
  const paragraphs = displayText(box).split('\n')
  paragraphs.forEach(paragraph => {
    if (!paragraph) { lines.push({ text: '', last: true }); return }
    let current = ''
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (current && ctx.measureText(candidate).width > boxW) {
        lines.push({ text: current, last: false })
        current = word
      } else {
        current = candidate
      }
    }
    lines.push({ text: current, last: true })
  })

  const lineHeightPx = fontPx * box.lineHeight
  return {
    lines, fontPx, lineHeightPx, boxW,
    x: box.x * W, y: box.y * H,
    blockH: lines.length * lineHeightPx,
  }
}

// How far outside its own box a text layer draws. The bitmap it's rasterised
// into has to be padded by at least this much or a glow, an echo or a
// highlight gets clipped at the edge — and since the padding is folded into
// the node's offset, everything downstream stays in the right place.
export function effectPadding(box, fontPx) {
  const i = (box.effectIntensity ?? 50) / 100
  switch (box.effect) {
    case 'neon':   return fontPx * (0.45 * i + 0.10)
    case 'lift':   return fontPx * (0.35 * i + 0.10)
    case 'echo':
    case 'splice': return fontPx * (0.12 * i + 0.06)
    case 'hollow': return fontPx * 0.06
    default:       return 0
  }
}

export const HIGHLIGHT_PAD = 0.18   // of the font size, each side

// Ceil, but tolerant of the last bit or two of floating-point noise.
//
// Plain Math.ceil costs a whole pixel whenever a value lands a hair ABOVE an
// integer, and that happens routinely here: a font size is a fraction of the
// document height, so any arithmetic that re-derives it — rotating the page,
// re-cropping, a round trip through a saved state — can turn an exact 80 into
// 80.00000000000001, and `Math.ceil(80.00000000000001 * 0.3)` is 25 where
// `Math.ceil(24)` is 24. One pixel of padding is one pixel of offset, and
// since the offset is what positions the node, that shifts the text. It was
// measurable: four 90° turns moved a caption a whole pixel off where it
// started. The epsilon is far smaller than any real sub-pixel measurement and
// far larger than the noise.
export function ceilPx(value) {
  return Math.ceil(value - 1e-6)
}

export function textPadding(box, fontPx) {
  const highlight = box.bgColor ? fontPx * HIGHLIGHT_PAD : 0
  return ceilPx(fontPx * 0.3 + effectPadding(box, fontPx) + highlight) + 2
}

// ── Drawing ────────────────────────────────────────────────────────────────

// One run of text — a whole line normally, a single word when the line is
// being justified. Every effect is a set of extra passes around the same
// fillText, so a run drawn here is identical whether it came from the live
// editor or the export.
function drawRun(ctx, text, x, y, box, fontPx) {
  if (!text) return
  const effect = box.effect || 'none'
  const intensity = (box.effectIntensity ?? 50) / 100
  const effectColor = box.effectColor || '#000000'

  ctx.save()

  if (effect === 'echo') {
    ctx.fillStyle = effectColor
    ctx.globalAlpha = 0.25 + 0.2 * intensity
    ctx.fillText(text, x + fontPx * 0.12 * intensity, y + fontPx * 0.12 * intensity)
    ctx.globalAlpha = 0.4 + 0.25 * intensity
    ctx.fillText(text, x + fontPx * 0.06 * intensity, y + fontPx * 0.06 * intensity)
    ctx.globalAlpha = 1
  } else if (effect === 'splice') {
    ctx.fillStyle = effectColor
    ctx.fillText(text, x + fontPx * 0.09 * intensity, y + fontPx * 0.09 * intensity)
  }

  if (effect === 'lift') {
    ctx.shadowColor = `rgba(0,0,0,${0.2 + 0.35 * intensity})`
    ctx.shadowBlur = fontPx * 0.35 * intensity + 2
    ctx.shadowOffsetY = fontPx * 0.04 * intensity
  } else if (effect === 'neon') {
    // Three stacked passes: one blurred glow can't get bright enough on its
    // own, and compounding it is how neon reads as emitting rather than as a
    // coloured drop shadow.
    ctx.fillStyle = box.color
    ctx.shadowColor = box.color
    ctx.shadowBlur = fontPx * 0.45 * intensity + 3
    ctx.fillText(text, x, y)
    ctx.fillText(text, x, y)
  } else if (box.shadow) {
    // The original legibility shadow, unchanged — scaled off the font size so
    // it keeps its proportions whether this is a 512px preview or a 4K export.
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = fontPx * 0.18
    ctx.shadowOffsetY = fontPx * 0.05
  }

  if (effect === 'hollow' || effect === 'splice') {
    ctx.lineWidth = Math.max(1, fontPx * (0.02 + 0.035 * intensity))
    ctx.lineJoin = 'round'
    ctx.strokeStyle = box.color
    ctx.strokeText(text, x, y)
  } else {
    ctx.fillStyle = box.color
    ctx.fillText(text, x, y)
  }

  ctx.restore()
}

// A justified line whose text can't stretch (the last of its paragraph, or a
// single word) falls back to the natural edge for its direction — flush left
// for LTR, flush right for RTL — which is what justified text does everywhere.
function physicalAlign(box) {
  if (box.align !== 'justify') return box.align
  return box.dir === 'rtl' ? 'right' : 'left'
}

function isStretched(box, line) {
  return box.align === 'justify' && !line.last && line.text.includes(' ')
}

// Where a line starts, in the coordinate the current textAlign expects: canvas
// anchors to the left/centre/right of the string depending on textAlign, so
// this returns the anchor point rather than the left edge.
function anchorX(align, x, boxW) {
  if (align === 'center') return x + boxW / 2
  if (align === 'right') return x + boxW
  return x
}

// The physical extent a drawn line occupies, needed for the highlight box and
// for underline/strikethrough rules.
function lineExtent(ctx, line, box, x, boxW) {
  if (isStretched(box, line)) return { left: x, width: boxW }
  const width = ctx.measureText(line.text).width
  const align = physicalAlign(box)
  if (align === 'center') return { left: x + (boxW - width) / 2, width }
  if (align === 'right') return { left: x + boxW - width, width }
  return { left: x, width }
}

export function drawBox(ctx, box, W, H) {
  const { lines, fontPx, lineHeightPx, boxW, x, y } = layoutBox(box, W, H)
  ctx.save()
  applyTypeSettings(ctx, box, fontPx)
  // Shapes and orders the glyphs. Alignment below stays PHYSICAL, so what the
  // preview shows on the left is on the left in the export too, whatever the
  // script.
  ctx.direction = box.dir
  ctx.textBaseline = 'top'

  // Highlight first, so every effect and rule draws on top of it.
  if (box.bgColor) {
    const pad = fontPx * HIGHLIGHT_PAD
    ctx.save()
    ctx.fillStyle = box.bgColor
    lines.forEach((line, i) => {
      if (!line.text) return
      ctx.textAlign = 'left'
      const ext = lineExtent(ctx, line, box, x, boxW)
      const top = y + i * lineHeightPx
      ctx.fillRect(ext.left - pad, top - pad * 0.55, ext.width + pad * 2, lineHeightPx + pad * 0.4)
    })
    ctx.restore()
  }

  lines.forEach((line, i) => {
    const lineY = y + i * lineHeightPx

    if (isStretched(box, line)) {
      // Stretch the word gaps so the line fills the column exactly. Words are
      // placed one at a time, which is also why this works for Arabic: a
      // space is already a joining break, so drawing each word as its own run
      // can't split a ligature that would otherwise have formed.
      const words = line.text.split(' ')
      ctx.textAlign = box.dir === 'rtl' ? 'right' : 'left'
      const naturalWidth = words.reduce((sum, w) => sum + ctx.measureText(w).width, 0)
      const gap = (boxW - naturalWidth) / (words.length - 1)
      let cursor = box.dir === 'rtl' ? x + boxW : x
      for (const word of words) {
        drawRun(ctx, word, cursor, lineY, box, fontPx)
        const advance = ctx.measureText(word).width + gap
        cursor += box.dir === 'rtl' ? -advance : advance
      }
    } else {
      const align = physicalAlign(box)
      ctx.textAlign = align
      drawRun(ctx, line.text, anchorX(align, x, boxW), lineY, box, fontPx)
    }

    if ((box.underline || box.strike) && line.text) {
      ctx.save()
      ctx.textAlign = 'left'
      const ext = lineExtent(ctx, line, box, x, boxW)
      ctx.fillStyle = box.color
      const thickness = Math.max(1, fontPx * 0.055)
      if (box.underline) ctx.fillRect(ext.left, lineY + fontPx * 0.98, ext.width, thickness)
      if (box.strike) ctx.fillRect(ext.left, lineY + fontPx * 0.55, ext.width, thickness)
      ctx.restore()
    }
  })

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

// The full render-and-export pass this used to do (composite + transparent
// text layer, at native resolution) now lives in editor/model/render.js, which
// generalises it to shapes, image layers and crop. layoutBox/drawBox stay here
// — they're still the single implementation of text layout, reused by both the
// live editor's per-layer bitmaps and by that export pass.
