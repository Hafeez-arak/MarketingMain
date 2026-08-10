import { useEffect, useMemo, useRef, useState } from 'react'
import { Rect, Ellipse, Line, Arrow, Image as KonvaImage } from 'react-konva'
import { buildTextBitmap } from '../model/textBitmap'
import { getCachedImage, loadLayerImage } from '../model/imageCache'

// ─── The nodes on the canvas ───────────────────────────────────────────────
// One component per layer type. They share a contract so the Stage can treat
// them uniformly:
//   · registerRef(id, node) — so the Transformer and the multi-drag can find
//     the Konva node for a layer id.
//   · onSelect(e) — the Stage decides whether that's a replace or a
//     shift-click add, since only it knows the current selection.
//   · onDragMove/onDragEnd — the Stage owns snapping and multi-drag, because
//     both need to see layers other than this one.
//   · onTransformEnd — each node converts its OWN Konva scale back into real
//     model fractions and resets the scale to 1. Doing it per node (rather
//     than once for the whole Transformer) is what makes a multi-selection
//     resize work: Konva fires the event on every node it transformed, and
//     each patch is applied functionally, so they compose instead of racing.

// Konva's `perfectDraw` renders through an offscreen buffer to get fills and
// strokes exactly right at overlaps. We don't have translucent stroked
// overlaps where it matters, and it costs a full extra canvas per node per
// frame during a drag — so it's off everywhere here.
const PERF = { perfectDrawEnabled: false, shadowForStrokeEnabled: false }

// ── Shapes: rect / ellipse ─────────────────────────────────────────────────
export function ShapeNode({ layer, W, H, selectable, onSelect, onChange, registerRef, onDragStart, onDragMove, onDragEnd, onContextMenu }) {
  const ref = useRef(null)
  useEffect(() => {
    registerRef(layer.id, ref.current)
    return () => registerRef(layer.id, null)
  }, [registerRef, layer.id])

  const common = {
    ref, ...PERF,
    onMouseDown: onSelect, onTap: onSelect, onContextMenu,
    draggable: selectable && !layer.locked,
    onDragStart, onDragMove, onDragEnd,
    opacity: layer.opacity ?? 1,
    rotation: layer.rotation || 0,
    listening: selectable,
  }

  function commitTransformEnd() {
    const node = ref.current
    if (!node) return
    const scaleX = node.scaleX(), scaleY = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    if (layer.type === 'rect') {
      const w = Math.max(1, node.width() * scaleX), h = Math.max(1, node.height() * scaleY)
      node.width(w); node.height(h)
      onChange(layer.id, { x: node.x() / W, y: node.y() / H, w: w / W, h: h / H, rotation: node.rotation() })
    } else {
      const rx = Math.max(1, node.radiusX() * scaleX), ry = Math.max(1, node.radiusY() * scaleY)
      node.radiusX(rx); node.radiusY(ry)
      onChange(layer.id, {
        x: (node.x() - rx) / W, y: (node.y() - ry) / H,
        w: (rx * 2) / W, h: (ry * 2) / H, rotation: node.rotation(),
      })
    }
  }

  if (layer.type === 'rect') {
    return (
      <Rect {...common}
        x={layer.x * W} y={layer.y * H} width={layer.w * W} height={layer.h * H}
        fill={layer.fill || undefined} stroke={layer.stroke || undefined}
        strokeWidth={(layer.strokeWidth || 0) * H} cornerRadius={(layer.cornerRadius || 0) * H}
        onTransformEnd={commitTransformEnd}
      />
    )
  }
  return (
    <Ellipse {...common}
      x={(layer.x + layer.w / 2) * W} y={(layer.y + layer.h / 2) * H}
      radiusX={(layer.w / 2) * W} radiusY={(layer.h / 2) * H}
      fill={layer.fill || undefined} stroke={layer.stroke || undefined}
      strokeWidth={(layer.strokeWidth || 0) * H}
      onTransformEnd={commitTransformEnd}
    />
  )
}

// ── Lines and arrows ───────────────────────────────────────────────────────
// The node itself only selects and drags as a whole; each END is dragged by
// its own handle circle (rendered by the Stage for the selected path), which
// sidesteps Konva's points-vs-node-position double accounting entirely.
export function PathNode({ layer, W, H, selectable, onSelect, registerRef, onDragStart, onDragMove, onDragEnd, onContextMenu }) {
  const ref = useRef(null)
  useEffect(() => {
    registerRef(layer.id, ref.current)
    return () => registerRef(layer.id, null)
  }, [registerRef, layer.id])

  const Comp = layer.type === 'arrow' ? Arrow : Line
  const stroke = (layer.strokeWidth || 0) * H
  return (
    <Comp ref={ref} {...PERF}
      points={[layer.x1 * W, layer.y1 * H, layer.x2 * W, layer.y2 * H]}
      onMouseDown={onSelect} onTap={onSelect} onContextMenu={onContextMenu}
      draggable={selectable && !layer.locked}
      onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}
      listening={selectable}
      opacity={layer.opacity ?? 1}
      stroke={layer.stroke || undefined}
      fill={layer.type === 'arrow' ? layer.stroke || undefined : undefined}
      strokeWidth={stroke}
      // A hairline is nearly impossible to grab; a fat invisible hit stroke
      // gives it a sane click target without changing what's drawn.
      hitStrokeWidth={Math.max(stroke, 12)}
      pointerLength={layer.type === 'arrow' ? (layer.strokeWidth || 0.01) * H * 3 : undefined}
      pointerWidth={layer.type === 'arrow' ? (layer.strokeWidth || 0.01) * H * 3 : undefined}
    />
  )
}

// ── Image layers ───────────────────────────────────────────────────────────
// The bytes live in the shared cache (imageCache.js). If they haven't arrived
// yet this renders nothing and re-renders when they do — a network hiccup
// leaves a hole for a moment rather than an error.
function useLayerImage(url) {
  const [, bump] = useState(0)
  const cached = getCachedImage(url)
  useEffect(() => {
    if (!url || getCachedImage(url)) return
    let alive = true
    loadLayerImage(url).then(() => { if (alive) bump(n => n + 1) })
    return () => { alive = false }
  }, [url])
  return cached
}

export function ImageNode({ layer, W, H, selectable, onSelect, onChange, registerRef, onDragStart, onDragMove, onDragEnd, onContextMenu }) {
  const ref = useRef(null)
  const img = useLayerImage(layer.url)
  useEffect(() => {
    registerRef(layer.id, ref.current)
    return () => registerRef(layer.id, null)
  }, [registerRef, layer.id, img])

  if (!img) return null

  function commitTransformEnd() {
    const node = ref.current
    if (!node) return
    const scaleX = node.scaleX(), scaleY = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    const w = Math.max(1, node.width() * scaleX), h = Math.max(1, node.height() * scaleY)
    node.width(w); node.height(h)
    onChange(layer.id, { x: node.x() / W, y: node.y() / H, w: w / W, h: h / H, rotation: node.rotation() })
  }

  return (
    <KonvaImage ref={ref} {...PERF} image={img}
      x={layer.x * W} y={layer.y * H} width={layer.w * W} height={layer.h * H}
      cornerRadius={(layer.cornerRadius || 0) * H}
      opacity={layer.opacity ?? 1} rotation={layer.rotation || 0}
      draggable={selectable && !layer.locked} listening={selectable}
      onMouseDown={onSelect} onTap={onSelect} onContextMenu={onContextMenu}
      onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}
      onTransformEnd={commitTransformEnd}
    />
  )
}

// ── Text ───────────────────────────────────────────────────────────────────
// Pre-rendered to a bitmap so Arabic shaping and wrapping are pixel-identical
// to the export (see textBitmap.js). Resize/rotate go through the shared
// Transformer like any other layer; commitTransformEnd converts the anchor
// drag's scale factor back into real size/w fractions so the NEXT render
// regenerates a crisp bitmap at the new font size rather than stretching the
// old one. Editing the words happens in an HTML overlay on double-click.
export function TextNode({ layer, W, H, epoch, selectable, hidden, onSelect, onChange, registerRef, onDragStart, onDragMove, onDragEnd, onEditStart, onContextMenu }) {
  const ref = useRef(null)
  useEffect(() => {
    registerRef(layer.id, ref.current)
    return () => registerRef(layer.id, null)
  }, [registerRef, layer.id])

  // `epoch` is bumped when a webfont finishes loading. Canvas draws with
  // whatever is resolved at the moment fillText runs (see fonts.js), so a
  // bitmap rasterised before the face arrived is wrong and has to be rebuilt
  // even though none of the layer's own values changed — hence it's part of
  // the cache key rather than something this memo alone knows about.
  const bmp = useMemo(() => buildTextBitmap(layer, W, H, epoch), [layer, W, H, epoch])

  function commitTransformEnd() {
    const node = ref.current
    if (!node) return
    const scaleX = node.scaleX(), scaleY = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    onChange(layer.id, {
      // A corner anchor scales both axes together (Konva's keepRatio), so
      // size and w move by the same factor; a side anchor only changes
      // scaleX, leaving size untouched — exactly Canva's "sides re-wrap,
      // corners resize the text" split, for free.
      size: Math.max(0.005, layer.size * scaleY),
      w: Math.max(0.02, layer.w * scaleX),
      rotation: node.rotation(),
      x: (node.x() + bmp.offsetX) / W, y: (node.y() + bmp.offsetY) / H,
    })
  }

  return (
    <KonvaImage ref={ref} {...PERF} image={bmp.canvas}
      x={layer.x * W - bmp.offsetX} y={layer.y * H - bmp.offsetY}
      width={bmp.width} height={bmp.height}
      opacity={hidden ? 0 : (layer.opacity ?? 1)}
      listening={selectable && !hidden}
      rotation={layer.rotation || 0}
      draggable={selectable && !layer.locked}
      onMouseDown={onSelect} onTap={onSelect} onContextMenu={onContextMenu}
      onDblClick={onEditStart} onDblTap={onEditStart}
      onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}
      onTransformEnd={commitTransformEnd}
    />
  )
}
