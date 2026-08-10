// ─── Where the colours in a picker come from ───────────────────────────────
// Canva's colour panel isn't one grid, it's a stack of sourced groups: the
// colours already in the design, the colours pulled out of the photo on the
// page, the brand kit, what you reached for last, and only then a generic
// default set. Offering the photo's own palette is the single reason a
// headline dropped onto a generated image looks designed rather than pasted —
// so all of it is derived here, with no React in sight.

// A frozen module-level default, so a ColorField rendered without a palette
// doesn't get a fresh object identity on every render of its parent.
export const EMPTY_PALETTE = Object.freeze({ document: [], photo: [], brand: [], recent: [] })

// ── Hex plumbing ───────────────────────────────────────────────────────────
// Everything downstream (Konva, canvas fillStyle, <input type="color">)
// expects a lowercase 6-digit hex, so normalise once at the edge rather than
// asking every consumer to cope with '#FFF', 'fff' or stray whitespace.
export function normalizeHex(raw) {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`
  return ''
}

function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

// Plain Euclidean distance in RGB. Not perceptually uniform — Lab would be —
// but this is only used to decide "are these two swatches too similar to both
// be worth a slot", and for that a cheap metric that never leaves the main
// thread is the right trade.
function distance(a, b) {
  const [r1, g1, b1] = toRgb(a), [r2, g2, b2] = toRgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

// Merge groups in priority order, dropping exact repeats AND near-repeats, so
// the panel never spends two slots on colours a person can't tell apart.
export function dedupeColors(colors, minDistance = 0, limit = Infinity) {
  const out = []
  for (const raw of colors) {
    const hex = normalizeHex(raw)
    if (!hex || out.includes(hex)) continue
    if (minDistance > 0 && out.some(c => distance(c, hex) < minDistance)) continue
    out.push(hex)
    if (out.length >= limit) break
  }
  return out
}

// ── Photo colours ──────────────────────────────────────────────────────────
// Canva's "Photo colours": the palette of whatever image is on the page.
//
// Sampled from a 64px thumbnail, not the native image — a 4096² generation is
// 16M pixels and reading them back would block the frame that opens the menu.
// A thumbnail is also a free box blur, which is what you want here: it damps
// sensor noise and JPEG ringing that would otherwise register as their own
// "colours".
const SAMPLE_SIZE = 64
const QUANTISE = 4 // bits kept per channel — 16 levels, i.e. 4096 buckets

export function samplePhotoColors(source, count = 6) {
  if (!source?.width || !source?.height) return []
  const shift = 8 - QUANTISE
  try {
    const c = document.createElement('canvas')
    c.width = SAMPLE_SIZE
    c.height = Math.max(1, Math.round((source.height / source.width) * SAMPLE_SIZE))
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(source, 0, 0, c.width, c.height)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)

    // Bucket by quantised colour, but average the REAL pixels inside each
    // bucket — quantising to pick the group and then reporting the bucket's
    // corner would visibly shift every swatch away from the photo.
    const buckets = new Map()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue // transparent pixels aren't colours
      const key = ((data[i] >> shift) << (QUANTISE * 2)) | ((data[i + 1] >> shift) << QUANTISE) | (data[i + 2] >> shift)
      const b = buckets.get(key)
      if (b) { b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2] }
      else buckets.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] })
    }

    const ranked = [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .map(b => rgbToHex(b.r / b.n, b.g / b.n, b.b / b.n))

    // A min distance of 48 is what stops a photographic gradient — a sky, a
    // skin tone, the sand in most Arak generations — from filling every slot
    // with the same colour six times over.
    return dedupeColors(ranked, 48, count)
  } catch {
    // A cross-origin image taints the canvas and getImageData throws. The
    // panel simply shows no photo group; nothing else should care.
    return []
  }
}

// ── Brand colours ──────────────────────────────────────────────────────────
// Brand Brain stores brandColors as free text a human typed, e.g.
// "Gold #d4af37, Charcoal #1A1410 and off-white". Pull the hex codes out and
// ignore the prose — a wrong guess at "off-white" is worse than no swatch.
export function parseBrandColors(text, limit = 10) {
  if (typeof text !== 'string' || !text) return []
  const found = text.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) || []
  return dedupeColors(found, 0, limit)
}

// ── Recently used ──────────────────────────────────────────────────────────
// Persisted, because "the colour I used on yesterday's post" is the whole
// point of the group — an in-memory list would reset with every page load and
// be empty exactly when it's wanted.
const RECENT_KEY = 'arak.editor.recentColors'
const RECENT_MAX = 10

export function loadRecentColors() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(parsed) ? dedupeColors(parsed, 0, RECENT_MAX) : []
  } catch {
    // Private browsing, a disabled store, or somebody else's data in the key.
    return []
  }
}

export function pushRecentColor(hex) {
  const colour = normalizeHex(hex)
  if (!colour) return loadRecentColors()
  const next = dedupeColors([colour, ...loadRecentColors()], 0, RECENT_MAX)
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* not worth surfacing */ }
  return next
}

// ── Colours already in the document ────────────────────────────────────────
// Every colour-bearing field on every layer, not just fill/stroke — a
// highlight or a neon glow is a colour the design is already committed to,
// and leaving it out is how a palette drifts.
export function documentColorsOf(doc) {
  if (!doc?.layers) return []
  const all = []
  for (const l of doc.layers) all.push(l.color, l.fill, l.stroke, l.bgColor, l.effectColor)
  return dedupeColors(all, 0, 12)
}

// Is the browser's native screen eyedropper available? Chromium-only today,
// so the button has to be conditional rather than assumed.
export function hasEyeDropper() {
  return typeof window !== 'undefined' && typeof window.EyeDropper === 'function'
}

export async function pickWithEyeDropper() {
  if (!hasEyeDropper()) return ''
  try {
    const { sRGBHex } = await new window.EyeDropper().open()
    return normalizeHex(sRGBHex)
  } catch {
    // The user pressed Escape. Not an error worth reporting.
    return ''
  }
}
