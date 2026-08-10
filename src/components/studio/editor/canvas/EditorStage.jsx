import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Circle, Line, Image as KonvaImage, Transformer } from 'react-konva'
import { ShapeNode, PathNode, ImageNode, TextNode } from './LayerNodes'
import { applyAdjustments, hasAdjustments } from '../model/adjust'
import { patchLayers, isPath } from '../model/document'
import { layerRect, translatePatch } from '../model/geometry'
import { buildSnapTargets, computeSnap, constrainAxis, SNAP_SCREEN_PX, ROTATION_STEP } from '../model/snapping'

// ─── The canvas ────────────────────────────────────────────────────────────
// Two Konva Layers, not one. The content layer holds the photo and every
// element; the UI layer holds the Transformer, the smart guides, the marquee
// and the crop overlay. Konva redraws a whole Layer whenever anything on it
// changes, so with everything on one layer — which is what this used to be —
// every twitch of a resize handle repainted the full-resolution photo
// underneath it. Splitting them means handle movement touches only the small,
// mostly-empty UI layer.
const ACCENT = '#f59e0b'

const HANDLE_PROPS = {
  anchorSize: 12, anchorCornerRadius: 6,
  anchorFill: '#ffffff', anchorStroke: ACCENT, anchorStrokeWidth: 2,
  borderStroke: ACCENT, borderStrokeWidth: 1.5,
  ignoreStroke: true,
}
const SHAPE_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
// Text has no stored height (it's derived from the wrapped line count), so its
// box only grows by width (side handles) or uniformly by font size (corner
// handles) — no top/bottom handles, matching Canva's text boxes.
const TEXT_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
const ROTATION_SNAPS = Array.from({ length: 360 / ROTATION_STEP }, (_, i) => i * ROTATION_STEP)

export function EditorStage({
  doc, previewCanvas, zoom, epoch,
  selectedIds, onSelectionChange,
  onBeginChange, onApplyDoc, onCloneInPlace,
  tool, cropRect, cropRatio, onCropRect,
  editingId, onEditStart, onContextMenu,
  onInteractingChange,
}) {
  const { viewport, view, spaceDown, onWheel, setPan } = zoom
  const W = doc.width, H = doc.height

  const stageRef = useRef(null)
  const baseImgRef = useRef(null)
  const transformerRef = useRef(null)
  const cropNodeRef = useRef(null)
  const cropTransformerRef = useRef(null)
  const nodeRefs = useRef(new Map())
  const dragRef = useRef(null)
  const marqueeRef = useRef(null)

  const [guides, setGuides] = useState([])
  const [marquee, setMarquee] = useState(null)

  const registerRef = useCallback((id, node) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedLayers = useMemo(() => doc.layers.filter(l => selectedSet.has(l.id)), [doc.layers, selectedSet])
  const single = selectedLayers.length === 1 ? selectedLayers[0] : null
  const editingSingle = !!editingId && single?.id === editingId
  // Panning takes the canvas over completely: nodes stop listening so a drag
  // that starts on an element pans instead of moving it, which is what the
  // space-bar idiom means everywhere else.
  const panning = spaceDown || tool === 'pan'
  const selectable = tool === 'select' && !panning

  // ── Base photo + adjustments ────────────────────────────────────────────
  // Filtering happens on the DOWNSCALED preview canvas (see adjust.js) and is
  // coalesced to one pass per animation frame, so dragging a slider can't
  // queue up more filter passes than the display can show.
  const adjustFrame = useRef(0)
  useEffect(() => {
    const node = baseImgRef.current
    if (!node) return
    cancelAnimationFrame(adjustFrame.current)
    adjustFrame.current = requestAnimationFrame(() => {
      if (hasAdjustments(doc.adjust)) {
        node.cache()
        applyAdjustments(node, doc.adjust)
      } else {
        node.filters([])
        node.clearCache()
      }
      node.getLayer()?.batchDraw()
    })
    return () => cancelAnimationFrame(adjustFrame.current)
  }, [doc.adjust, previewCanvas])

  // ── Transformer attachment ──────────────────────────────────────────────
  // Lines and arrows are deliberately excluded: they're edited by dragging
  // their two endpoints, and a bounding-box scale has no sensible meaning for
  // a two-point path. Locked layers and the one being text-edited show no
  // handles at all.
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    const nodes = selectedLayers
      .filter(l => !isPath(l) && !l.locked && l.visible !== false && l.id !== editingId)
      .map(l => nodeRefs.current.get(l.id))
      .filter(Boolean)
    tr.nodes(tool === 'select' ? nodes : [])
    tr.getLayer()?.batchDraw()
  }, [selectedLayers, editingId, tool, doc])

  useEffect(() => {
    const tr = cropTransformerRef.current
    if (!tr) return
    tr.nodes(tool === 'crop' && cropNodeRef.current ? [cropNodeRef.current] : [])
    tr.getLayer()?.batchDraw()
  }, [tool])

  // ── Selection ───────────────────────────────────────────────────────────
  // Pressing a layer that's ALREADY part of a multi-selection must not collapse
  // the selection — otherwise you could never drag several things at once. But
  // a press that turns out to be a plain click (no drag) should collapse, or
  // you can never get from "three selected" to "just this one", and a
  // double-click on a member of a multi-selection never reaches the single
  // selection the inline text editor needs. So the collapse is deferred to
  // mouse-up and cancelled if a drag starts.
  const pendingCollapse = useRef(null)

  const selectLayer = useCallback((e, layer) => {
    if (!selectable) return
    // Canva selects on press, not release, so a press-and-drag both selects
    // and starts moving in one gesture.
    const additive = e.evt?.shiftKey || e.evt?.metaKey || e.evt?.ctrlKey
    pendingCollapse.current = null
    if (additive) {
      onSelectionChange(selectedSet.has(layer.id)
        ? selectedIds.filter(id => id !== layer.id)
        : [...selectedIds, layer.id])
    } else if (!selectedSet.has(layer.id)) {
      onSelectionChange([layer.id])
    } else if (selectedIds.length > 1) {
      pendingCollapse.current = layer.id
    }
  }, [selectable, selectedIds, selectedSet, onSelectionChange])

  // ── Drag: snapping, axis lock, and moving a whole multi-selection ───────
  const handleDragStart = useCallback((e, layer) => {
    if (!selectable) return
    const node = e.target
    // Dragging an unselected layer selects it first; dragging one that's part
    // of a multi-selection moves the whole selection.
    pendingCollapse.current = null   // this press became a drag, not a click
    const ids = selectedSet.has(layer.id) && selectedIds.length > 1 ? selectedIds : [layer.id]
    // ⌥-drag duplicates, the way it does in every design tool. The copies are
    // dropped in place UNDER the originals and the originals are what keeps
    // dragging — visually identical to "the copy came with the cursor", with
    // none of the mid-gesture node-swapping that literally dragging the copy
    // would require.
    if (e.evt?.altKey) onCloneInPlace?.(ids)
    onBeginChange()
    onInteractingChange?.(true)
    const others = ids
      .filter(id => id !== layer.id)
      .map(id => {
        const n = nodeRefs.current.get(id)
        const l = doc.layers.find(x => x.id === id)
        return n && l && !l.locked ? { id, node: n, x: n.x(), y: n.y() } : null
      })
      .filter(Boolean)
    dragRef.current = {
      ids, others, startX: node.x(), startY: node.y(),
      targets: buildSnapTargets(doc, ids),
    }
  }, [selectable, selectedIds, selectedSet, doc, onBeginChange, onInteractingChange, onCloneInPlace])

  const handleDragMove = useCallback(e => {
    const st = dragRef.current
    if (!st) return
    const node = e.target

    if (e.evt?.shiftKey) {
      const { dx, dy } = constrainAxis(node.x() - st.startX, node.y() - st.startY)
      node.position({ x: st.startX + dx, y: st.startY + dy })
    }

    // The threshold is a constant number of SCREEN pixels, so snapping feels
    // identical at 25% and at 400% zoom.
    const box = node.getClientRect({ relativeTo: node.getLayer(), skipShadow: true })
    const rect = {
      left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height,
      cx: box.x + box.width / 2, cy: box.y + box.height / 2,
    }
    const snap = computeSnap(rect, st.targets, SNAP_SCREEN_PX / view.scale)
    if (snap.dx || snap.dy) node.position({ x: node.x() + snap.dx, y: node.y() + snap.dy })
    setGuides(snap.guides)

    const totalDx = node.x() - st.startX, totalDy = node.y() - st.startY
    for (const o of st.others) o.node.position({ x: o.x + totalDx, y: o.y + totalDy })
  }, [view.scale])

  const handleDragEnd = useCallback((e, layer) => {
    const st = dragRef.current
    dragRef.current = null
    setGuides([])
    onInteractingChange?.(false)
    if (!st) return
    const node = e.target
    const dxFrac = (node.x() - st.startX) / W
    const dyFrac = (node.y() - st.startY) / H
    // Lines and arrows carry their geometry in `points`, not in the node's
    // position, so the node has to be put back to the origin — otherwise the
    // re-render draws the new points AND keeps the drag offset, doubling it.
    if (isPath(layer)) node.position({ x: 0, y: 0 })
    if (!dxFrac && !dyFrac) return
    onApplyDoc(d => patchLayers(d, Object.fromEntries(
      st.ids
        .map(id => {
          const l = d.layers.find(x => x.id === id)
          return l && !l.locked ? [id, translatePatch(l, dxFrac, dyFrac)] : null
        })
        .filter(Boolean),
    )))
  }, [W, H, onApplyDoc, onInteractingChange])

  const patchOne = useCallback((id, patch) => {
    onApplyDoc(d => patchLayers(d, { [id]: patch }))
  }, [onApplyDoc])

  // ── Marquee (rubber-band) selection ─────────────────────────────────────
  const handleStageMouseDown = useCallback(e => {
    if (panning) return
    // Right- and middle-button presses must not start a rubber band; the right
    // button belongs to the context menu.
    if (e.evt.button !== 0) return
    const stage = e.target.getStage()
    // Only an empty-canvas press starts a marquee. The base photo has
    // listening off, so a press on the photo lands on the Stage itself.
    if (e.target !== stage) return
    if (tool !== 'select') return
    const p = stage.getPointerPosition()
    const start = { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale }
    marqueeRef.current = { start, additive: e.evt.shiftKey, base: e.evt.shiftKey ? selectedIds : [] }
    setMarquee({ x: start.x, y: start.y, w: 0, h: 0 })
    if (!e.evt.shiftKey) onSelectionChange([])
  }, [panning, tool, view, selectedIds, onSelectionChange])

  const handleStageMouseMove = useCallback(e => {
    const m = marqueeRef.current
    if (!m) return
    const stage = e.target.getStage()
    const p = stage.getPointerPosition()
    const now = { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale }
    setMarquee({
      x: Math.min(m.start.x, now.x), y: Math.min(m.start.y, now.y),
      w: Math.abs(now.x - m.start.x), h: Math.abs(now.y - m.start.y),
    })
  }, [view])

  const handleStageMouseUp = useCallback(() => {
    if (pendingCollapse.current) {
      const id = pendingCollapse.current
      pendingCollapse.current = null
      onSelectionChange([id])
    }
    const m = marqueeRef.current
    marqueeRef.current = null
    if (!m || !marquee) { setMarquee(null); return }
    setMarquee(null)
    // A click (rather than a drag) produces a zero-ish box; treat that as the
    // deselect it obviously is instead of selecting everything it grazes.
    if (marquee.w < 3 && marquee.h < 3) return
    const hits = doc.layers
      .filter(l => l.visible !== false)
      .filter(l => {
        const r = layerRect(l, W, H)
        return r.right >= marquee.x && r.left <= marquee.x + marquee.w
          && r.bottom >= marquee.y && r.top <= marquee.y + marquee.h
      })
      .map(l => l.id)
    onSelectionChange([...new Set([...m.base, ...hits])])
  }, [marquee, doc.layers, W, H, onSelectionChange])

  // Konva's Stage drag is the pan: it's already frame-perfect and handles
  // pointer capture, so there's nothing to hand-roll. The view state is
  // synced back on release rather than per frame — Konva is the source of
  // truth for the duration of the gesture.
  const handleStageDragEnd = useCallback(e => {
    if (e.target !== e.target.getStage()) return
    setPan(e.target.x(), e.target.y())
  }, [setPan])

  const cursor = panning ? 'grab' : tool === 'crop' ? 'crosshair' : 'default'

  return (
    <Stage
      ref={stageRef}
      width={viewport.w} height={viewport.h}
      scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
      draggable={panning}
      onDragEnd={handleStageDragEnd}
      onWheel={onWheel}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
      onContextMenu={e => { e.evt.preventDefault(); if (e.target === e.target.getStage()) onContextMenu?.(e, null) }}
      style={{ cursor }}
    >
      {/* ── Content ── */}
      <Layer>
        {/* A white plate under the photo so a transparent PNG reads as a page
            rather than as the app's own background showing through. */}
        <Rect x={0} y={0} width={W} height={H} fill="#ffffff" listening={false} />
        <KonvaImage ref={baseImgRef} image={previewCanvas} x={0} y={0} width={W} height={H} listening={false} />

        {doc.layers.map(l => {
          if (l.visible === false) return null
          const shared = {
            key: l.id, layer: l, W, H, selectable, registerRef,
            onSelect: e => selectLayer(e, l),
            onDragStart: e => handleDragStart(e, l),
            onDragMove: handleDragMove,
            onDragEnd: e => handleDragEnd(e, l),
            onContextMenu: e => { e.evt.preventDefault(); e.cancelBubble = true; onContextMenu?.(e, l.id) },
          }
          if (l.type === 'text') {
            return <TextNode {...shared} epoch={epoch} onChange={patchOne} hidden={editingId === l.id}
              onEditStart={() => { if (!l.locked) onEditStart?.(l.id) }} />
          }
          if (l.type === 'image') return <ImageNode {...shared} onChange={patchOne} />
          if (isPath(l)) return <PathNode {...shared} />
          return <ShapeNode {...shared} onChange={patchOne} />
        })}
      </Layer>

      {/* ── Selection UI, guides, crop ── */}
      <Layer>
        {guides.map((g, i) => (
          <Line key={`${g.orientation}${g.pos}${i}`}
            points={g.orientation === 'v' ? [g.pos, 0, g.pos, H] : [0, g.pos, W, g.pos]}
            stroke="#ec4899" strokeWidth={1 / view.scale} dash={[6 / view.scale, 4 / view.scale]}
            listening={false} perfectDrawEnabled={false} />
        ))}

        {/* Endpoint handles for a selected line/arrow — dragging one updates
            just that end, which is why PathNode itself has no transformer. */}
        {single && isPath(single) && !single.locked && [
          { key: 'a', xk: 'x1', yk: 'y1' }, { key: 'b', xk: 'x2', yk: 'y2' },
        ].map(h => (
          <Circle key={h.key} x={single[h.xk] * W} y={single[h.yk] * H}
            radius={6 / view.scale} fill={ACCENT} stroke="#fff" strokeWidth={2 / view.scale}
            draggable perfectDrawEnabled={false}
            onDragStart={() => { onBeginChange(); onInteractingChange?.(true) }}
            onDragMove={e => patchOne(single.id, { [h.xk]: e.target.x() / W, [h.yk]: e.target.y() / H })}
            onDragEnd={e => {
              onInteractingChange?.(false)
              patchOne(single.id, { [h.xk]: e.target.x() / W, [h.yk]: e.target.y() / H })
            }}
          />
        ))}

        <Transformer ref={transformerRef} {...HANDLE_PROPS}
          rotateEnabled={!editingSingle}
          rotationSnaps={ROTATION_SNAPS}
          rotationSnapTolerance={7}
          enabledAnchors={single?.type === 'text' ? TEXT_ANCHORS : SHAPE_ANCHORS}
          // Corner anchors keep the ratio for every type — for text that's
          // what makes a corner drag change the FONT SIZE (size and width
          // scaling together) while a side drag only re-wraps.
          keepRatio
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
          onTransformStart={() => { onBeginChange(); onInteractingChange?.(true) }}
          onTransformEnd={() => onInteractingChange?.(false)}
        />

        {marquee && (
          <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
            fill="rgba(245,158,11,0.10)" stroke={ACCENT} strokeWidth={1 / view.scale}
            listening={false} perfectDrawEnabled={false} />
        )}

        {tool === 'crop' && cropRect && (
          <>
            <Rect x={0} y={0} width={W} height={cropRect.y} fill="rgba(0,0,0,0.5)" listening={false} />
            <Rect x={0} y={cropRect.y + cropRect.h} width={W} height={H - cropRect.y - cropRect.h} fill="rgba(0,0,0,0.5)" listening={false} />
            <Rect x={0} y={cropRect.y} width={cropRect.x} height={cropRect.h} fill="rgba(0,0,0,0.5)" listening={false} />
            <Rect x={cropRect.x + cropRect.w} y={cropRect.y} width={W - cropRect.x - cropRect.w} height={cropRect.h} fill="rgba(0,0,0,0.5)" listening={false} />
            <Rect ref={cropNodeRef} x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
              stroke={ACCENT} strokeWidth={2 / view.scale} draggable
              dragBoundFunc={pos => {
                // dragBoundFunc works in ABSOLUTE (screen) coordinates, so the
                // document-space clamp has to be pushed through the current
                // view transform rather than applied to raw pixels.
                const maxX = (W - cropRect.w) * view.scale + view.x
                const maxY = (H - cropRect.h) * view.scale + view.y
                return {
                  x: Math.min(Math.max(view.x, pos.x), maxX),
                  y: Math.min(Math.max(view.y, pos.y), maxY),
                }
              }}
              onDragMove={e => onCropRect(c => ({ ...c, x: e.target.x(), y: e.target.y() }))}
              onTransformEnd={e => {
                const node = e.target
                const w = Math.max(20, node.width() * node.scaleX())
                const h = Math.max(20, node.height() * node.scaleY())
                node.scaleX(1); node.scaleY(1)
                onCropRect({ x: node.x(), y: node.y(), w, h })
              }}
            />
            <Transformer ref={cropTransformerRef} rotateEnabled={false} {...HANDLE_PROPS}
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              // A chosen aspect ratio has to survive the handles, not just set
              // the box once — height follows width for the whole drag.
              boundBoxFunc={(oldBox, newBox) => (
                cropRatio ? { ...newBox, height: newBox.width / cropRatio } : newBox
              )} />
          </>
        )}
      </Layer>
    </Stage>
  )
}
