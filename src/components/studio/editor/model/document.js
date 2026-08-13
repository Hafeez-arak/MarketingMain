import { newTextBox } from '../../overlayModel'
import { DEFAULT_ADJUST } from './adjust'

// ─── Editor document model ─────────────────────────────────────────────────
// A document is { width, height, crop, layers, adjust }:
//  · crop — {x, y, w, h} as FRACTIONS OF THE BASE IMAGE. This is the frame the
//    document looks at the photo through; it is state, not a pixel operation,
//    so it stays re-editable forever (see §Non-destructive crop below).
//  · width/height — the current document size in pixels, DERIVED from the base
//    image and the crop (see docSize). Never assigned independently: two
//    sources of truth for the page size is how a crop and a reopen end up
//    disagreeing.
//  · layers — z-ordered bottom-to-top. Every layer has
//    {id, type, visible, locked, opacity}; type is one of
//    'text' | 'image' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' |
//    'arrow'.
//  · adjust — the photo adjustments (see adjust.js), applied to the base photo
//    only, and likewise stored rather than baked.
//
// EVERY geometric value is a FRACTION of the document (0–1), never a pixel —
// see overlayModel.js's header. That is the invariant that lets a 900px
// preview and a 4096px export agree by construction, and it applies to every
// layer type added here, image layers included.
//
// ── Non-destructive crop ───────────────────────────────────────────────────
// Crop used to rewrite the base canvas and remap every layer, which meant the
// pixels outside the frame were gone: you could not widen a crop you'd made a
// minute earlier, let alone one from a previous session. Now the base canvas
// is never cut. `crop` is a window onto it, applied at draw time by both the
// live Stage and the export, and re-editable at any point.
//
// The contract that makes it survive a save is in render.js: the "clean plate"
// written back as the next session's base image is now the UNTOUCHED photo —
// no crop and no adjustments baked in — because both of those live in
// overlay_state and are replayed on reopen. (Baking them AND replaying them is
// what used to apply every adjustment twice.)

export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 })

export function normalizeCrop(crop) {
  if (!crop) return { ...FULL_CROP }
  const w = Math.min(1, Math.max(0.02, crop.w ?? 1))
  const h = Math.min(1, Math.max(0.02, crop.h ?? 1))
  return {
    w, h,
    x: Math.min(1 - w, Math.max(0, crop.x || 0)),
    y: Math.min(1 - h, Math.max(0, crop.y || 0)),
  }
}

// The document's pixel size: the base image seen through the crop. Rounded
// once, here, so every consumer gets the same integers.
export function docSize(baseW, baseH, crop) {
  const c = normalizeCrop(crop)
  return {
    width: Math.max(1, Math.round(baseW * c.w)),
    height: Math.max(1, Math.round(baseH * c.h)),
  }
}

// The crop expressed in base-image PIXELS, which is what Konva's `crop`
// attribute and drawImage's source rectangle both want.
export function cropPx(baseW, baseH, crop) {
  const c = normalizeCrop(crop)
  return { x: c.x * baseW, y: c.y * baseH, width: c.w * baseW, height: c.h * baseH }
}

export function isFullFrame(crop) {
  const c = normalizeCrop(crop)
  return c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1
}

export function newId(prefix = 'l') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function newTextLayer(overrides = {}) {
  return { ...newTextBox(), type: 'text', visible: true, locked: false, opacity: 1, ...overrides }
}

// Polygons and stars are drawn as a closed Konva.Line from points computed
// inside the layer's box rather than as Konva's RegularPolygon/Star, which
// only take a radius. A box keeps them consistent with every other shape: the
// same x/y/w/h, the same Transformer, the same align and snap maths, and the
// ability to squash a hexagon into a wide badge — none of which a
// radius-based node can do.
export function newShapeLayer(type, overrides = {}) {
  const base = {
    id: newId(type[0]), type, x: 0.3, y: 0.3, w: 0.3, h: 0.2,
    fill: type === 'line' || type === 'arrow' ? '' : '#d4af37',
    stroke: '#1a1410',
    strokeWidth: 0.006,          // a fraction of doc HEIGHT, like text size
    dashStyle: 'solid',
    cornerRadius: 0, rotation: 0, opacity: 1, visible: true, locked: false,
  }
  if (type === 'line' || type === 'arrow') {
    return {
      ...base, x1: 0.25, y1: 0.5, x2: 0.6, y2: 0.5,
      stroke: '#d4af37', strokeWidth: 0.01,
      // Which ends carry a head. Canva offers both, and a double-headed arrow
      // is the natural way to annotate a dimension on a product shot.
      arrowStart: false, arrowEnd: type === 'arrow',
      ...overrides,
    }
  }
  if (type === 'polygon') return { ...base, sides: 6, w: 0.24, h: 0.24, ...overrides }
  if (type === 'triangle') return { ...base, type: 'polygon', sides: 3, w: 0.26, h: 0.24, ...overrides }
  if (type === 'star') return { ...base, points: 5, innerRatio: 0.45, w: 0.24, h: 0.24, ...overrides }
  return { ...base, ...overrides }
}

// Points for a polygon or star, in pixels relative to the layer's own box
// origin. Shared by the live node and the export so the two cannot draw a
// different number of sides or a different star.
export function shapePoints(layer, W, H) {
  const w = layer.w * W, h = layer.h * H
  const rx = w / 2, ry = h / 2
  const out = []
  if (layer.type === 'star') {
    const n = Math.max(3, Math.min(20, layer.points || 5))
    const inner = Math.max(0.05, Math.min(0.95, layer.innerRatio ?? 0.45))
    for (let i = 0; i < n * 2; i++) {
      // Starting at -90° so the first point sits at the top, which is the
      // only orientation anybody means by "a star".
      const angle = (Math.PI * i) / n - Math.PI / 2
      const r = i % 2 === 0 ? 1 : inner
      out.push(rx + Math.cos(angle) * rx * r, ry + Math.sin(angle) * ry * r)
    }
    return out
  }
  const n = Math.max(3, Math.min(20, layer.sides || 3))
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    out.push(rx + Math.cos(angle) * rx, ry + Math.sin(angle) * ry)
  }
  return out
}

// A dash pattern expressed in multiples of the stroke width, so it scales with
// the document exactly the way the stroke itself does — a fixed pixel dash
// would come apart between a 1080px preview and a 4096px export.
export function dashFor(layer, strokeWidthPx) {
  const sw = Math.max(0.5, strokeWidthPx)
  if (layer.dashStyle === 'dashed') return [sw * 3, sw * 2]
  if (layer.dashStyle === 'dotted') return [0.01, sw * 2]
  return undefined
}

export const DASH_STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

// An image layer stores a URL, not pixels — it has to survive a round trip
// through overlay_state (a JSONB column). The bytes are fetched and cached at
// render time by imageCache.js, on both the live Stage and the headless
// export Stage, so the two can't disagree about what was drawn.
//
// `naturalRatio` (width/height of the source file) is stored alongside so the
// layer can be inserted at its true aspect ratio without waiting for a
// network round trip on reopen, and so a ratio-locked resize has something to
// lock to when the image hasn't finished loading yet.
export function newImageLayer(url, { naturalRatio = 1, ...overrides } = {}) {
  const w = 0.4
  return {
    id: newId('i'), type: 'image', url, naturalRatio,
    x: 0.3, y: 0.3, w, h: w / (naturalRatio || 1),
    rotation: 0, opacity: 1, cornerRadius: 0, visible: true, locked: false,
    ...overrides,
  }
}

export const SHAPE_TYPES = ['rect', 'ellipse', 'polygon', 'star']

export function isShape(layer) {
  return !!layer && SHAPE_TYPES.includes(layer.type)
}
// Shapes drawn as a closed path from computed points, rather than by a Konva
// primitive with its own geometry attributes.
export function isPoly(layer) {
  return !!layer && (layer.type === 'polygon' || layer.type === 'star')
}
export function isPath(layer) {
  return layer && (layer.type === 'line' || layer.type === 'arrow')
}
// Layers whose geometry is a plain x/y/w/h box — everything the shared
// Transformer can resize without special-casing. Text is deliberately NOT in
// here: it has no stored height (it's derived from the wrapped line count),
// so it resizes through its own width/font-size split.
export function isBoxed(layer) {
  return isShape(layer) || layer?.type === 'image'
}

export function layerLabel(l) {
  if (l.type === 'text') return l.text?.trim().slice(0, 28) || 'Text'
  if (l.type === 'image') return 'Image'
  if (l.type === 'polygon') return l.sides === 3 ? 'Triangle' : `${l.sides}-sided shape`
  return l.type.charAt(0).toUpperCase() + l.type.slice(1)
}

export { DEFAULT_ADJUST }

// ── Layer timing (video mode only) ─────────────────────────────────────────
// When the document is composited onto a clip rather than a photo, a layer can
// come and go: `tIn` is the second it appears, `tOut` the second it leaves
// (null = runs to the end of the clip), `fade` the seconds of alpha ramp at
// each end.
//
// All three are OPTIONAL and absent means "the whole clip", which is why this
// needed no DOC_VERSION bump and why every existing image document keeps
// working untouched — on an image nothing ever reads them.
//
// The one rule worth stating: these are SECONDS, not fractions. Everything
// geometric in this file is a fraction of the document precisely so a preview
// and an export agree, but time has a real unit that doesn't change with
// resolution, and storing 0.25-of-a-clip would silently move the text when the
// same layer document is reused on a clip of a different length.
export const DEFAULT_TIMING = Object.freeze({ tIn: 0, tOut: null, fade: 0 })

export function layerTiming(layer) {
  const tIn = Math.max(0, Number(layer?.tIn) || 0)
  const raw = layer?.tOut
  const tOut = raw === null || raw === undefined || raw === '' ? null : Math.max(0, Number(raw) || 0)
  return { tIn, tOut: tOut !== null && tOut <= tIn ? null : tOut, fade: Math.max(0, Number(layer?.fade) || 0) }
}

export function isFullLength(layer) {
  const t = layerTiming(layer)
  return t.tIn === 0 && t.tOut === null
}

// Layers that share a timing are rendered into ONE overlay PNG, so a document
// where nothing is timed — the common case by a wide margin — still produces a
// single image and a single ffmpeg overlay. Rounded to 2dp because that is the
// precision the filter graph is given, and two layers agreeing to the
// millisecond but not the microsecond should not cost an extra composite pass.
//
// **Motion is part of the key, not just timing.** An overlay's animation is
// applied by ffmpeg to the whole PNG, so two layers sharing a group also share
// every pixel of movement. Bundling a sliding headline with a static logo that
// happened to run for the same seconds would drag the logo across the frame
// with it. Layers that move differently must therefore be different images —
// which costs an extra overlay pass, and only for documents that asked for it.
export function timingKey(layer) {
  const { tIn, tOut, fade } = layerTiming(layer)
  const a = layer?.anim
  const motion = a && (a.in || a.out) && (a.in !== 'none' || a.out !== 'none')
    ? `${a.in || 'none'}>${a.out || 'none'}@${Number(a.duration) || 0.4}`
    : 'still'
  return `${tIn.toFixed(2)}|${tOut === null ? 'end' : tOut.toFixed(2)}|${fade.toFixed(2)}|${motion}`
}

// ── Trim (video mode only) ─────────────────────────────────────────────────
// Which part of the clip actually ships. `{ start, end }` in seconds of SOURCE
// time — the clip as the model rendered it — with `end: null` meaning "to the
// end of the footage".
//
// This is deliberately the same shape of idea as `crop`: a window onto media
// that is never itself cut. The footage in storage stays whole, so a trim from
// last week can be widened again, and — as with the crop — the timeline shows
// the WHOLE clip with the excluded parts dimmed rather than absent, because
// being able to drag the edge back out over them is the entire point.
//
// The consequence that matters most is what it does NOT change: layer timings
// stay in source time. A headline written to appear at 2s still means 2s of
// the original clip whether or not someone later trims the first second off
// the front. Re-basing them onto the trimmed window would silently move every
// cue in the document the moment a handle was dragged, which is exactly the
// kind of quiet damage `tOut: null` exists to avoid. The compose step shifts
// the overlays onto output time at the end, once, where the real duration is
// known.
export const DEFAULT_TRIM = Object.freeze({ start: 0, end: null })

export function normalizeTrim(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TRIM }
  const start = Math.max(0, Number(raw.start) || 0)
  const rawEnd = raw.end
  const end = rawEnd === null || rawEnd === undefined || rawEnd === '' ? null : Math.max(0, Number(rawEnd) || 0)
  return { start, end: end !== null && end <= start ? null : end }
}

export function isFullClip(trim) {
  const t = normalizeTrim(trim)
  return t.start === 0 && t.end === null
}

// The window resolved against a real clip length: what actually plays, and
// what the compose step is told to keep.
export function trimWindow(trim, duration) {
  const d = Math.max(0.1, Number(duration) || 0)
  const t = normalizeTrim(trim)
  const start = Math.min(t.start, Math.max(0, d - 0.1))
  const end = t.end === null ? d : Math.min(t.end, d)
  return { start, end: Math.max(start + 0.1, end), length: Math.max(0.1, Math.max(start + 0.1, end) - start) }
}

// Keeps a bar inside the clip and never inverted. `duration` is the clip's
// length; a tOut at or past it is stored as null rather than the exact number,
// so the layer stays "to the end" if the clip is later re-rendered longer.
export function clampTiming({ tIn, tOut, fade }, duration) {
  const d = Math.max(0.1, Number(duration) || 0)
  const inS = Math.min(Math.max(0, Number(tIn) || 0), d - 0.1)
  let outS = tOut === null || tOut === undefined || tOut === '' ? null : Number(tOut)
  if (outS !== null) {
    outS = Math.min(d, Math.max(inS + 0.1, outS))
    if (outS >= d) outS = null
  }
  const span = (outS === null ? d : outS) - inS
  return { tIn: inS, tOut: outS, fade: Math.min(Math.max(0, Number(fade) || 0), span / 2) }
}

// ── Copy style ─────────────────────────────────────────────────────────────
// What Canva's paint roller carries: appearance, never geometry. Position,
// size and rotation are deliberately absent — "make this look like that" is
// not "put this where that is", and copying a position would make the feature
// unusable for the thing it's actually for.
//
// The style is applied as the INTERSECTION of what the source carries and what
// the target type understands, so copying a heading onto a rectangle transfers
// the transparency and nothing nonsensical, rather than refusing outright.
export const STYLE_KEYS = {
  text: ['family', 'weight', 'size', 'color', 'align', 'lineHeight', 'tracking', 'italic',
    'underline', 'strike', 'uppercase', 'anchor', 'shadow', 'effect', 'effectColor',
    'effectIntensity', 'bgColor', 'opacity'],
  image: ['cornerRadius', 'opacity'],
  rect: ['fill', 'stroke', 'strokeWidth', 'dashStyle', 'cornerRadius', 'opacity'],
  ellipse: ['fill', 'stroke', 'strokeWidth', 'dashStyle', 'opacity'],
  polygon: ['fill', 'stroke', 'strokeWidth', 'dashStyle', 'opacity'],
  star: ['fill', 'stroke', 'strokeWidth', 'dashStyle', 'opacity'],
  line: ['stroke', 'strokeWidth', 'dashStyle', 'opacity'],
  arrow: ['stroke', 'strokeWidth', 'dashStyle', 'arrowStart', 'arrowEnd', 'opacity'],
}

export function pickStyle(layer) {
  const keys = STYLE_KEYS[layer.type] || []
  const style = {}
  for (const k of keys) if (layer[k] !== undefined) style[k] = layer[k]
  return style
}

export function styleFor(layer, style) {
  const allowed = new Set(STYLE_KEYS[layer.type] || [])
  const patch = {}
  for (const [k, v] of Object.entries(style || {})) if (allowed.has(k)) patch[k] = v
  return patch
}

// Old creative_versions.overlay_state rows only ever had { boxes, width,
// height } (plain text boxes, no `type` field, no shapes). Reopening one of
// those must not lose the text — each box becomes a layer with type:'text'.
// Already-migrated documents pass straight through.
//
// `baseW`/`baseH` are the dimensions of the image actually loaded, and the
// document size is DERIVED from them and the crop rather than read back out of
// the saved state. Two reasons: a row saved before crop was state has no crop
// (so it's a full frame over an already-cropped plate, which is exactly right),
// and a stored width that disagreed with the image would otherwise put every
// layer in the wrong place with no way to notice.
// Bumped when the meaning of a saved field changes rather than its shape.
// v2 is "the base image is the untouched original": adjustments and crop are
// state that gets replayed, not pixels that were already applied.
export const DOC_VERSION = 2

export function migrateDocument(state, baseW, baseH) {
  const crop = normalizeCrop(state?.crop)
  const { width, height } = docSize(baseW, baseH, crop)

  // A pre-v2 row's saved base image ALREADY has its adjustments burned into
  // the pixels (that's what the old export wrote), and it also stored the
  // slider values. Replaying them would apply everything twice — reopen a row
  // saved at brightness +40 and the photo came back at +80 with the slider
  // still reading +40. The values are dropped for those rows: the adjustment
  // is in the image and can't be taken back out, so reporting zero is both
  // what the photo actually shows and the only honest thing the sliders can
  // say. Rows saved from here on carry the version and replay normally.
  const baked = state && !state.v
  const adjust = { ...DEFAULT_ADJUST, ...(baked ? null : state?.adjust) }

  // Absent on every document ever saved, and absent means the whole clip —
  // which is why this needed no version bump. Meaningless on a photo, where
  // nothing ever reads it.
  const trim = normalizeTrim(state?.trim)

  if (state && Array.isArray(state.layers)) {
    return { width, height, crop, trim, layers: state.layers.map(l => ({ ...l })), adjust }
  }
  if (state && Array.isArray(state.boxes)) {
    return { width, height, crop, trim, layers: state.boxes.map(b => newTextLayer({ ...b })), adjust }
  }
  return { width, height, crop, trim, layers: [], adjust: { ...DEFAULT_ADJUST } }
}

// ── Layer-list operations, all pure ────────────────────────────────────────

export function patchLayers(doc, patchesById) {
  return {
    ...doc,
    layers: doc.layers.map(l => (patchesById[l.id] ? { ...l, ...patchesById[l.id] } : l)),
  }
}

export function removeLayers(doc, ids) {
  const kill = new Set(ids)
  return { ...doc, layers: doc.layers.filter(l => !kill.has(l.id)) }
}

// Reordering with a multi-selection has one non-obvious requirement: the
// selected layers must keep their order RELATIVE TO EACH OTHER as the group
// moves. Walking the array in the direction of travel and swapping one
// unselected neighbour at a time does that for free, where a naive
// "swap every selected layer with its neighbour" would shuffle them.
export function reorderLayers(doc, ids, dir) {
  const sel = new Set(ids)
  const layers = [...doc.layers]
  if (dir > 0) {
    for (let i = layers.length - 2; i >= 0; i--) {
      if (sel.has(layers[i].id) && !sel.has(layers[i + 1].id)) {
        ;[layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]
      }
    }
  } else {
    for (let i = 1; i < layers.length; i++) {
      if (sel.has(layers[i].id) && !sel.has(layers[i - 1].id)) {
        ;[layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]
      }
    }
  }
  return { ...doc, layers }
}

export function sendToExtreme(doc, ids, dir) {
  const sel = new Set(ids)
  const picked = doc.layers.filter(l => sel.has(l.id))
  const rest = doc.layers.filter(l => !sel.has(l.id))
  return { ...doc, layers: dir > 0 ? [...rest, ...picked] : [...picked, ...rest] }
}

// A duplicate lands offset from its source, the way Canva's does, so it's
// visibly a second object rather than looking like nothing happened.
export const DUPLICATE_OFFSET = 0.03

export function duplicateLayer(layer, offset = DUPLICATE_OFFSET) {
  const copy = { ...layer, id: newId(layer.type[0]) }
  if (isPath(copy)) {
    copy.x1 += offset; copy.x2 += offset; copy.y1 += offset; copy.y2 += offset
  } else {
    copy.x += offset; copy.y += offset
  }
  return copy
}
