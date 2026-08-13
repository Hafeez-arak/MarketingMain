import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Spinner } from '../../ui/index'
import { ensureFontsLoaded } from '../fonts'

import {
  migrateDocument, newTextLayer, newShapeLayer, newImageLayer,
  patchLayers, removeLayers, reorderLayers, sendToExtreme, duplicateLayer,
  pickStyle, styleFor, cropPx, docSize, normalizeCrop, isFullFrame, FULL_CROP, DOC_VERSION,
} from './model/document'
import {
  loadBaseCanvas, remapLayersForCrop, rotateCanvas90, flipCanvas,
  rotateCrop, flipCrop, rotateLayers90,
} from './model/transform'
import { makePreviewCanvas, cacheRatioFor, autoAdjust, applyPreset, DEFAULT_ADJUST } from './model/adjust'
import { exportDocument, exportOverlay } from './model/render'
import { Timeline } from './canvas/Timeline'
import { ensureLayerImages, loadLayerImage } from './model/imageCache'
import { clearTextBitmapCache } from './model/textBitmap'
import { layerRect, unionRect, translatePatch } from './model/geometry'
import { alignPatches, tidyUpPatches } from './model/align'
import { documentColorsOf, parseBrandColors, samplePhotoColors } from './model/palette'

import { useEditorHistory } from './useEditorHistory'
import { useZoomPan } from './useZoomPan'
import { useVideoPlayback } from './useVideoPlayback'
import { layerTiming, normalizeTrim, trimWindow } from './model/document'
import { EditorStage } from './canvas/EditorStage'
import { FloatingToolbar, InlineTextEditor, ContextMenu } from './canvas/Overlays'
import { TopToolbar } from './toolbar/TopToolbar'
import { SidePanel, InsertPanel, UploadsPanel, AdjustPanel, CropPanel, PositionPanel } from './panels/SidePanel'
import { StatusBar } from './StatusBar'

// ─── Photo editor ──────────────────────────────────────────────────────────
// The studio's "Open in editor". Konva under the hood, Canva's interaction
// model on top: a contextual toolbar above the canvas, an insert rail down the
// left, direct manipulation with snapping guides in the middle, and a status
// bar owning the zoom.
//
// This file is the orchestrator only — state, history, keyboard, and the
// wiring between them. Everything with real logic in it lives next door:
//   model/     document shape, geometry, text rasterising, align, snapping,
//              adjustments, export. No React in any of it.
//   canvas/    the Konva Stage and its nodes, plus the HTML overlays.
//   panels/    the side panel and its tabs.
//   toolbar/   the contextual toolbar.
//
// The invariant that everything else hangs off is in model/document.js: every
// geometric value is a FRACTION of the document, never a pixel. Pixels appear
// in exactly two places — the number fields the user types into, and the
// moment a Konva node is constructed — and both convert at the boundary.

const NUDGE_SMALL = 0.002
const NUDGE_LARGE = 0.02
const SIZE_STEP_PX = 2
const LINE_STEP = 0.05
const TRACK_STEP = 0.01

// ── Text formatting shortcuts ──────────────────────────────────────────────
// Returns true if the key was handled, so the caller knows to stop. Kept out
// of the component because it's a lookup table with no state of its own, and
// inside the component it would be forty lines of switch between two things
// that do belong there.
function textShortcut(e, key, layer, docH, apply) {
  const sizePx = layer.size * docH
  const done = patch => { e.preventDefault(); apply(patch); return true }

  if (e.shiftKey && !e.altKey) {
    switch (key) {
      case 's': return done({ strike: !layer.strike })
      case 'k': return done({ uppercase: !layer.uppercase })
      case 'l': return done({ align: 'left' })
      case 'c': return done({ align: 'center' })
      case 'r': return done({ align: 'right' })
      case ',': return done({ size: Math.max(0.005, (sizePx - SIZE_STEP_PX) / docH) })
      case '.': return done({ size: (sizePx + SIZE_STEP_PX) / docH })
      case 'h': return done({ anchor: 'top' })
      case 'm': return done({ anchor: 'middle' })
      case 'b': return done({ anchor: 'bottom' })
      default: return false
    }
  }

  if (e.altKey && !e.shiftKey) {
    switch (key) {
      case 'arrowup': return done({ lineHeight: Math.min(2.5, +(layer.lineHeight + LINE_STEP).toFixed(2)) })
      case 'arrowdown': return done({ lineHeight: Math.max(0.7, +(layer.lineHeight - LINE_STEP).toFixed(2)) })
      case ',': return done({ tracking: Math.max(-0.05, +((layer.tracking || 0) - TRACK_STEP).toFixed(3)) })
      case '.': return done({ tracking: Math.min(0.5, +((layer.tracking || 0) + TRACK_STEP).toFixed(3)) })
      default: return false
    }
  }

  if (!e.shiftKey && !e.altKey) {
    switch (key) {
      // Bold moves between two real weights rather than setting a flag, so it
      // and the weight menu can't disagree about what the layer is.
      case 'b': return done({ weight: layer.weight >= 700 ? 400 : 700 })
      case 'i': return done({ italic: !layer.italic })
      case 'u': return done({ underline: !layer.underline })
      default: return false
    }
  }
  return false
}

export function PhotoEditor({
  imageUrl, initialState, onSave, onCancel, saving = false,
  onUploadImage, imageLibrary = [],
  // Brand Brain's free-text "Brand Colours" field. Passed as written; the hex
  // codes are pulled out of the prose in model/palette.js.
  brandColorsText = '',
  // 'photo' (default) or 'video'. In video mode the thing on screen is frame
  // one of a clip, standing in for footage the editor cannot itself alter:
  // Save produces only the brand layer, and ffmpeg composites it over the real
  // clip. Crop and photo-adjust are hidden rather than disabled, because they
  // genuinely cannot apply to a composite and a control that silently does
  // nothing is worse than an absent one. Everything else — text, Arabic
  // shaping, fonts, shapes, logos, snapping, undo — is identical, which is the
  // whole reason this is a mode and not a second editor.
  mode = 'photo',
  duration = 5,
  // The clip itself, in video mode. `imageUrl` is still frame one and is still
  // what the document's geometry, palette and export are built against — this
  // is only what plays underneath. Absent, the editor behaves exactly as it
  // did before: a still with a timing strip.
  videoUrl = '',
}) {
  const isVideo = mode === 'video'
  const history = useEditorHistory()
  const { doc, base } = history

  const [rawSelectedIds, setSelectedIds] = useState([])
  const [tool, setTool] = useState('select')          // 'select' | 'crop'
  const [panel, setPanel] = useState('insert')
  const [cropRect, setCropRect] = useState(null)
  const [cropRatio, setCropRatio] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [interacting, setInteracting] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [fontEpoch, setFontEpoch] = useState(0)
  const [fontsReady, setFontsReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Height reserved for the contextual toolbar (see the band in the markup).
  // Latched to the tallest the toolbar has needed at this width rather than
  // hard-coded, because how many rows it wraps to depends on the window: a
  // fixed number would either clip controls in a narrow editor or waste canvas
  // in a wide one. The floor is three rows' worth, which is what a text
  // selection needs at normal widths — without it the first text selection of
  // each session would still shift the canvas once before the latch caught up,
  // which is the exact jump this exists to remove. Latching only ever grows,
  // so the canvas cannot move while a document is open; a width change resets
  // it, since the wrap count genuinely changes then and the editor is being
  // re-laid-out anyway.
  const TOOLBAR_FLOOR = 118
  const toolbarRef = useRef(null)
  const toolbarWidth = useRef(0)
  const [toolbarBand, setToolbarBand] = useState(TOOLBAR_FLOOR)
  // scrollHeight, not offsetHeight: the measured element is stretched to fill
  // the band, so its own box never reports the overflow — scrollHeight is what
  // still sees content that needs another row. For the same reason this runs
  // on every render rather than only from the observer: the observer watches
  // the box, and the box no longer changes when the selection changes what is
  // inside it. Two DOM reads per render, and setState with an equal value is a
  // no-op, so a stable toolbar costs one measurement and no re-render.
  const measureToolbar = useCallback(() => {
    const el = toolbarRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.scrollHeight
    if (w !== toolbarWidth.current) {
      toolbarWidth.current = w
      setToolbarBand(Math.max(TOOLBAR_FLOOR, h))
      return
    }
    setToolbarBand(prev => Math.max(prev, h))
  }, [])
  useLayoutEffect(measureToolbar)
  useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const ro = new ResizeObserver(measureToolbar)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureToolbar])

  // The clipboard is state rather than a ref because the context menu has to
  // grey out "Paste" when it's empty, and that's a render-time question.
  const [clipboard, setClipboard] = useState([])
  // Copy style is a two-step gesture, like Canva's paint roller: pick up a
  // style, then the next thing you click receives it. `painting` is the armed
  // state between those two clicks.
  const [styleClip, setStyleClip] = useState(null)
  const [painting, setPainting] = useState(false)
  // The Stage shows the PAGE normally and the WHOLE PHOTO while cropping (so
  // the frame can be dragged back out over the hidden parts), so the zoom has
  // to be framed against whichever of the two is on screen. Changing these
  // re-frames the view, which is exactly what entering crop should do.
  const cropping = tool === 'crop'
  const stageW = (cropping ? base?.width : doc?.width) || 0
  const stageH = (cropping ? base?.height : doc?.height) || 0
  // viewportRef is pulled out of the hook's return so it's an ordinary ref
  // binding at the point of use, rather than reached through an object.
  const { viewportRef, ...zoom } = useZoomPan(stageW, stageH)

  // ── Playback ────────────────────────────────────────────────────────────
  // Null on a photo, and every consumer treats null as "there is no time" —
  // so nothing about the image editor changes shape to accommodate this.
  //
  // The trim goes in RAW rather than resolved against the clip's length: only
  // the hook knows that length (it reads it off the media), so resolving it
  // out here would need the duration the hook is about to produce.
  const playback = useVideoPlayback(isVideo ? videoUrl : '', duration, isVideo ? doc?.trim : null)
  // The clip's real length wins over the requested one as soon as it reports
  // it. `duration` on the version row is what we ASKED the model for, rounded
  // to a string; Kling returning 10.0 when asked for 10 is luck, not a rule,
  // and a timeline drawn to the wrong length puts every cue in the wrong
  // place. Only the strip and the clamps use this — the export writes seconds,
  // and ffprobe has the last word at compose time regardless.
  const clipDuration = (isVideo && playback.duration) || duration

  // The trim resolved against that length — what the strip draws and what the
  // compose step is told to keep. Declared here because it needs nothing but
  // the duration; the SETTER lives further down, next to the other document
  // edits, because it needs applyDoc.
  const trim = useMemo(() => trimWindow(doc?.trim, clipDuration), [doc?.trim, clipDuration])

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    loadBaseCanvas(imageUrl)
      .then(async canvas => {
        if (cancelled) return
        const next = migrateDocument(initialState, canvas.width, canvas.height)
        // Image layers point at URLs; resolve them before the first paint so
        // reopening a document doesn't flash an empty canvas.
        await ensureLayerImages(next.layers)
        if (cancelled) return
        history.reset({ doc: next, base: canvas })
        setLoading(false)
      })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [imageUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtering the native-resolution photo on every slider frame is what made
  // the old Adjust panel stutter; the live Stage draws this downscaled copy
  // instead. See model/adjust.js for why that's safe, and why the export
  // still uses `base`.
  const previewCanvas = useMemo(() => makePreviewCanvas(base), [base])
  const cacheRatio = useMemo(() => cacheRatioFor(previewCanvas, base), [previewCanvas, base])
  // The base image's own dimensions plus where the committed crop sits on it,
  // which is everything the Stage needs to draw either view.
  const baseSize = useMemo(() => (base ? {
    width: base.width, height: base.height,
    crop: cropPx(base.width, base.height, doc?.crop),
  } : { width: 0, height: 0, crop: { x: 0, y: 0, width: 0, height: 0 } }), [base, doc?.crop])

  const textLayers = useMemo(() => (doc ? doc.layers.filter(l => l.type === 'text') : []), [doc])
  const fontSignature = textLayers.map(l => `${l.family}:${l.weight}`).join('|')
  useEffect(() => {
    let cancelled = false
    ensureFontsLoaded(textLayers).then(() => {
      if (cancelled) return
      // Anything rasterised while the face was still loading was drawn in a
      // fallback — most visibly, Arabic comes out unshaped. Drop those and
      // bump the epoch so every text node rebuilds.
      clearTextBitmapCache()
      setFontEpoch(e => e + 1)
      setFontsReady(true)
    })
    return () => { cancelled = true }
  }, [fontSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection ───────────────────────────────────────────────────────────
  const selection = useMemo(
    () => (doc ? doc.layers.filter(l => rawSelectedIds.includes(l.id)) : []),
    [doc, rawSelectedIds],
  )
  // An undo can remove a layer whose id is still in the raw selection state,
  // so what the rest of the editor uses is DERIVED from the document rather
  // than pruned by an effect — no cascading render, and a redo that brings
  // the layer back re-selects it for free.
  const selectedIds = useMemo(() => selection.map(l => l.id), [selection])
  const single = selection.length === 1 ? selection[0] : null
  const editingSingle = !!editingId && single?.id === editingId

  // ── Document edits ──────────────────────────────────────────────────────
  const applyDoc = history.applyDoc
  const commitDoc = history.commitDoc
  const begin = history.begin

  const patchSelected = useCallback(patch => {
    applyDoc(d => patchLayers(d, Object.fromEntries(selectedIds.map(id => [id, patch]))))
  }, [applyDoc, selectedIds])

  // `applyDoc` rather than `commitDoc`, with `begin()` fired once at
  // pointerdown, so a whole drag of a trim handle is one undo step and not
  // forty.
  const setTrim = useCallback(next => {
    applyDoc(d => {
      const t = normalizeTrim(next)
      // Clamped here rather than in the gesture so a handle dragged past the
      // far end of the clip, or past its opposite number, stops at something
      // real. 0.1s is the same floor clampTiming uses for a layer.
      const start = Math.min(Math.max(0, t.start), Math.max(0, clipDuration - 0.1))
      const end = t.end === null ? null : Math.min(Math.max(t.end, start + 0.1), clipDuration)
      // Stored as null rather than the exact length once it reaches the end,
      // for the same reason `tOut` is: it keeps meaning "all of it" if the
      // clip is ever re-rendered at a different length.
      return { ...d, trim: { start, end: end !== null && end >= clipDuration - 0.001 ? null : end } }
    })
  }, [applyDoc, clipDuration])

  const addLayer = useCallback(layer => {
    commitDoc(d => ({ ...d, layers: [...d.layers, layer] }))
    setSelectedIds([layer.id])
    setTool('select')
  }, [commitDoc])

  const addText = useCallback((overrides = {}) => {
    if (!doc) return
    // Stagger new boxes so a second one doesn't land exactly on the first.
    addLayer(newTextLayer({ y: 0.08 + (doc.layers.length % 6) * 0.09, ...overrides }))
  }, [doc, addLayer])

  const addShape = useCallback(type => addLayer(newShapeLayer(type)), [addLayer])

  const addImage = useCallback(async url => {
    const img = await loadLayerImage(url)
    if (!img) { setError('That image could not be loaded.'); return }
    const ratio = img.naturalWidth / img.naturalHeight
    addLayer(newImageLayer(url, { naturalRatio: ratio }))
  }, [addLayer])

  const deleteSelected = useCallback((ids = selectedIds) => {
    if (!ids.length) return
    commitDoc(d => removeLayers(d, ids))
    setSelectedIds([])
  }, [commitDoc, selectedIds])

  const duplicateSelected = useCallback((ids = selectedIds) => {
    if (!doc || !ids.length) return
    const copies = doc.layers.filter(l => ids.includes(l.id)).map(l => duplicateLayer(l))
    commitDoc(d => ({ ...d, layers: [...d.layers, ...copies] }))
    setSelectedIds(copies.map(c => c.id))
  }, [doc, commitDoc, selectedIds])

  // ⌥-drag's in-place clone: copies land directly under their originals, and
  // the originals are what keeps moving (see EditorStage's handleDragStart).
  const cloneInPlace = useCallback(ids => {
    commitDoc(d => {
      const out = []
      for (const l of d.layers) {
        if (ids.includes(l.id)) out.push(duplicateLayer(l, 0))
        out.push(l)
      }
      return { ...d, layers: out }
    })
  }, [commitDoc])

  const toggleLock = useCallback((ids = selectedIds) => {
    if (!doc || !ids.length) return
    const anyUnlocked = doc.layers.some(l => ids.includes(l.id) && !l.locked)
    commitDoc(d => patchLayers(d, Object.fromEntries(ids.map(id => [id, { locked: anyUnlocked }]))))
  }, [doc, commitDoc, selectedIds])

  const toggleVisible = useCallback(id => {
    commitDoc(d => patchLayers(d, { [id]: { visible: d.layers.find(l => l.id === id)?.visible === false } }))
  }, [commitDoc])

  const order = useCallback((dir, id) => {
    const ids = id ? [id] : selectedIds
    if (!ids.length) return
    commitDoc(d => reorderLayers(d, ids, dir))
  }, [commitDoc, selectedIds])

  const orderExtreme = useCallback(dir => {
    if (!selectedIds.length) return
    commitDoc(d => sendToExtreme(d, selectedIds, dir))
  }, [commitDoc, selectedIds])

  const align = useCallback(mode => {
    if (!selectedIds.length) return
    commitDoc(d => patchLayers(d, alignPatches(d, selectedIds, mode)))
  }, [commitDoc, selectedIds])

  const tidyUp = useCallback(() => {
    if (selectedIds.length < 3) return
    commitDoc(d => patchLayers(d, tidyUpPatches(d, selectedIds)))
  }, [commitDoc, selectedIds])

  const nudge = useCallback((dx, dy) => {
    if (!selectedIds.length) return
    begin()
    applyDoc(d => patchLayers(d, Object.fromEntries(
      d.layers
        .filter(l => selectedIds.includes(l.id) && !l.locked)
        .map(l => [l.id, translatePatch(l, dx, dy)]),
    )))
  }, [begin, applyDoc, selectedIds])

  // ── Copy style ──────────────────────────────────────────────────────────
  const copyStyle = useCallback(() => {
    if (!single) return
    setStyleClip(pickStyle(single))
    setPainting(true)
  }, [single])

  // Every selection change runs through here so the armed painter can consume
  // it. Putting it on selection rather than on a click means it works from the
  // canvas and from the Layers list alike.
  const handleSelectionChange = useCallback(ids => {
    setSelectedIds(ids)
    // Moving the selection ends any inline text edit. Without this the id
    // lingers, and since the node it names is hidden while it's being edited,
    // that layer stays invisible on the canvas forever.
    setEditingId(id => (id && (ids.length !== 1 || ids[0] !== id) ? null : id))

    // ── Selecting a layer that isn't on screen yet moves the playhead to it ──
    // Out-of-range layers are genuinely absent from the canvas, because that
    // is what the render does with them. Without this you could select a
    // headline from the timeline, see nothing appear, and have no way to edit
    // it. Seeking to its first frame is what every editor does and it makes
    // the rule "what you see is what composites" survivable.
    if (isVideo && ids.length === 1 && !playback.playing) {
      const layer = doc?.layers.find(l => l.id === ids[0])
      if (layer) {
        const { tIn, tOut } = layerTiming(layer)
        const t = playback.timeRef.current
        if (t < tIn || (tOut !== null && t > tOut)) playback.seek(tIn)
      }
    }

    if (!painting || !styleClip || ids.length !== 1) return
    setPainting(false)
    commitDoc(d => {
      const target = d.layers.find(l => l.id === ids[0])
      if (!target) return d
      return patchLayers(d, { [target.id]: styleFor(target, styleClip) })
    })
  }, [painting, styleClip, commitDoc, isVideo, doc, playback])

  // ── Clipboard ───────────────────────────────────────────────────────────
  // Editor-local, not the system clipboard: what's being copied is a layer
  // object (fonts, fractions, z-order), which has no meaningful text/plain or
  // image/png representation to hand to the OS.
  const copySelected = useCallback(() => {
    if (!doc || !selectedIds.length) return
    setClipboard(doc.layers.filter(l => selectedIds.includes(l.id)).map(l => ({ ...l })))
  }, [doc, selectedIds])

  const pasteClipboard = useCallback(() => {
    if (!clipboard.length) return
    const copies = clipboard.map(l => duplicateLayer(l))
    // Successive pastes step further away instead of stacking invisibly.
    setClipboard(copies.map(c => ({ ...c })))
    commitDoc(d => ({ ...d, layers: [...d.layers, ...copies] }))
    setSelectedIds(copies.map(c => c.id))
  }, [clipboard, commitDoc])

  // ── Crop ────────────────────────────────────────────────────────────────
  // The crop rect lives in BASE-IMAGE pixels for the whole gesture, because
  // that's the frame the crop UI works in (it shows the whole photo, including
  // what the current crop hides). It only becomes fractions on apply.
  const startCrop = useCallback(() => {
    if (!doc || !base) return
    setTool('crop'); setPanel('crop'); setSelectedIds([]); setCropRatio(null)
    // Opens on the CURRENT crop rather than an arbitrary inset, so entering
    // crop a second time continues from where you left it instead of throwing
    // the previous framing away.
    const c = cropPx(base.width, base.height, doc.crop)
    setCropRect({ x: c.x, y: c.y, w: c.width, h: c.height })
  }, [doc, base])

  const cancelCrop = useCallback(() => { setTool('select'); setPanel('insert'); setCropRect(null) }, [])

  // A ratio preset keeps the crop centred on what it already framed and grows
  // it to the largest box of that shape that still fits the photo — which is
  // what "switch to 1:1" is asking for, rather than a reset to the middle.
  const applyCropRatio = useCallback(ratio => {
    setCropRatio(ratio)
    if (!ratio || !base || !cropRect) return
    const cx = cropRect.x + cropRect.w / 2, cy = cropRect.y + cropRect.h / 2
    let w = Math.min(base.width, cropRect.w)
    let h = w / ratio
    if (h > base.height) { h = base.height; w = h * ratio }
    setCropRect({
      w, h,
      x: Math.min(Math.max(0, cx - w / 2), base.width - w),
      y: Math.min(Math.max(0, cy - h / 2), base.height - h),
    })
  }, [base, cropRect])

  // Non-destructive: the base canvas is untouched and only the window onto it
  // moves, so a crop can be widened, narrowed or reset at any point — this
  // session or a later one (see render.js on the clean plate).
  const commitCrop = useCallback(nextCrop => {
    if (!base) return
    const to = normalizeCrop(nextCrop)
    history.commit(s => {
      const from = normalizeCrop(s.doc.crop)
      return {
        ...s,
        doc: {
          ...s.doc,
          ...docSize(base.width, base.height, to),
          crop: to,
          layers: remapLayersForCrop(s.doc.layers, base.width, base.height, from, to),
        },
      }
    })
  }, [base, history])

  const applyCrop = useCallback(() => {
    if (!base || !cropRect) return
    commitCrop({
      x: cropRect.x / base.width, y: cropRect.y / base.height,
      w: cropRect.w / base.width, h: cropRect.h / base.height,
    })
    setTool('select'); setPanel('insert'); setCropRect(null)
  }, [base, cropRect, commitCrop])

  const resetCrop = useCallback(() => {
    if (!base) return
    commitCrop(FULL_CROP)
    setCropRect({ x: 0, y: 0, w: base.width, h: base.height })
    setCropRatio(null)
  }, [base, commitCrop])

  // ── Rotate / flip the photo ─────────────────────────────────────────────
  // No longer gated to an empty document. A 90° turn moves the page under
  // everything on it, so each layer's pivot is transformed and 90° is added to
  // its own rotation — exact even for a layer that was already rotated (see
  // transform.js). A flip is different in kind: it mirrors the PHOTO, and
  // mirroring the text on top of it would be nonsense, so the layers are
  // deliberately left where they are and only the crop window follows.
  const rotate = useCallback(clockwise => {
    if (!base) return
    const nextCanvas = rotateCanvas90(base, clockwise)
    history.commit(s => {
      const nextCrop = normalizeCrop(rotateCrop(s.doc.crop, clockwise))
      const size = docSize(nextCanvas.width, nextCanvas.height, nextCrop)
      return {
        base: nextCanvas,
        doc: {
          ...s.doc, ...size, crop: nextCrop,
          layers: rotateLayers90(s.doc.layers, s.doc.width, s.doc.height, clockwise),
        },
      }
    })
  }, [base, history])

  const flip = useCallback(axis => {
    if (!base) return
    const nextCanvas = flipCanvas(base, axis)
    history.commit(s => ({
      base: nextCanvas,
      doc: { ...s.doc, crop: normalizeCrop(flipCrop(s.doc.crop, axis)) },
    }))
  }, [base, history])

  // ── Adjustments ─────────────────────────────────────────────────────────
  const setAdjust = useCallback((key, value) => {
    applyDoc(d => ({ ...d, adjust: { ...d.adjust, [key]: value } }))
  }, [applyDoc])

  const resetAdjust = useCallback(() => {
    commitDoc(d => ({ ...d, adjust: { ...DEFAULT_ADJUST } }))
  }, [commitDoc])

  const setPreset = useCallback(id => {
    commitDoc(d => ({ ...d, adjust: applyPreset(id) }))
  }, [commitDoc])

  // Auto reads the histogram of what's actually FRAMED, not of the whole
  // photo — auto-adjusting a tight crop of a dark corner should balance that
  // corner, not the bright scene it was cut out of.
  const autoAdjustNow = useCallback(() => {
    if (!base || !doc) return
    const c = cropPx(base.width, base.height, doc.crop)
    let source = base
    if (!isFullFrame(doc.crop)) {
      const cut = document.createElement('canvas')
      cut.width = Math.max(1, Math.round(c.width))
      cut.height = Math.max(1, Math.round(c.height))
      cut.getContext('2d').drawImage(base, c.x, c.y, c.width, c.height, 0, 0, cut.width, cut.height)
      source = cut
    }
    const next = autoAdjust(source)
    if (!next) { setError('Auto-adjust could not read this image.'); return }
    commitDoc(d => ({ ...d, adjust: { ...d.adjust, ...next } }))
  }, [base, doc, commitDoc])

  // ── Keyboard ────────────────────────────────────────────────────────────
  // Canva's shortcut set, minus the features we don't have. Inert while any
  // field has focus — including the inline text editor — so typing "t" or
  // Backspace is never read as a command.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return
      if (!doc) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const stop = () => e.preventDefault()

      // ── Transport ──
      // Space plays, as it does in every editor. It comes before everything
      // else because a space is never an insert shortcut and never a
      // modifier combination, and because a play button you have to reach for
      // with the mouse is the difference between checking your timing twice
      // and checking it once.
      if (isVideo && key === ' ' && !mod) {
        stop()
        playback.toggle()
        return
      }
      // Arrow keys nudge the SELECTION when there is one and step the
      // PLAYHEAD when there isn't — the same split Canva uses, and the reason
      // the nudge branch further down is guarded on a selection existing.
      if (isVideo && !mod && !selectedIds.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        stop()
        const step = e.shiftKey ? 1 : 1 / 30
        playback.seek(playback.timeRef.current + (e.key === 'ArrowLeft' ? -step : step))
        return
      }

      if (key === 'escape') {
        stop()
        if (painting) setPainting(false)
        else if (tool === 'crop') cancelCrop()
        else if (editingId) setEditingId(null)
        else setSelectedIds([])
        return
      }

      // Text formatting, Canva's bindings. Checked before the general
      // modifier switch so ⇧⌘C means "centre this text" while ⌘C still means
      // copy, and so ⌘B is free to mean bold only when text is selected.
      if (mod && single?.type === 'text' && textShortcut(e, key, single, doc.height, patch => { begin(); patchSelected(patch) })) {
        return
      }

      if (mod) {
        switch (key) {
          case 'z': stop(); e.shiftKey ? history.redo() : history.undo(); return
          case 'y': stop(); history.redo(); return
          case 'a': stop(); setSelectedIds(doc.layers.filter(l => l.visible !== false).map(l => l.id)); return
          case 'd': stop(); duplicateSelected(); return
          case 'c': stop(); copySelected(); return
          case 'x': stop(); copySelected(); deleteSelected(); return
          case 'v': stop(); pasteClipboard(); return
          case ']': stop(); e.altKey ? orderExtreme(1) : order(1); return
          case '[': stop(); e.altKey ? orderExtreme(-1) : order(-1); return
          case '=': case '+': stop(); zoom.zoomBy(1.2); return
          case '-': stop(); zoom.zoomBy(1 / 1.2); return
          case '0':
            stop()
            if (e.altKey) zoom.zoomToFit()
            else if (e.shiftKey) zoom.zoomToFill()
            else zoom.zoomToActual()
            return
          default: break
        }
        return
      }

      if (e.altKey && e.shiftKey && key === 't') { stop(); tidyUp(); return }
      if (e.altKey && e.shiftKey && key === 'l') { stop(); toggleLock(); return }

      // Single-key insert, exactly as Canva binds them.
      if (!e.altKey && !e.shiftKey) {
        if (key === 't') { stop(); addText(); return }
        if (key === 'r') { stop(); addShape('rect'); return }
        if (key === 'c') { stop(); addShape('ellipse'); return }
        if (key === 'l') { stop(); addShape('line'); return }
      }

      if (!selectedIds.length) return

      if (key === 'delete' || key === 'backspace') { stop(); deleteSelected(); return }
      if (e.key.startsWith('Arrow')) {
        stop()
        const step = e.shiftKey ? NUDGE_LARGE : NUDGE_SMALL
        nudge(
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        )
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [doc, tool, editingId, selectedIds, single, painting, history, zoom, addText, addShape, cancelCrop,
      duplicateSelected, deleteSelected, copySelected, pasteClipboard, order, orderExtreme,
      tidyUp, toggleLock, nudge, begin, patchSelected, isVideo, playback])

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSave() {
    setError('')
    try {
      if (isVideo) {
        // No composite and no clean plate: the footage is the plate, and it
        // stays in storage untouched so the next wording change re-composites
        // from the original rather than stacking on the last render.
        const { overlays, width, height } = await exportOverlay(base, doc)
        const res = await onSave({ overlays, state: { ...doc, width, height, v: DOC_VERSION } })
        if (res?.error) setError(res.error)
        return
      }
      const { compositeBlob, textLayerBlob, cleanBlob, width, height } = await exportDocument(base, doc)
      // `v` marks this state as one whose clean plate is the UNTOUCHED photo,
      // so the adjustments and crop stored beside it are replayed rather than
      // applied a second time on top of pixels that already have them. See
      // migrateDocument.
      const result = await onSave({
        compositeBlob, textLayerBlob, cleanBlob,
        state: { ...doc, width, height, v: DOC_VERSION },
      })
      if (result?.error) setError(result.error)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  // ── Derived UI values ───────────────────────────────────────────────────
  const selectionBox = useMemo(() => {
    if (!doc || !selection.length) return null
    return unionRect(selection.map(l => layerRect(l, doc.width, doc.height)))
  }, [doc, selection])

  // The colour panel's sourced groups — Canva's model, see model/palette.js.
  // Split into three memos rather than one because they change on completely
  // different clocks: the document group on every layer edit, the photo group
  // only when the base image itself is replaced (a crop, a rotate), and the
  // brand group essentially never.
  const photoColors = useMemo(() => samplePhotoColors(base), [base])
  const brandColors = useMemo(() => parseBrandColors(brandColorsText), [brandColorsText])
  const palette = useMemo(() => ({
    document: documentColorsOf(doc),
    photo: photoColors,
    brand: brandColors,
    recent: [],   // read from the store by the field itself, so it stays live
  }), [doc, photoColors, brandColors])

  const contextItems = useMemo(() => {
    if (!contextMenu) return []
    const hasSelection = selectedIds.length > 0
    return [
      { label: 'Copy', hint: '⌘C', disabled: !hasSelection, onClick: copySelected },
      { label: 'Paste', hint: '⌘V', disabled: !clipboard.length, onClick: pasteClipboard },
      { label: 'Duplicate', hint: '⌘D', disabled: !hasSelection, onClick: () => duplicateSelected() },
      { separator: true },
      { label: 'Bring forward', hint: '⌘]', disabled: !hasSelection, onClick: () => order(1) },
      { label: 'Send backward', hint: '⌘[', disabled: !hasSelection, onClick: () => order(-1) },
      { label: 'Bring to front', hint: '⌥⌘]', disabled: !hasSelection, onClick: () => orderExtreme(1) },
      { label: 'Send to back', hint: '⌥⌘[', disabled: !hasSelection, onClick: () => orderExtreme(-1) },
      { separator: true },
      { label: selection.every(l => l.locked) && hasSelection ? 'Unlock' : 'Lock', hint: '⌥⇧L', disabled: !hasSelection, onClick: () => toggleLock() },
      { label: 'Delete', hint: '⌫', danger: true, disabled: !hasSelection, onClick: () => deleteSelected() },
    ]
  }, [contextMenu, selectedIds, selection, clipboard, copySelected, pasteClipboard, duplicateSelected, order, orderExtreme, toggleLock, deleteSelected])

  if (loading || !doc || !base) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        {error ? <p className="text-sm text-red-600">{error}</p> : <Spinner />}
      </div>
    )
  }

  const hint = painting
    ? 'Click the layer you want this style painted onto — Esc to cancel.'
    : tool === 'crop'
    ? 'Drag the corners to resize the crop, drag inside to move it.'
    : editingSingle
      ? 'Type your text, then click away or press Esc to finish.'
      : selection.length > 1
        ? 'Drag to move them together, or align them from Position.'
        : 'Click to select · double-click text to edit · ⌥-drag to duplicate · space-drag or scroll to pan'

  return (
    <div className="flex h-[82vh] flex-col">
      <div className="flex min-h-0 flex-1">
        {/* ── Left rail + panel ── */}
        <SidePanel panel={panel} hide={isVideo ? ['adjust'] : []}
          onOpenPanel={p => { if (p !== 'crop' && tool === 'crop') cancelCrop(); setPanel(p) }}>
          {panel === 'insert' && <InsertPanel onAddText={addText} onAddShape={addShape} />}
          {panel === 'uploads' && (
            <UploadsPanel onUploadImage={onUploadImage} onAddImage={addImage} library={imageLibrary} />
          )}
          {panel === 'adjust' && !isVideo && (
            <AdjustPanel adjust={doc.adjust} onBeginChange={begin}
              onChange={setAdjust} onResetAll={resetAdjust}
              onPreset={setPreset} onAuto={autoAdjustNow} />
          )}
          {panel === 'crop' && !isVideo && (
            <CropPanel base={base} cropRect={cropRect} crop={doc.crop} ratio={cropRatio}
              onSetRatio={applyCropRatio} onApply={applyCrop} onCancel={cancelCrop} onReset={resetCrop} />
          )}
          {panel === 'position' && (
            <PositionPanel doc={doc} selection={selection} selectedIds={selectedIds}
              onAlign={align} onTidyUp={tidyUp} onOrder={order} onOrderExtreme={orderExtreme}
              onPatch={patchSelected} onBeginChange={begin}
              onSelect={(id, additive) => handleSelectionChange(
                additive
                  ? (selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
                  : [id],
              )}
              onToggleVisible={toggleVisible} onToggleLock={id => toggleLock([id])} onDelete={id => deleteSelected([id])} />
          )}
        </SidePanel>

        {/* ── Toolbar + canvas + status ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          {/* The toolbar is contextual, so its height follows the selection —
              one row for the photo, three for a text layer. As a plain flex
              sibling of the canvas that difference (measured: 46px against
              118px) pushed the viewport 72px down and took 72px off its height
              on every click on or off a layer. useZoomPan deliberately does
              NOT re-fit on a resize — a window resize must not throw away your
              zoom — so the artwork stayed pinned to the viewport's top-left
              and visibly jumped down the screen each time, which is what read
              as the canvas moving and everything on it re-aligning.
              Reserving the band fixes it at the layout level: the viewport
              below is the same size whatever is selected, so nothing it
              contains can move. */}
          <div className="shrink-0 overflow-hidden" style={{ height: toolbarBand }}>
            <div ref={toolbarRef} className="h-full">
              <TopToolbar doc={doc} selection={selection} tool={tool} panel={panel}
                canUndo={history.canUndo} canRedo={history.canRedo} onUndo={history.undo} onRedo={history.redo}
                onPatch={patchSelected} onBeginChange={begin} onOpenPanel={setPanel}
                // Crop, rotate and flip all reframe the PHOTO, and in video
                // mode the photo is only a stand-in for footage this editor
                // never touches — the clip is reframed by the compose step's
                // centre-crop instead. Withheld rather than wired to a no-op.
                onRotate={isVideo ? undefined : rotate}
                onFlip={isVideo ? undefined : flip}
                onStartCrop={isVideo ? undefined : startCrop}
                onCopyStyle={copyStyle} painting={painting}
                palette={palette} isVideo={isVideo} />
            </div>
          </div>

          <div ref={viewportRef}
            className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#f4f4f5_0_25%,#fff_0_50%)] bg-[length:20px_20px]"
            onContextMenu={e => e.preventDefault()}>
            {!fontsReady && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Spinner /></div>
            )}

            {zoom.viewport.w > 0 && (
              <EditorStage
                doc={doc} previewCanvas={previewCanvas} cacheRatio={cacheRatio} baseSize={baseSize}
                zoom={zoom} epoch={fontEpoch}
                selectedIds={selectedIds} onSelectionChange={handleSelectionChange}
                onBeginChange={begin} onApplyDoc={applyDoc} onCloneInPlace={cloneInPlace}
                tool={tool} cropRect={cropRect} cropRatio={cropRatio} onCropRect={setCropRect}
                // The EFFECTIVE id, not the raw one: a text node is hidden
                // while its inline editor covers it, so passing an id whose
                // editor isn't actually open would hide that layer for good.
                editingId={editingSingle ? editingId : null} onEditStart={setEditingId}
                onInteractingChange={setInteracting}
                playback={isVideo ? playback : null} time={playback.time}
                onContextMenu={(e, layerId) => {
                  if (layerId && !selectedIds.includes(layerId)) setSelectedIds([layerId])
                  const rect = zoom.getViewportRect()
                  setContextMenu({
                    x: e.evt.clientX - (rect?.left || 0),
                    y: e.evt.clientY - (rect?.top || 0),
                  })
                }}
              />
            )}

            {/* The action pill hides for the duration of a drag or resize
                rather than visibly lagging behind a shape it isn't tracking
                frame by frame. */}
            {selectionBox && !interacting && !editingSingle && tool === 'select' && (
              <FloatingToolbar box={selectionBox} toScreen={zoom.toScreen} scale={zoom.view.scale}
                locked={selection.every(l => l.locked)} multiple={selection.length > 1}
                canForward={doc.layers.findIndex(l => l.id === selection[selection.length - 1].id) < doc.layers.length - 1}
                canBackward={doc.layers.findIndex(l => l.id === selection[0].id) > 0}
                onDuplicate={() => duplicateSelected()} onDelete={() => deleteSelected()}
                onToggleLock={() => toggleLock()} onForward={() => order(1)} onBackward={() => order(-1)}
                onMore={() => setPanel('position')} />
            )}

            {editingSingle && single?.type === 'text' && (
              <InlineTextEditor layer={single} W={doc.width} H={doc.height}
                scale={zoom.view.scale} toScreen={zoom.toScreen}
                onChange={patch => { begin(); patchSelected(patch) }}
                onClose={() => setEditingId(null)} />
            )}

            {contextMenu && (
              <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={() => setContextMenu(null)} />
            )}
          </div>

          <StatusBar doc={doc} view={zoom.view} zoom={zoom} layerCount={doc.layers.length} hint={hint} />

          {/* Under the canvas, above the footer: the strip is about the
              artwork, so it belongs with the artwork rather than in the
              Save/Cancel band. */}
          {isVideo && (
            <Timeline
              doc={doc} duration={clipDuration} selectedIds={selectedIds}
              playback={playback} trim={trim}
              onSelect={id => handleSelectionChange([id])}
              onBegin={begin}
              onPatchLayer={(id, timing) => applyDoc(d => patchLayers(d, { [id]: timing }))}
              onTrim={setTrim}
            />
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        {error && <p className="flex-1 truncate text-xs text-red-600">{error}</p>}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !fontsReady}>
          {saving ? <><Spinner size="sm" /> Saving…</> : 'Save'}
        </Button>
      </div>
    </div>
  )
}
