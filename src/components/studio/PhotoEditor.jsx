import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Ellipse, Line, Arrow, Image as KonvaImage, Circle, Transformer } from 'react-konva'
import { Button, Select, Spinner, Toggle } from '../ui/index'
import { WEIGHTS, fontsFor, ensureFontsLoaded } from './fonts'
import { autoDirectionPatch } from './overlayModel'
import {
  migrateDocument, newTextLayer, newShapeLayer, buildTextBitmap,
  cropCanvas, remapLayersAfterCrop, applyAdjustments, exportDocument,
  loadBaseCanvas, rotateCanvas90, flipCanvas, ADJUST_RANGE,
} from './photoEditorModel'

// ─── Photo editor ───────────────────────────────────────────────────────────
// The professional-tier successor to OverlayEditor: the same real-text,
// always-editable philosophy (see photoEditorModel.js's header), plus shapes,
// crop, rotate/flip and colour adjustments, built on Konva so resize/rotate
// handles, multi-layer z-order and drag all come from a maintained library
// rather than hand-rolled pointer math.
//
// Two save-affecting scope calls, made deliberately rather than by omission:
//  · Text layers move by drag, but resize by the SAME width/size sliders the
//    old editor used — not a Transformer handle. Corner-dragging a text box
//    would stretch the pre-rendered bitmap (blurry) unless it's regenerated
//    on every drag frame, which is exactly the kind of thing that's easy to
//    get subtly wrong without being able to see it render. The slider is
//    already proven correct.
//  · Rotate/flip only work before any layer has been added (buttons disable
//    otherwise, with a tooltip saying why). They transform the photo, not the
//    layers on top of it — remapping a rotation across live text/shapes
//    correctly is real geometry that isn't worth the risk for what's usually
//    a "fix the source image first" action anyway. Crop, unlike rotate,
//    stays available throughout — it's a pure translate+scale and every
//    layer's fractional coordinates remap for it exactly.

const SHAPE_TOOLS = [
  { id: 'rect', label: '▭ Rect' },
  { id: 'ellipse', label: '◯ Ellipse' },
  { id: 'line', label: '／ Line' },
  { id: 'arrow', label: '→ Arrow' },
]

function toolButtonClass(active) {
  return `rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
    active ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-border hover:border-amber-400 hover:bg-amber-50'
  }`
}

// ── One shape/line node on the Stage ────────────────────────────────────────
function ShapeNode({ layer, W, H, onSelect, onChange, registerRef }) {
  const shapeRef = useRef(null)
  useEffect(() => { registerRef(layer.id, shapeRef.current) }, [registerRef, layer.id])

  const common = {
    ref: shapeRef,
    onClick: onSelect, onTap: onSelect,
    draggable: !layer.locked,
    opacity: layer.opacity ?? 1,
    rotation: layer.rotation || 0,
  }

  function commitDragEnd(patch) { onChange(layer.id, patch) }
  function commitTransformEnd() {
    const node = shapeRef.current
    if (!node) return
    const scaleX = node.scaleX(), scaleY = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    if (layer.type === 'rect') {
      onChange(layer.id, {
        x: node.x() / W, y: node.y() / H,
        w: (node.width() * scaleX) / W, h: (node.height() * scaleY) / H,
        rotation: node.rotation(),
      })
      node.width(node.width() * scaleX); node.height(node.height() * scaleY)
    } else if (layer.type === 'ellipse') {
      const rx = node.radiusX() * scaleX, ry = node.radiusY() * scaleY
      onChange(layer.id, {
        x: node.x() / W - rx / W, y: node.y() / H - ry / H,
        w: (rx * 2) / W, h: (ry * 2) / H, rotation: node.rotation(),
      })
      node.radiusX(rx); node.radiusY(ry)
    }
  }

  if (layer.type === 'rect') {
    return (
      <Rect {...common}
        x={layer.x * W} y={layer.y * H} width={layer.w * W} height={layer.h * H}
        fill={layer.fill || undefined} stroke={layer.stroke || undefined}
        strokeWidth={(layer.strokeWidth || 0) * H} cornerRadius={(layer.cornerRadius || 0) * H}
        onDragEnd={e => commitDragEnd({ x: e.target.x() / W, y: e.target.y() / H })}
        onTransformEnd={commitTransformEnd}
      />
    )
  }
  if (layer.type === 'ellipse') {
    return (
      <Ellipse {...common}
        x={(layer.x + layer.w / 2) * W} y={(layer.y + layer.h / 2) * H}
        radiusX={(layer.w / 2) * W} radiusY={(layer.h / 2) * H}
        fill={layer.fill || undefined} stroke={layer.stroke || undefined} strokeWidth={(layer.strokeWidth || 0) * H}
        onDragEnd={e => commitDragEnd({
          x: e.target.x() / W - layer.w / 2, y: e.target.y() / H - layer.h / 2,
        })}
        onTransformEnd={commitTransformEnd}
      />
    )
  }
  // line / arrow: the node itself only selects (click) — endpoints are
  // dragged individually via the two handle circles rendered by the caller,
  // which sidesteps points-vs-position double-accounting entirely.
  const points = [layer.x1 * W, layer.y1 * H, layer.x2 * W, layer.y2 * H]
  const Comp = layer.type === 'arrow' ? Arrow : Line
  return (
    <Comp ref={shapeRef} points={points} draggable={false}
      onClick={onSelect} onTap={onSelect}
      opacity={layer.opacity ?? 1}
      stroke={layer.stroke || undefined} fill={layer.type === 'arrow' ? layer.stroke || undefined : undefined}
      strokeWidth={(layer.strokeWidth || 0) * H}
      pointerLength={layer.type === 'arrow' ? (layer.strokeWidth || 0.01) * H * 3 : undefined}
      pointerWidth={layer.type === 'arrow' ? (layer.strokeWidth || 0.01) * H * 3 : undefined}
    />
  )
}

// ── One text layer, pre-rendered to a bitmap so Arabic shaping/wrapping is
// pixel-identical to the export (see photoEditorModel.js's buildTextBitmap) ──
function TextNode({ layer, W, H, onSelect, onChange, registerRef }) {
  const nodeRef = useRef(null)
  useEffect(() => { registerRef(layer.id, nodeRef.current) }, [registerRef, layer.id])
  const bmp = useMemo(
    () => buildTextBitmap(layer, W, H),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.text, layer.family, layer.weight, layer.size, layer.w, layer.color, layer.align, layer.dir, layer.lineHeight, layer.shadow, W, H],
  )
  return (
    <KonvaImage ref={nodeRef} image={bmp.canvas}
      x={layer.x * W - bmp.offsetX} y={layer.y * H - bmp.offsetY}
      width={bmp.width} height={bmp.height} opacity={layer.opacity ?? 1}
      draggable={!layer.locked} onClick={onSelect} onTap={onSelect}
      onDragEnd={e => onChange(layer.id, {
        x: (e.target.x() + bmp.offsetX) / W, y: (e.target.y() + bmp.offsetY) / H,
      })}
    />
  )
}

export function PhotoEditor({ imageUrl, initialState, onSave, onCancel, saving = false }) {
  const [baseCanvas, setBaseCanvas] = useState(null)
  const [doc, setDoc] = useState(null)
  const [history, setHistory] = useState({ past: [], future: [] })
  const [selectedId, setSelectedId] = useState(null)
  const [tool, setTool] = useState('select')
  const [panel, setPanel] = useState('layer')     // 'layer' | 'adjust' | 'crop'
  const [cropRect, setCropRect] = useState(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [previewW, setPreviewW] = useState(0)

  const wrapperRef = useRef(null)
  const nodeRefsMap = useRef(new Map())
  const transformerRef = useRef(null)
  const cropNodeRef = useRef(null)
  const cropTransformerRef = useRef(null)
  const registerRef = useCallback((id, node) => { if (node) nodeRefsMap.current.set(id, node); else nodeRefsMap.current.delete(id) }, [])

  // Attaches once the crop Rect mounts (tool turns 'crop') and detaches when
  // it unmounts — not on every cropRect drag/resize, since the node itself
  // never remounts across those, just its x/y/width/height props.
  useEffect(() => {
    const tr = cropTransformerRef.current
    if (!tr) return
    tr.nodes(tool === 'crop' && cropNodeRef.current ? [cropNodeRef.current] : [])
    tr.getLayer()?.batchDraw()
  }, [tool])

  // Load the source image once, at native resolution, and migrate whatever
  // was saved before (old text-only rows included) into the new document shape.
  useEffect(() => {
    let cancelled = false
    loadBaseCanvas(imageUrl).then(canvas => {
      if (cancelled) return
      setBaseCanvas(canvas)
      setDoc(migrateDocument(initialState, canvas.width, canvas.height))
      setLoading(false)
    }).catch(err => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [imageUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fit-to-box preview scale, recomputed as the modal/viewport resizes.
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => setPreviewW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc?.width])
  const scale = doc && previewW ? Math.min(previewW / doc.width, (window.innerHeight * 0.62) / doc.height) : 1

  const textLayers = useMemo(() => (doc ? doc.layers.filter(l => l.type === 'text') : []), [doc])
  // Only ever sets fontsReady TRUE, never back to false on a later signature
  // change (matches OverlayEditor.jsx's identical effect) — a newly-added
  // text layer whose font hasn't loaded yet finishes quietly in the
  // background rather than re-blocking a canvas the user is already editing.
  useEffect(() => {
    let cancelled = false
    ensureFontsLoaded(textLayers).then(() => { if (!cancelled) setFontsReady(true) })
    return () => { cancelled = true }
  }, [textLayers.map(l => `${l.family}:${l.weight}`).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = doc?.layers.find(l => l.id === selectedId) || null
  // Computed before the loading guard below — every hook in this component
  // must run on every render, loading or not, or React desyncs hook order
  // between the two.
  const availableFonts = useMemoFonts(selected)

  // ── History ──
  function commit(nextDoc, nextBaseCanvas = baseCanvas) {
    setHistory(h => ({ past: [...h.past, { doc, baseCanvas }], future: [] }))
    setDoc(nextDoc)
    if (nextBaseCanvas !== baseCanvas) setBaseCanvas(nextBaseCanvas)
  }
  function undo() {
    setHistory(h => {
      if (!h.past.length) return h
      const prev = h.past[h.past.length - 1]
      setDoc(prev.doc); setBaseCanvas(prev.baseCanvas)
      return { past: h.past.slice(0, -1), future: [{ doc, baseCanvas }, ...h.future] }
    })
  }
  function redo() {
    setHistory(h => {
      if (!h.future.length) return h
      const next = h.future[0]
      setDoc(next.doc); setBaseCanvas(next.baseCanvas)
      return { past: [...h.past, { doc, baseCanvas }], future: h.future.slice(1) }
    })
  }

  // ── Layer edits ──
  function patchLayer(id, patch) {
    setDoc(d => ({ ...d, layers: d.layers.map(l => (l.id === id ? { ...l, ...patch } : l)) }))
  }
  // Committed variant — same patch, but pushes history first. Used for
  // anything that ends a gesture (drag/transform end, inspector field
  // change) rather than every intermediate frame.
  function patchLayerCommitted(id, patch) {
    commit({ ...doc, layers: doc.layers.map(l => (l.id === id ? { ...l, ...patch } : l)) })
  }
  function addLayer(layer) {
    commit({ ...doc, layers: [...doc.layers, layer] })
    setSelectedId(layer.id)
    setTool('select'); setPanel('layer')
  }
  function deleteSelected() {
    if (!selected) return
    commit({ ...doc, layers: doc.layers.filter(l => l.id !== selected.id) })
    setSelectedId(null)
  }
  function reorder(id, dir) {
    const i = doc.layers.findIndex(l => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= doc.layers.length) return
    const layers = [...doc.layers]
    ;[layers[i], layers[j]] = [layers[j], layers[i]]
    commit({ ...doc, layers })
  }

  // ── Attach/detach the shared Transformer to whatever's selected ──
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    if (!selected || selected.type === 'text' || selected.type === 'line' || selected.type === 'arrow') {
      tr.nodes([])
    } else {
      const node = nodeRefsMap.current.get(selected.id)
      tr.nodes(node ? [node] : [])
    }
    tr.getLayer()?.batchDraw()
  }, [selectedId, doc]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Base-image adjustments ──
  const baseImgRef = useRef(null)
  useEffect(() => {
    const node = baseImgRef.current
    if (!node || !doc) return
    node.cache()
    applyAdjustments(node, doc.adjust)
    node.getLayer()?.batchDraw()
  }, [doc?.adjust?.brightness, doc?.adjust?.contrast, doc?.adjust?.saturation, baseCanvas]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rotate / flip — see the file header for why this is layer-gated ──
  const canRotate = doc && doc.layers.length === 0
  function rotate(clockwise) {
    if (!canRotate) return
    const next = rotateCanvas90(baseCanvas, clockwise)
    commit({ ...doc, width: next.width, height: next.height }, next)
  }
  function flip(axis) {
    if (!canRotate) return
    commit(doc, flipCanvas(baseCanvas, axis))
  }

  // ── Crop ──
  function startCrop() {
    setPanel('crop'); setTool('crop')
    const margin = 0.1
    setCropRect({
      x: doc.width * margin, y: doc.height * margin,
      w: doc.width * (1 - margin * 2), h: doc.height * (1 - margin * 2),
    })
  }
  function cancelCrop() { setTool('select'); setPanel('layer'); setCropRect(null) }
  function applyCrop() {
    if (!cropRect) return
    const oldW = doc.width, oldH = doc.height
    const crop = {
      x: Math.max(0, cropRect.x), y: Math.max(0, cropRect.y),
      w: Math.min(oldW - cropRect.x, cropRect.w), h: Math.min(oldH - cropRect.y, cropRect.h),
    }
    const nextCanvas = cropCanvas(baseCanvas, crop)
    const nextLayers = remapLayersAfterCrop(doc.layers, oldW, oldH, crop, nextCanvas.width, nextCanvas.height)
    commit({ ...doc, width: nextCanvas.width, height: nextCanvas.height, layers: nextLayers }, nextCanvas)
    setTool('select'); setPanel('layer'); setCropRect(null)
  }

  // ── Save ──
  async function handleSave() {
    setError('')
    try {
      const { compositeBlob, textLayerBlob, width, height } = await exportDocument(baseCanvas, doc)
      const result = await onSave({ compositeBlob, textLayerBlob, state: { ...doc, width, height } })
      if (result?.error) setError(result.error)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  if (loading || !doc) {
    return <div className="p-12 flex justify-center"><Spinner /></div>
  }

  const W = doc.width, H = doc.height

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 p-4">
      <div className="space-y-2">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-subtle/40 p-1.5">
          <button type="button" onClick={() => { setTool('select'); if (panel !== 'layer') setPanel(selected ? 'layer' : 'layer') }}
            className={toolButtonClass(tool === 'select')}>↖ Select</button>
          <button type="button" onClick={() => addLayer(newTextLayer({ y: 0.08 + doc.layers.length * 0.1 }))}
            className={toolButtonClass(false)}>+ Text</button>
          {SHAPE_TOOLS.map(s => (
            <button key={s.id} type="button" onClick={() => addLayer(newShapeLayer(s.id))}
              className={toolButtonClass(false)}>{s.label}</button>
          ))}
          <button type="button" onClick={startCrop} className={toolButtonClass(tool === 'crop')}>⬛ Crop</button>
          <button type="button" onClick={() => setPanel('adjust')} className={toolButtonClass(panel === 'adjust')}>🎚 Adjust</button>
          <span className="w-px h-5 bg-border mx-0.5" />
          <button type="button" onClick={() => rotate(true)} disabled={!canRotate}
            title={canRotate ? 'Rotate 90°' : 'Only available before any text or shape is added'}
            className={`${toolButtonClass(false)} disabled:opacity-40`}>⟳ Rotate</button>
          <button type="button" onClick={() => flip('horizontal')} disabled={!canRotate}
            title={canRotate ? 'Flip horizontal' : 'Only available before any text or shape is added'}
            className={`${toolButtonClass(false)} disabled:opacity-40`}>⇋ Flip H</button>
          <button type="button" onClick={() => flip('vertical')} disabled={!canRotate}
            title={canRotate ? 'Flip vertical' : 'Only available before any text or shape is added'}
            className={`${toolButtonClass(false)} disabled:opacity-40`}>⇅ Flip V</button>
          <span className="w-px h-5 bg-border mx-0.5" />
          <button type="button" onClick={undo} disabled={!history.past.length} className={`${toolButtonClass(false)} disabled:opacity-40`}>↶ Undo</button>
          <button type="button" onClick={redo} disabled={!history.future.length} className={`${toolButtonClass(false)} disabled:opacity-40`}>↷ Redo</button>
        </div>

        {/* ── Stage ── */}
        <div ref={wrapperRef} className="relative rounded-2xl overflow-hidden border border-border bg-stone-900/5 flex items-center justify-center h-[62vh]">
          {!fontsReady && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Spinner /></div>
          )}
          {previewW > 0 && (
            <Stage width={W * scale} height={H * scale} scaleX={scale} scaleY={scale}
              onMouseDown={e => { if (e.target === e.target.getStage()) setSelectedId(null) }}>
              <Layer>
                <KonvaImage ref={baseImgRef} image={baseCanvas} x={0} y={0} width={W} height={H} listening={false} />
                {doc.layers.map(l => {
                  if (l.visible === false) return null
                  if (l.type === 'text') {
                    return (
                      <TextNode key={l.id} layer={l} W={W} H={H} registerRef={registerRef}
                        onSelect={() => { setSelectedId(l.id); setTool('select'); setPanel('layer') }}
                        onChange={patchLayerCommitted}
                      />
                    )
                  }
                  return (
                    <ShapeNode key={l.id} layer={l} W={W} H={H} registerRef={registerRef}
                      onSelect={() => { setSelectedId(l.id); setTool('select'); setPanel('layer') }}
                      onChange={patchLayerCommitted}
                    />
                  )
                })}
                {/* Endpoint handles for the selected line/arrow — dragging one
                    updates just that end, sidestepping node-position-vs-points
                    double counting entirely (see ShapeNode's comment above). */}
                {selected && (selected.type === 'line' || selected.type === 'arrow') && [
                  { key: 'x1', xk: 'x1', yk: 'y1' }, { key: 'x2', xk: 'x2', yk: 'y2' },
                ].map(h => (
                  <Circle key={h.key} x={selected[h.xk] * W} y={selected[h.yk] * H} radius={7 / scale}
                    fill="#f59e0b" stroke="#fff" strokeWidth={2 / scale} draggable
                    onDragMove={e => patchLayer(selected.id, { [h.xk]: e.target.x() / W, [h.yk]: e.target.y() / H })}
                    onDragEnd={e => patchLayerCommitted(selected.id, { [h.xk]: e.target.x() / W, [h.yk]: e.target.y() / H })}
                  />
                ))}
                <Transformer ref={transformerRef} rotateEnabled
                  enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']} />
                {tool === 'crop' && cropRect && (
                  <>
                    <Rect x={0} y={0} width={W} height={cropRect.y} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect x={0} y={cropRect.y + cropRect.h} width={W} height={H - cropRect.y - cropRect.h} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect x={0} y={cropRect.y} width={cropRect.x} height={cropRect.h} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect x={cropRect.x + cropRect.w} y={cropRect.y} width={W - cropRect.x - cropRect.w} height={cropRect.h} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect ref={cropNodeRef} x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
                      stroke="#f59e0b" strokeWidth={2 / scale} draggable
                      dragBoundFunc={pos => ({
                        x: Math.min(Math.max(0, pos.x), W - cropRect.w),
                        y: Math.min(Math.max(0, pos.y), H - cropRect.h),
                      })}
                      onDragMove={e => setCropRect(c => ({ ...c, x: e.target.x(), y: e.target.y() }))}
                      onTransformEnd={e => {
                        const node = e.target
                        const w = Math.max(20, node.width() * node.scaleX())
                        const h = Math.max(20, node.height() * node.scaleY())
                        node.scaleX(1); node.scaleY(1)
                        setCropRect({ x: node.x(), y: node.y(), w, h })
                      }}
                    />
                    <Transformer ref={cropTransformerRef} rotateEnabled={false}
                      enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']} />
                  </>
                )}
              </Layer>
            </Stage>
          )}
        </div>
        <p className="text-[11px] text-text-tertiary">
          {tool === 'crop'
            ? 'Drag the corners to resize the crop, drag inside to move it.'
            : 'Click a layer to select it. Drag to move; use the panel on the right to style it.'}
        </p>
      </div>

      {/* ── Right panel ── */}
      <div className="space-y-3">
        {panel === 'crop' ? (
          <div className="rounded-2xl border border-border bg-white p-4 space-y-3">
            <p className="text-xs font-semibold text-text">Crop</p>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Everything on the layer stays exactly where it is relative to the frame — the crop
              moves the frame around it.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={cancelCrop}>Cancel</Button>
              <Button onClick={applyCrop}>Apply crop</Button>
            </div>
          </div>
        ) : panel === 'adjust' ? (
          <div className="rounded-2xl border border-border bg-white p-4 space-y-4">
            <p className="text-xs font-semibold text-text">Adjust the photo</p>
            {['brightness', 'contrast', 'saturation'].map(key => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-text-secondary capitalize">{key}</p>
                  <button type="button" onClick={() => setDoc(d => ({ ...d, adjust: { ...d.adjust, [key]: 0 } }))}
                    className="text-[10px] text-text-tertiary hover:text-amber-700">Reset</button>
                </div>
                <input type="range" min={ADJUST_RANGE[key][0]} max={ADJUST_RANGE[key][1]} step={1}
                  value={doc.adjust[key] || 0}
                  onChange={e => setDoc(d => ({ ...d, adjust: { ...d.adjust, [key]: Number(e.target.value) } }))}
                  onMouseUp={() => commit(doc)} onTouchEnd={() => commit(doc)}
                  className="w-full accent-amber-600" />
              </div>
            ))}
            <p className="text-[11px] text-text-tertiary leading-relaxed">Applies to the photo only — text and shapes are untouched.</p>
          </div>
        ) : !selected ? (
          <div className="rounded-2xl border border-border bg-surface-subtle/50 p-4">
            <p className="text-xs text-text-secondary leading-relaxed">
              Select a layer to style it, add text or a shape from the toolbar, or use Crop / Adjust.
            </p>
          </div>
        ) : selected.type === 'text' ? (
          <TextInspector layer={selected} availableFonts={availableFonts}
            onChange={patch => patchLayer(selected.id, patch)}
            onCommit={patch => patchLayerCommitted(selected.id, patch)}
            onDelete={deleteSelected}
          />
        ) : (
          <ShapeInspector layer={selected}
            onChange={patch => patchLayer(selected.id, patch)}
            onCommit={patch => patchLayerCommitted(selected.id, patch)}
            onDelete={deleteSelected}
          />
        )}

        {/* ── Layers ── */}
        <div className="rounded-2xl border border-border bg-white p-3 space-y-1.5">
          <p className="text-xs font-semibold text-text mb-1">Layers</p>
          {doc.layers.length === 0 && <p className="text-[11px] text-text-tertiary">Nothing added yet.</p>}
          {[...doc.layers].reverse().map(l => {
            const idx = doc.layers.findIndex(x => x.id === l.id)
            return (
              <div key={l.id}
                onClick={() => { setSelectedId(l.id); setTool('select'); setPanel('layer') }}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer text-[11px] ${
                  l.id === selectedId ? 'bg-amber-50 text-amber-800' : 'hover:bg-surface-subtle text-text-secondary'
                }`}>
                <span className="flex-1 truncate">{layerLabel(l)}</span>
                <button type="button" onClick={e => { e.stopPropagation(); patchLayerCommitted(l.id, { visible: l.visible === false }) }}
                  title={l.visible === false ? 'Show' : 'Hide'} className="hover:text-amber-700">{l.visible === false ? '🚫' : '👁'}</button>
                <button type="button" onClick={e => { e.stopPropagation(); reorder(l.id, 1) }} disabled={idx === doc.layers.length - 1}
                  title="Move up" className="hover:text-amber-700 disabled:opacity-30">↑</button>
                <button type="button" onClick={e => { e.stopPropagation(); reorder(l.id, -1) }} disabled={idx === 0}
                  title="Move down" className="hover:text-amber-700 disabled:opacity-30">↓</button>
                <button type="button" onClick={e => { e.stopPropagation(); commit({ ...doc, layers: doc.layers.filter(x => x.id !== l.id) }); if (l.id === selectedId) setSelectedId(null) }}
                  title="Delete" className="hover:text-red-600">×</button>
              </div>
            )
          })}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !fontsReady}>
            {saving ? <><Spinner size="sm" /> Saving…</> : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function layerLabel(l) {
  if (l.type === 'text') return l.text?.slice(0, 24) || 'Text'
  return l.type.charAt(0).toUpperCase() + l.type.slice(1)
}

function useMemoFonts(selected) {
  return useMemo(() => fontsFor(selected?.dir || 'ltr'), [selected?.dir])
}

// ── Text inspector — same fields as the old OverlayEditor, unchanged ──
function TextInspector({ layer, availableFonts, onChange, onCommit, onDelete }) {
  function updateText(text) { onCommit(autoDirectionPatch(layer, text)) }
  return (
    <div className="rounded-2xl border border-border bg-white p-4 space-y-3">
      <textarea value={layer.text} onChange={e => updateText(e.target.value)} rows={3} dir={layer.dir}
        className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-amber-400"
        style={{ fontFamily: `"${layer.family}", sans-serif` }} />

      <div className="grid grid-cols-2 gap-2">
        <Select label="Font" value={layer.family} onChange={e => onCommit({ family: e.target.value })}>
          {availableFonts.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
        <Select label="Weight" value={layer.weight} onChange={e => onCommit({ weight: Number(e.target.value) })}>
          {WEIGHTS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
        </Select>
      </div>

      <div>
        <p className="text-xs font-medium text-text-secondary mb-1">Size</p>
        <input type="range" min={0.02} max={0.30} step={0.005} value={layer.size}
          onChange={e => onChange({ size: Number(e.target.value) })} onMouseUp={e => onCommit({ size: Number(e.target.value) })}
          className="w-full accent-amber-600" />
      </div>
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1">Text width</p>
        <input type="range" min={0.15} max={1} step={0.01} value={layer.w}
          onChange={e => onChange({ w: Number(e.target.value) })} onMouseUp={e => onCommit({ w: Number(e.target.value) })}
          className="w-full accent-amber-600" />
      </div>
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1">Line spacing</p>
        <input type="range" min={0.9} max={2} step={0.05} value={layer.lineHeight}
          onChange={e => onChange({ lineHeight: Number(e.target.value) })} onMouseUp={e => onCommit({ lineHeight: Number(e.target.value) })}
          className="w-full accent-amber-600" />
      </div>

      <div className="grid grid-cols-2 gap-2 items-end">
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1">Colour</p>
          <div className="flex items-center gap-2">
            <input type="color" value={layer.color} onChange={e => onCommit({ color: e.target.value })}
              className="w-9 h-9 rounded-lg border border-border cursor-pointer bg-white" />
            <div className="flex gap-1">
              {['#ffffff', '#000000', '#d4af37', '#c8a24a'].map(c => (
                <button key={c} onClick={() => onCommit({ color: c })} style={{ background: c }}
                  className="w-6 h-6 rounded-md border border-border" title={c} />
              ))}
            </div>
          </div>
        </div>
        <Select label="Align" value={layer.align} onChange={e => onCommit({ align: e.target.value })}>
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </Select>
      </div>

      <Select label="Direction" value={layer.dir} onChange={e => onCommit({ dir: e.target.value, dirTouched: true })}>
        <option value="ltr">Left to right (English)</option>
        <option value="rtl">Right to left (Arabic)</option>
      </Select>

      <Toggle checked={layer.shadow} onChange={e => onCommit({ shadow: e.target.checked })} label="Drop shadow (helps over photos)" />

      <button onClick={onDelete} className="text-[11px] font-semibold text-red-600 hover:text-red-700">Delete this layer</button>
    </div>
  )
}

// ── Shape inspector — fill/stroke/opacity, plus corner radius for rects ──
function ShapeInspector({ layer, onChange, onCommit, onDelete }) {
  const hasFill = layer.type !== 'line' && layer.type !== 'arrow'
  return (
    <div className="rounded-2xl border border-border bg-white p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {hasFill && (
          <div>
            <p className="text-xs font-medium text-text-secondary mb-1">Fill</p>
            <input type="color" value={layer.fill || '#d4af37'} onChange={e => onCommit({ fill: e.target.value })}
              className="w-full h-9 rounded-lg border border-border cursor-pointer bg-white" />
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1">{hasFill ? 'Stroke' : 'Colour'}</p>
          <input type="color" value={layer.stroke || '#1a1410'} onChange={e => onCommit({ stroke: e.target.value })}
            className="w-full h-9 rounded-lg border border-border cursor-pointer bg-white" />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-text-secondary mb-1">Stroke width</p>
        <input type="range" min={0} max={0.03} step={0.001} value={layer.strokeWidth || 0}
          onChange={e => onChange({ strokeWidth: Number(e.target.value) })} onMouseUp={e => onCommit({ strokeWidth: Number(e.target.value) })}
          className="w-full accent-amber-600" />
      </div>

      {layer.type === 'rect' && (
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1">Corner radius</p>
          <input type="range" min={0} max={0.15} step={0.005} value={layer.cornerRadius || 0}
            onChange={e => onChange({ cornerRadius: Number(e.target.value) })} onMouseUp={e => onCommit({ cornerRadius: Number(e.target.value) })}
            className="w-full accent-amber-600" />
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-text-secondary mb-1">Opacity</p>
        <input type="range" min={0.05} max={1} step={0.05} value={layer.opacity ?? 1}
          onChange={e => onChange({ opacity: Number(e.target.value) })} onMouseUp={e => onCommit({ opacity: Number(e.target.value) })}
          className="w-full accent-amber-600" />
      </div>

      <button onClick={onDelete} className="text-[11px] font-semibold text-red-600 hover:text-red-700">Delete this layer</button>
    </div>
  )
}
