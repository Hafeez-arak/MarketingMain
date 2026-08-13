import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Group, Rect, Circle, Line, Image as KonvaImage, Transformer } from 'react-konva'
import { ShapeNode, PathNode, ImageNode, TextNode } from './LayerNodes'
import { applyAdjustments, hasAdjustments } from '../model/adjust'
import { patchLayers, isPath } from '../model/document'
import { layerRect, translatePatch } from '../model/geometry'
import { buildSnapTargets, computeSnap, constrainAxis, SNAP_SCREEN_PX, ROTATION_STEP } from '../model/snapping'
import { centreCropRect, layerAlphaAt, layerLiveAt, motionOffsetAt } from '../model/playback'

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

// ── Crop mode shows the WHOLE photo, not the page ──────────────────────────
// The point of a non-destructive crop is that the hidden parts still exist, so
// the crop UI has to let you see them and drag the frame back out over them.
// While cropping, the Stage therefore works in BASE-image pixels: the photo is
// drawn uncropped at full size, and the layers are drawn inside a Group parked
// at the committed crop's origin, so they stay pinned to the part of the photo
// they were placed on while the new frame moves around them.
export function EditorStage({
  doc, previewCanvas, cacheRatio, baseSize, zoom, epoch,
  selectedIds, onSelectionChange,
  onBeginChange, onApplyDoc, onCloneInPlace,
  tool, cropRect, cropRatio, onCropRect,
  editingId, onEditStart, onContextMenu,
  onInteractingChange,
  // ── Video mode ──
  // `playback` is the useVideoPlayback hook's return, or null on a photo.
  // `time` is the committed time — the one React knows about, updated on
  // pause, seek and end. While the clip is PLAYING the time never enters
  // React at all; the subscription below mutates the Konva nodes directly.
  // Both paths call the same layerAlphaAt, so the frame you scrub to and the
  // frame you play past are identical.
  playback = null, time = 0,
}) {
  const { viewport, view, spaceDown, onWheel, setPan } = zoom
  const cropping = tool === 'crop'
  const playing = !!playback?.playing
  // Only once a frame has actually decoded. A <video> with metadata but no
  // decoded frame draws as a blank rectangle rather than throwing, so the
  // still stays up until there is something real to swap in.
  const videoEl = playback?.ready ? playback.el : null
  // The layers' own coordinate frame is always the PAGE, cropping or not.
  const W = doc.width, H = doc.height
  // What the Stage is showing, and how the photo sits in it.
  const stageW = cropping ? baseSize.width : W
  const stageH = cropping ? baseSize.height : H
  const committedCropPx = baseSize.crop
  const contentX = cropping ? committedCropPx.x : 0
  const contentY = cropping ? committedCropPx.y : 0
  // The source rectangle on the preview bitmap. Its pixels are the base
  // image's scaled by the preview ratio, so the crop has to scale with them.
  const previewScale = previewCanvas && baseSize.width ? previewCanvas.width / baseSize.width : 1
  const sourceCrop = cropping ? null : {
    x: committedCropPx.x * previewScale, y: committedCropPx.y * previewScale,
    width: committedCropPx.width * previewScale, height: committedCropPx.height * previewScale,
  }

  const stageRef = useRef(null)
  const contentLayerRef = useRef(null)
  const baseImgRef = useRef(null)
  const transformerRef = useRef(null)
  const cropNodeRef = useRef(null)
  const cropTransformerRef = useRef(null)
  const nodeRefs = useRef(new Map())
  const motionRefs = useRef(new Map())
  const dragRef = useRef(null)
  const marqueeRef = useRef(null)

  const [guides, setGuides] = useState([])
  const [marquee, setMarquee] = useState(null)

  const registerRef = useCallback((id, node) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  // The window onto the clip: the same centre-crop the compose script applies,
  // so the framing on screen is the framing that ships. Without it a 3:4 clip
  // under a 4:5 document would preview with margins the render never has.
  const videoCrop = useMemo(
    () => (videoEl ? centreCropRect(videoEl.videoWidth, videoEl.videoHeight, W, H) : null),
    [videoEl, W, H],
  )

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedLayers = useMemo(() => doc.layers.filter(l => selectedSet.has(l.id)), [doc.layers, selectedSet])
  const single = selectedLayers.length === 1 ? selectedLayers[0] : null
  const editingSingle = !!editingId && single?.id === editingId
  // Panning takes the canvas over completely: nodes stop listening so a drag
  // that starts on an element pans instead of moving it, which is what the
  // space-bar idiom means everywhere else.
  const panning = spaceDown || tool === 'pan'
  // Nothing is selectable or draggable while the clip runs. That's not a
  // restriction so much as the only coherent reading of a drag during
  // playback — you'd be moving a layer against footage that is moving under
  // it — and it also means the Transformer and every node stop listening for
  // the duration, which is exactly what the frame pump wants.
  const selectable = tool === 'select' && !panning && !playing

  // ── Base photo + adjustments ────────────────────────────────────────────
  // Filtering happens on the DOWNSCALED preview canvas (see adjust.js) and is
  // coalesced to one pass per animation frame, so dragging a slider can't
  // queue up more filter passes than the display can show.
  const adjustFrame = useRef(0)
  useEffect(() => {
    const node = baseImgRef.current
    // Adjustments cannot reach footage — the panel is hidden in video mode —
    // and caching a <video> source node would freeze the frame that happened
    // to be showing when the cache was taken.
    if (!node || videoEl) return
    cancelAnimationFrame(adjustFrame.current)
    adjustFrame.current = requestAnimationFrame(() => {
      if (hasAdjustments(doc.adjust)) {
        // pixelRatio is what actually makes the downscaled preview pay off:
        // Konva sizes a cache from the NODE's width/height, which is the
        // document size no matter how small the source bitmap is, so without
        // this the filters ran over full-resolution pixels regardless and the
        // downscale only ever saved memory. See adjust.js.
        node.cache({ pixelRatio: cacheRatio })
        applyAdjustments(node, doc.adjust, { docHeight: H, cachePixelRatio: cacheRatio })
      } else {
        node.filters([])
        node.clearCache()
      }
      node.getLayer()?.batchDraw()
    })
    return () => cancelAnimationFrame(adjustFrame.current)
  }, [doc.adjust, previewCanvas, cacheRatio, H, cropping, videoEl])

  // ── The frame pump ──────────────────────────────────────────────────────
  // While the clip plays, each frame arrives here rather than through React.
  // Two things happen and nothing else: every layer's opacity is set from the
  // same layerAlphaAt the export mirrors, and the content layer is redrawn —
  // which is also what pulls the new video frame onto the canvas, since the
  // base node's source is the <video> itself.
  //
  // The UI layer is deliberately untouched. It holds the Transformer, the
  // guides and the marquee, none of which can change while playing, and
  // leaving it alone is the entire reason the two-layer split exists.
  useEffect(() => {
    if (!playback?.subscribe) return undefined
    return playback.subscribe(t => {
      for (const l of doc.layers) {
        const node = nodeRefs.current.get(l.id)
        if (!node) continue
        node.opacity(l.id === editingId ? 0 : layerAlphaAt(l, t))
        // Motion moves the layer's own wrapper Group, whose resting position
        // is the origin — so this can write absolute values without ever
        // needing to know where the layer itself sits, and a ramp that ends
        // leaves nothing behind to undo. A Konva `offset()` would have done
        // the translation too, but it also relocates the rotation pivot, so a
        // rotated caption would have swung into place instead of sliding.
        const g = motionRefs.current.get(l.id)
        if (g) {
          const m = motionOffsetAt(l, t, H)
          g.position({ x: m ? m.dx : 0, y: m ? m.dy : 0 })
        }
      }
      contentLayerRef.current?.batchDraw()
    })
  }, [playback, doc.layers, editingId, H])

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
    tr.nodes(tool === 'select' && !playing ? nodes : [])
    tr.getLayer()?.batchDraw()
  }, [selectedLayers, editingId, tool, doc, playing])

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
      // Konva's default drag distance is ZERO, so a plain click on a layer
      // began a drag: mousedown fired dragstart, the pointer never moved, and
      // dragmove still ran — which put the layer through computeSnap and moved
      // it to the nearest guide, then dragend committed that as a real edit
      // (and an undo step). Selecting a layer therefore nudged it, every time,
      // by up to SNAP_SCREEN_PX / scale document pixels — 21px at 28% zoom,
      // which is what "the box moves when I click it again" was. Konva
      // cascades this to every descendant, so setting it once on the Stage
      // covers every layer type. 4px is below what a deliberate drag ever is
      // and above hand jitter on a click.
      dragDistance={4}
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
      <Layer ref={contentLayerRef}>
        {/* A white plate under the photo so a transparent PNG reads as a page
            rather than as the app's own background showing through. */}
        <Rect x={0} y={0} width={stageW} height={stageH} fill="#ffffff" listening={false} />
        <KonvaImage ref={baseImgRef} image={videoEl || previewCanvas}
          x={0} y={0} width={stageW} height={stageH}
          // Three cases, one node. On a photo the page is a window onto the
          // base image and Konva takes the source rectangle directly; while
          // cropping the whole photo is shown uncropped; on a clip the window
          // is the compose step's centre-crop.
          crop={(videoEl ? videoCrop : sourceCrop) || undefined}
          listening={false} />

        <Group x={contentX} y={contentY}>
        {doc.layers.map(l => {
          if (l.visible === false) return null
          // `key` is deliberately NOT in `shared`: React 19 warns when a key
          // arrives through a spread, because it's a directive to the
          // reconciler rather than a prop, and one passed that way is not
          // guaranteed to be read. It's written explicitly on each node below.
          const shared = {
            layer: l, W, H, selectable, registerRef,
            // On a photo `playback` is null and these collapse to what the
            // nodes always did. On a clip they are the layer's state at the
            // committed time; the pump above overwrites the opacity frame by
            // frame during playback and React puts it back the moment the
            // clip pauses, from the same function.
            alpha: playback ? layerAlphaAt(l, time) : (l.opacity ?? 1),
            live: playback ? layerLiveAt(l, time) : true,
            onSelect: e => selectLayer(e, l),
            onDragStart: e => handleDragStart(e, l),
            onDragMove: handleDragMove,
            onDragEnd: e => handleDragEnd(e, l),
            onContextMenu: e => { e.evt.preventDefault(); e.cancelBubble = true; onContextMenu?.(e, l.id) },
          }
          const node = l.type === 'text'
            ? <TextNode {...shared} epoch={epoch} onChange={patchOne} hidden={editingId === l.id}
                onEditStart={() => { if (!l.locked) onEditStart?.(l.id) }} />
            : l.type === 'image' ? <ImageNode {...shared} onChange={patchOne} />
            : isPath(l) ? <PathNode {...shared} />
            : <ShapeNode {...shared} onChange={patchOne} />

          // On a photo the node is mounted bare, exactly as it always was. On
          // a clip it gets a translation wrapper that the animation moves; it
          // rests at the origin, so a document with no animation is a Group at
          // 0,0 and behaves identically.
          if (!playback) return <Fragment key={l.id}>{node}</Fragment>
          const m = motionOffsetAt(l, time, H)
          return (
            <Group key={l.id}
              ref={g => { if (g) motionRefs.current.set(l.id, g); else motionRefs.current.delete(l.id) }}
              x={m ? m.dx : 0} y={m ? m.dy : 0}>
              {node}
            </Group>
          )
        })}
        </Group>
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

        {/* The crop frame and its dimmed surround, in BASE-image pixels —
            which is the whole photo, including everything the current crop is
            hiding. Dragging the frame out over the dimmed area is what makes
            the crop re-editable rather than a one-way cut. */}
        {cropping && cropRect && (
          <>
            <Rect x={0} y={0} width={stageW} height={cropRect.y} fill="rgba(0,0,0,0.55)" listening={false} />
            <Rect x={0} y={cropRect.y + cropRect.h} width={stageW} height={stageH - cropRect.y - cropRect.h} fill="rgba(0,0,0,0.55)" listening={false} />
            <Rect x={0} y={cropRect.y} width={cropRect.x} height={cropRect.h} fill="rgba(0,0,0,0.55)" listening={false} />
            <Rect x={cropRect.x + cropRect.w} y={cropRect.y} width={stageW - cropRect.x - cropRect.w} height={cropRect.h} fill="rgba(0,0,0,0.55)" listening={false} />

            {/* Rule-of-thirds guides, as every crop tool has. */}
            {[1, 2].map(i => (
              <Line key={`ch${i}`} points={[cropRect.x, cropRect.y + (cropRect.h * i) / 3, cropRect.x + cropRect.w, cropRect.y + (cropRect.h * i) / 3]}
                stroke="rgba(255,255,255,0.45)" strokeWidth={1 / view.scale} listening={false} perfectDrawEnabled={false} />
            ))}
            {[1, 2].map(i => (
              <Line key={`cv${i}`} points={[cropRect.x + (cropRect.w * i) / 3, cropRect.y, cropRect.x + (cropRect.w * i) / 3, cropRect.y + cropRect.h]}
                stroke="rgba(255,255,255,0.45)" strokeWidth={1 / view.scale} listening={false} perfectDrawEnabled={false} />
            ))}

            <Rect ref={cropNodeRef} x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
              stroke={ACCENT} strokeWidth={2 / view.scale} draggable
              dragBoundFunc={pos => {
                // dragBoundFunc works in ABSOLUTE (screen) coordinates, so the
                // document-space clamp has to be pushed through the current
                // view transform rather than applied to raw pixels.
                const maxX = (stageW - cropRect.w) * view.scale + view.x
                const maxY = (stageH - cropRect.h) * view.scale + view.y
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
                // Clamped to the photo: a handle dragged past the edge would
                // otherwise ask for pixels that don't exist and produce a
                // transparent margin in the export.
                const x = Math.max(0, Math.min(node.x(), stageW - Math.min(w, stageW)))
                const y = Math.max(0, Math.min(node.y(), stageH - Math.min(h, stageH)))
                onCropRect({ x, y, w: Math.min(w, stageW - x), h: Math.min(h, stageH - y) })
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
