import { newTextBox } from '../../overlayModel'

// ─── Editor document model ─────────────────────────────────────────────────
// A document is { width, height, layers, adjust }:
//  · width/height — the CURRENT native pixel size (changes on crop).
//  · layers — z-ordered bottom-to-top. Every layer has
//    {id, type, visible, locked, opacity}; type is one of
//    'text' | 'image' | 'rect' | 'ellipse' | 'line' | 'arrow'.
//  · adjust — { brightness, contrast, saturation }, applied to the base photo
//    only (see adjust.js for the source-verified Konva filter ranges).
//
// EVERY geometric value is a FRACTION of the document (0–1), never a pixel —
// see overlayModel.js's header. That is the invariant that lets a 900px
// preview and a 4096px export agree by construction, and it applies to every
// layer type added here, image layers included.

export function newId(prefix = 'l') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function newTextLayer(overrides = {}) {
  return { ...newTextBox(), type: 'text', visible: true, locked: false, opacity: 1, ...overrides }
}

export function newShapeLayer(type, overrides = {}) {
  const base = {
    id: newId(type[0]), type, x: 0.3, y: 0.3, w: 0.3, h: 0.2,
    fill: type === 'line' || type === 'arrow' ? '' : '#d4af37',
    stroke: '#1a1410',
    strokeWidth: 0.006,          // a fraction of doc HEIGHT, like text size
    cornerRadius: 0, rotation: 0, opacity: 1, visible: true, locked: false,
  }
  if (type === 'line' || type === 'arrow') {
    return { ...base, x1: 0.25, y1: 0.5, x2: 0.6, y2: 0.5, stroke: '#d4af37', strokeWidth: 0.01, ...overrides }
  }
  return { ...base, ...overrides }
}

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

export function isShape(layer) {
  return layer && (layer.type === 'rect' || layer.type === 'ellipse')
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
  return l.type.charAt(0).toUpperCase() + l.type.slice(1)
}

export const DEFAULT_ADJUST = { brightness: 0, contrast: 0, saturation: 0 }

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
  rect: ['fill', 'stroke', 'strokeWidth', 'cornerRadius', 'opacity'],
  ellipse: ['fill', 'stroke', 'strokeWidth', 'opacity'],
  line: ['stroke', 'strokeWidth', 'opacity'],
  arrow: ['stroke', 'strokeWidth', 'opacity'],
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
export function migrateDocument(state, fallbackW, fallbackH) {
  if (state && Array.isArray(state.layers)) {
    return {
      width: state.width || fallbackW, height: state.height || fallbackH,
      layers: state.layers.map(l => ({ ...l })),
      adjust: { ...DEFAULT_ADJUST, ...(state.adjust || {}) },
    }
  }
  if (state && Array.isArray(state.boxes)) {
    return {
      width: state.width || fallbackW, height: state.height || fallbackH,
      layers: state.boxes.map(b => newTextLayer({ ...b })),
      adjust: { ...DEFAULT_ADJUST },
    }
  }
  return { width: fallbackW, height: fallbackH, layers: [], adjust: { ...DEFAULT_ADJUST } }
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
