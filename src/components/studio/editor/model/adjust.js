import Konva from 'konva'

// ─── Photo adjustments ─────────────────────────────────────────────────────
// Three of these are Konva's own filters, with the maths read straight out of
// node_modules/konva/lib/filters/ (Brighten.js, Contrast.js, HSL.js) rather
// than assumed:
//   · brightness: adds brightness()*255 to every RGB channel. 0 = no change;
//     the UI's -100..100 slider is stored /100 so it lands in Konva's own
//     -1..1 range (full black shift .. full white shift).
//   · contrast: adjust = ((contrast()+100)/100)^2, applied around the 0.5
//     midpoint. 0 = no change (adjust=1); -100 flattens to flat grey.
//     Fed the -100..100 slider value directly — already in Konva's units.
//   · saturation (HSL filter): multiplier is 2^saturation(). 0 = no change;
//     the UI's -100..100 slider is stored /50 so it lands in -2..2 (0.25x to
//     4x), a wide but sane range.
//
// The other six are written here, because Konva has no equivalent. All of them
// are ordinary ImageData passes and all of them are shared by the live preview
// and the export — a filter that existed on only one side would make the
// download disagree with what was approved on screen, which is the one thing
// this whole editor is built not to do.

export const ADJUST_RANGE = {
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  warmth: [-100, 100],
  tint: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  sharpen: [0, 100],
  blur: [0, 100],
  vignette: [0, 100],
}

// Grouped for the panel: the three people reach for first, then the tonal
// pair, then colour temperature, then the effects that aren't really "colour".
export const ADJUST_GROUPS = [
  { title: 'Light', keys: ['brightness', 'contrast', 'highlights', 'shadows'] },
  { title: 'Colour', keys: ['saturation', 'warmth', 'tint'] },
  { title: 'Detail', keys: ['sharpen', 'blur', 'vignette'] },
]

export const ADJUST_KEYS = ADJUST_GROUPS.flatMap(g => g.keys)

export const ADJUST_LABELS = {
  brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation',
  warmth: 'Warmth', tint: 'Tint', highlights: 'Highlights', shadows: 'Shadows',
  sharpen: 'Sharpen', blur: 'Blur', vignette: 'Vignette',
}

export const DEFAULT_ADJUST = Object.fromEntries(ADJUST_KEYS.map(k => [k, 0]))

export function hasAdjustments(adjust) {
  return !!adjust && ADJUST_KEYS.some(k => adjust[k])
}

export function isDefaultAdjust(adjust) {
  return !hasAdjustments(adjust)
}

// ── Filter presets ─────────────────────────────────────────────────────────
// Canva's filter row. A preset is nothing but a named set of the same slider
// values, deliberately — so "Golden" is a starting point you can then tune,
// not an opaque effect you can only take or leave.
export const FILTER_PRESETS = [
  { id: 'none', label: 'None', values: {} },
  { id: 'vivid', label: 'Vivid', values: { saturation: 28, contrast: 14 } },
  { id: 'golden', label: 'Golden', values: { warmth: 34, brightness: 6, saturation: 12, highlights: -8 } },
  { id: 'cool', label: 'Cool', values: { warmth: -30, tint: -8, contrast: 8 } },
  { id: 'fade', label: 'Fade', values: { contrast: -22, shadows: 26, brightness: 6, saturation: -12 } },
  { id: 'drama', label: 'Drama', values: { contrast: 34, highlights: -22, shadows: -16, sharpen: 25 } },
  { id: 'mono', label: 'Mono', values: { saturation: -100, contrast: 12 } },
  { id: 'focus', label: 'Focus', values: { vignette: 38, sharpen: 18, contrast: 8 } },
]

export function applyPreset(presetId) {
  const preset = FILTER_PRESETS.find(p => p.id === presetId)
  return { ...DEFAULT_ADJUST, ...(preset?.values || {}) }
}

// Which preset the current values ARE, so the row can show one as selected
// rather than always looking unset. An exact match only — once a slider is
// nudged it is no longer that preset, and pretending otherwise would make the
// highlighted chip lie.
export function matchPreset(adjust) {
  for (const p of FILTER_PRESETS) {
    const full = { ...DEFAULT_ADJUST, ...p.values }
    if (ADJUST_KEYS.every(k => (adjust?.[k] || 0) === full[k])) return p.id
  }
  return null
}

// ── Custom filters ─────────────────────────────────────────────────────────
// Konva expects a filter to be a function that mutates an ImageData in place.
// Konva's own filters read their parameters back off the node through its attr
// system, but registering new attrs means reaching into Konva.Factory — which
// is not on the `konva` default export at all (only Util, Node, Stage, Layer
// and friends are; see lib/_CoreInternals.js), so doing it that way threw at
// import time.
//
// These are built as CLOSURES over the values instead. Nothing is added to
// Konva's prototypes, there's no idempotency problem when the module is loaded
// by both the live editor and the headless export, and a filter whose value is
// zero can simply not be included in the chain rather than being invoked to do
// nothing. Konva's `filters` setter invalidates the node's filter cache, and
// applyAdjustments always sets it, so a new closure is correctly picked up.

const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v)

// Warmth shifts red against blue (colour temperature); tint shifts green
// against magenta. Both are the standard two-axis white-balance control, and
// both are pointwise, so preview and export can't diverge on them.
function makeWarmthTint(adjust) {
  const warmth = (adjust.warmth || 0) / 100
  const tint = (adjust.tint || 0) / 100
  if (!warmth && !tint) return null
  const r = warmth * 48, b = -warmth * 48, g = tint * 36
  return function WarmthTint(imageData) {
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp255(d[i] + r)
      d[i + 1] = clamp255(d[i + 1] + g)
      d[i + 2] = clamp255(d[i + 2] + b)
    }
  }
}

// Highlights and shadows lift or crush one END of the tone curve while leaving
// the other alone. The weight is a smooth function of the pixel's luminance —
// a hard threshold would band visibly on a gradient, which is most of what a
// generated product shot is.
const TONE_STRENGTH = 1.3

function makeHighlightsShadows(adjust) {
  const hi = (adjust.highlights || 0) / 100
  const lo = (adjust.shadows || 0) / 100
  if (!hi && !lo) return null

  // A precomputed 256-entry curve, built once per adjustment change rather
  // than once per pixel: the per-pixel cost is then one table lookup per
  // channel rather than the whole weighting.
  const curve = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    const n = v / 255
    // Each control has a weight that peaks at its own end of the range and
    // falls away through the midtones, so moving highlights leaves the
    // shadows where they were and vice versa.
    const wHi = n * n
    const wLo = (1 - n) * (1 - n)
    // A push is scaled by the headroom in the direction it's going — (1-n)
    // going up, n going down — so the curve can't drive a pixel past pure
    // white or pure black. That's what makes "recover highlights" pull real
    // detail back instead of just greying out an already-clipped sky.
    const push = (amount, weight) => amount * weight * (amount >= 0 ? 1 - n : n)
    const out = n + (push(hi, wHi) + push(lo, wLo)) * TONE_STRENGTH
    curve[v] = clamp255(Math.round(out * 255))
  }

  return function HighlightsShadows(imageData) {
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      d[i] = curve[d[i]]
      d[i + 1] = curve[d[i + 1]]
      d[i + 2] = curve[d[i + 2]]
    }
  }
}

// Vignette darkens towards the corners. Distance is normalised to the image's
// own half-diagonal, so it is resolution-independent by construction — the
// same value looks the same on the 1600px preview and the 4096px export.
function makeVignette(adjust) {
  const amount = (adjust.vignette || 0) / 100
  if (!amount) return null
  return function Vignette(imageData) {
    const { data: d, width: w, height: h } = imageData
    const cx = w / 2, cy = h / 2
    const maxDist = Math.hypot(cx, cy)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dist = Math.hypot(x - cx, y - cy) / maxDist
        // Untouched through the middle 45%, then falling off smoothly.
        const t = Math.max(0, (dist - 0.45) / 0.55)
        const factor = 1 - amount * t * t
        const i = (y * w + x) * 4
        d[i] *= factor
        d[i + 1] *= factor
        d[i + 2] *= factor
      }
    }
  }
}

// Unsharp mask. The blur radius scales with the image's own width rather than
// being a fixed 1px kernel — a 3×3 sharpen would be a strong effect on the
// 1600px preview and almost invisible on a 4096px export, i.e. the download
// would not match the screen. Tying it to the dimensions makes the two agree.
function makeSharpen(adjust) {
  const amount = (adjust.sharpen || 0) / 100
  if (!amount) return null
  return function Sharpen(imageData) {
    const { data: d, width: w, height: h } = imageData
    const radius = Math.max(1, Math.round(w / 900))
    const src = new Uint8ClampedArray(d)

    const at = (x, y, c) => {
      const cx = x < 0 ? 0 : x >= w ? w - 1 : x
      const cy = y < 0 ? 0 : y >= h ? h - 1 : y
      return src[(cy * w + cx) * 4 + c]
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        for (let c = 0; c < 3; c++) {
          // A 5-tap cross rather than a full box: an unsharp mask only needs a
          // rough local average, and the cross costs a fifth of the reads.
          const blurred = (
            at(x - radius, y, c) + at(x + radius, y, c)
            + at(x, y - radius, c) + at(x, y + radius, c)
            + src[i + c]
          ) / 5
          d[i + c] = clamp255(src[i + c] + (src[i + c] - blurred) * amount * 1.8)
        }
      }
    }
  }
}

// ── Applying them ──────────────────────────────────────────────────────────
// The ORDER is fixed here so the preview and the export aren't merely running
// the same filters but running them in the same sequence: tone first, then
// colour, then the spatial effects that read neighbouring pixels.
//
// `cachePixelRatio` is the resolution the node's filter cache runs at relative
// to the document — 1 for the export, less for the live preview. Blur is the
// one filter whose parameter is measured in CACHE pixels rather than derived
// from the image, so it's the one that has to be scaled by it. Everything else
// is either pointwise or normalised to the image's own dimensions.
export function applyAdjustments(node, adjust, { docHeight = 0, cachePixelRatio = 1 } = {}) {
  if (!node) return
  const a = adjust || {}
  const blur = blurRadiusPx(a, docHeight) * cachePixelRatio

  node.filters([
    a.brightness ? Konva.Filters.Brighten : null,
    a.contrast ? Konva.Filters.Contrast : null,
    makeHighlightsShadows(a),
    a.saturation ? Konva.Filters.HSL : null,
    makeWarmthTint(a),
    makeSharpen(a),
    blur ? Konva.Filters.Blur : null,
    makeVignette(a),
  ].filter(Boolean))

  node.brightness((a.brightness || 0) / 100)
  node.contrast(a.contrast || 0)
  node.saturation((a.saturation || 0) / 50)
  node.blurRadius(blur)
}

// Blur is stored 0..100 and spent as a fraction of the document height, so
// "30" is the same visual softness on a 1080px story and a 4096px square.
export function blurRadiusPx(adjust, docHeight) {
  const amount = (adjust?.blur || 0) / 100
  if (!amount || !docHeight) return 0
  return amount * docHeight * 0.04
}

// ── Auto-adjust ────────────────────────────────────────────────────────────
// Canva's "Auto adjust". Reads the actual histogram rather than applying a
// fixed recipe: expands whatever tonal range the image really occupies to fill
// the available one, then re-centres the midtone. Sampled from a thumbnail for
// the same reason the palette is (see palette.js) — a 16M-pixel read on the
// main thread to compute two numbers is not a trade worth making.
const AUTO_SAMPLE = 128

export function autoAdjust(source) {
  if (!source?.width || !source?.height) return null
  try {
    const c = document.createElement('canvas')
    c.width = AUTO_SAMPLE
    c.height = Math.max(1, Math.round((source.height / source.width) * AUTO_SAMPLE))
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(source, 0, 0, c.width, c.height)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)

    const hist = new Uint32Array(256)
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      // Rec. 601 luma — the same weighting Konva's own Grayscale uses.
      hist[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])]++
      count++
    }
    if (!count) return null

    const percentile = p => {
      let seen = 0
      const target = count * p
      for (let v = 0; v < 256; v++) {
        seen += hist[v]
        if (seen >= target) return v / 255
      }
      return 1
    }

    // Clipped percentiles rather than min/max: a handful of blown specular
    // pixels or one black speck would otherwise say the range is already full
    // and auto-adjust would do nothing on an obviously flat photo.
    const lo = percentile(0.02), mid = percentile(0.5), hi = percentile(0.98)
    const span = Math.max(0.02, hi - lo)

    // Konva's contrast factor is ((c+100)/100)^2, so the slider value for a
    // desired gain g is 100*(sqrt(g)-1).
    const gain = Math.min(2.2, 0.94 / span)
    const contrast = Math.round(Math.max(-100, Math.min(100, 100 * (Math.sqrt(gain) - 1))))

    // Where the midtone lands after that contrast, and what brightness shift
    // pulls it back to the middle. Brightness is stored -100..100 and spent as
    // /100 of the full 0..1 range.
    const midAfter = (mid - 0.5) * gain + 0.5
    const brightness = Math.round(Math.max(-60, Math.min(60, (0.5 - midAfter) * 100)))

    return { ...DEFAULT_ADJUST, brightness, contrast }
  } catch {
    // A tainted canvas. Auto-adjust simply declines rather than throwing.
    return null
  }
}

// ── Why the live Stage does not filter at native resolution ────────────────
// Konva applies pixel filters by caching a node to an offscreen canvas and
// running every filter over every pixel of it, synchronously, on the main
// thread — redone whenever any filter value changes. A 4096² generation is
// 16.7M pixels: eight filter passes over a ~67MB buffer, per pointer-move
// event, is a guaranteed stutter on any slider.
//
// TWO things are needed to avoid that, and only the first was here before:
//   1. draw a downscaled copy of the photo (makePreviewCanvas, below), and
//   2. cache the node AT THAT RESOLUTION.
// (2) matters because Konva sizes a cache from the node's own width/height,
// which is the document size no matter how small the source bitmap is — so
// without an explicit pixelRatio the filters ran over full-resolution pixels
// regardless, and the downscale only ever saved memory. `cacheRatioFor` is
// what the Stage passes to cache({ pixelRatio }) to close that gap.
//
// It is safe to filter at a lower resolution precisely BECAUSE every filter in
// the chain is either pointwise or normalised to the image's own dimensions —
// resolution changes how many pixels are processed, never what any one of them
// becomes. Blur is the single exception and is scaled explicitly above.
export const PREVIEW_MAX_EDGE = 1600

export function makePreviewCanvas(sourceCanvas, maxEdge = PREVIEW_MAX_EDGE) {
  if (!sourceCanvas) return null
  const longest = Math.max(sourceCanvas.width, sourceCanvas.height)
  if (longest <= maxEdge) return sourceCanvas
  const ratio = maxEdge / longest
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sourceCanvas.width * ratio))
  out.height = Math.max(1, Math.round(sourceCanvas.height * ratio))
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height)
  return out
}

export function cacheRatioFor(previewCanvas, baseCanvas) {
  if (!previewCanvas || !baseCanvas?.width) return 1
  return Math.min(1, previewCanvas.width / baseCanvas.width)
}
