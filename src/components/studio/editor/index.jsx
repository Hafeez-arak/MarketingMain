import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Spinner } from '../../ui/index'
import { ensureFontsLoaded } from '../fonts'

import {
  migrateDocument, newTextLayer, newShapeLayer, newImageLayer,
  patchLayers, removeLayers, reorderLayers, sendToExtreme, duplicateLayer,
  pickStyle, styleFor,
} from './model/document'
import { loadBaseCanvas, cropCanvas, remapLayersAfterCrop, rotateCanvas90, flipCanvas } from './model/transform'
import { makePreviewCanvas } from './model/adjust'
import { exportDocument } from './model/render'
import { ensureLayerImages, loadLayerImage } from './model/imageCache'
import { clearTextBitmapCache } from './model/textBitmap'
import { layerRect, unionRect, translatePatch } from './model/geometry'
import { alignPatches, tidyUpPatches } from './model/align'

import { useEditorHistory } from './useEditorHistory'
import { useZoomPan } from './useZoomPan'
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
}) {
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

  // The clipboard is state rather than a ref because the context menu has to
  // grey out "Paste" when it's empty, and that's a render-time question.
  const [clipboard, setClipboard] = useState([])
  // Copy style is a two-step gesture, like Canva's paint roller: pick up a
  // style, then the next thing you click receives it. `painting` is the armed
  // state between those two clicks.
  const [styleClip, setStyleClip] = useState(null)
  const [painting, setPainting] = useState(false)
  // viewportRef is pulled out of the hook's return so it's an ordinary ref
  // binding at the point of use, rather than reached through an object.
  const { viewportRef, ...zoom } = useZoomPan(doc?.width || 0, doc?.height || 0)

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
    if (!painting || !styleClip || ids.length !== 1) return
    setPainting(false)
    commitDoc(d => {
      const target = d.layers.find(l => l.id === ids[0])
      if (!target) return d
      return patchLayers(d, { [target.id]: styleFor(target, styleClip) })
    })
  }, [painting, styleClip, commitDoc])

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
  const startCrop = useCallback(() => {
    if (!doc) return
    setTool('crop'); setPanel('crop'); setSelectedIds([]); setCropRatio(null)
    const margin = 0.08
    setCropRect({
      x: doc.width * margin, y: doc.height * margin,
      w: doc.width * (1 - margin * 2), h: doc.height * (1 - margin * 2),
    })
  }, [doc])

  const cancelCrop = useCallback(() => { setTool('select'); setPanel('insert'); setCropRect(null) }, [])

  // A ratio preset keeps the crop centred on what it already framed and grows
  // it to the largest box of that shape that still fits the photo — which is
  // what "switch to 1:1" is asking for, rather than a reset to the middle.
  const applyCropRatio = useCallback(ratio => {
    setCropRatio(ratio)
    if (!ratio || !doc || !cropRect) return
    const cx = cropRect.x + cropRect.w / 2, cy = cropRect.y + cropRect.h / 2
    let w = Math.min(doc.width, cropRect.w)
    let h = w / ratio
    if (h > doc.height) { h = doc.height; w = h * ratio }
    setCropRect({
      w, h,
      x: Math.min(Math.max(0, cx - w / 2), doc.width - w),
      y: Math.min(Math.max(0, cy - h / 2), doc.height - h),
    })
  }, [doc, cropRect])

  const applyCrop = useCallback(() => {
    if (!doc || !base || !cropRect) return
    const oldW = doc.width, oldH = doc.height
    const crop = {
      x: Math.max(0, cropRect.x), y: Math.max(0, cropRect.y),
      w: Math.min(oldW - cropRect.x, cropRect.w), h: Math.min(oldH - cropRect.y, cropRect.h),
    }
    const nextCanvas = cropCanvas(base, crop)
    history.commit(s => ({
      base: nextCanvas,
      doc: {
        ...s.doc, width: nextCanvas.width, height: nextCanvas.height,
        layers: remapLayersAfterCrop(s.doc.layers, oldW, oldH, crop, nextCanvas.width, nextCanvas.height),
      },
    }))
    setTool('select'); setPanel('insert'); setCropRect(null)
  }, [doc, base, cropRect, history])

  // ── Rotate / flip the photo ─────────────────────────────────────────────
  const canRotate = !!doc && doc.layers.length === 0
  const rotate = useCallback(clockwise => {
    if (!canRotate || !base) return
    const next = rotateCanvas90(base, clockwise)
    history.commit(s => ({ base: next, doc: { ...s.doc, width: next.width, height: next.height } }))
  }, [canRotate, base, history])

  const flip = useCallback(axis => {
    if (!canRotate || !base) return
    history.commit(s => ({ ...s, base: flipCanvas(base, axis) }))
  }, [canRotate, base, history])

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
      tidyUp, toggleLock, nudge, begin, patchSelected])

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSave() {
    setError('')
    try {
      const { compositeBlob, textLayerBlob, cleanBlob, width, height } = await exportDocument(base, doc)
      const result = await onSave({ compositeBlob, textLayerBlob, cleanBlob, state: { ...doc, width, height } })
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

  // Colours already used in the document, offered first in every picker —
  // Canva's "Document colours", and the cheapest way to keep one design on
  // one palette.
  const documentColors = useMemo(() => {
    if (!doc) return []
    const seen = []
    for (const l of doc.layers) {
      for (const c of [l.color, l.fill, l.stroke]) {
        if (c && !seen.includes(c)) seen.push(c)
      }
    }
    return seen.slice(0, 10)
  }, [doc])

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
        <SidePanel panel={panel} onOpenPanel={p => { if (p !== 'crop' && tool === 'crop') cancelCrop(); setPanel(p) }}>
          {panel === 'insert' && <InsertPanel onAddText={addText} onAddShape={addShape} />}
          {panel === 'uploads' && (
            <UploadsPanel onUploadImage={onUploadImage} onAddImage={addImage} library={imageLibrary} />
          )}
          {panel === 'adjust' && (
            <AdjustPanel adjust={doc.adjust} onBeginChange={begin}
              onChange={(key, value) => applyDoc(d => ({ ...d, adjust: { ...d.adjust, [key]: value } }))}
              onResetAll={() => commitDoc(d => ({ ...d, adjust: { brightness: 0, contrast: 0, saturation: 0 } }))} />
          )}
          {panel === 'crop' && (
            <CropPanel doc={doc} cropRect={cropRect} onSetRatio={applyCropRatio} onApply={applyCrop} onCancel={cancelCrop} />
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
          <TopToolbar doc={doc} selection={selection} tool={tool} panel={panel}
            canUndo={history.canUndo} canRedo={history.canRedo} onUndo={history.undo} onRedo={history.redo}
            onPatch={patchSelected} onBeginChange={begin} onOpenPanel={setPanel}
            onRotate={rotate} onFlip={flip} onStartCrop={startCrop} canRotate={canRotate}
            onCopyStyle={copyStyle} painting={painting}
            documentColors={documentColors} />

          <div ref={viewportRef}
            className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#f4f4f5_0_25%,#fff_0_50%)] bg-[length:20px_20px]"
            onContextMenu={e => e.preventDefault()}>
            {!fontsReady && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Spinner /></div>
            )}

            {zoom.viewport.w > 0 && (
              <EditorStage
                doc={doc} previewCanvas={previewCanvas} zoom={zoom} epoch={fontEpoch}
                selectedIds={selectedIds} onSelectionChange={handleSelectionChange}
                onBeginChange={begin} onApplyDoc={applyDoc} onCloneInPlace={cloneInPlace}
                tool={tool} cropRect={cropRect} cropRatio={cropRatio} onCropRect={setCropRect}
                // The EFFECTIVE id, not the raw one: a text node is hidden
                // while its inline editor covers it, so passing an id whose
                // editor isn't actually open would hide that layer for good.
                editingId={editingSingle ? editingId : null} onEditStart={setEditingId}
                onInteractingChange={setInteracting}
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
