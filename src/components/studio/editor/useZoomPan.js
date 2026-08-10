import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ─── Zoom and pan ──────────────────────────────────────────────────────────
// The old editor had neither: the stage was locked to a fit-to-62vh scale, so
// on a 4096px generation one screen pixel was five document pixels and you
// could not get close enough to place a caption precisely. Canva's model,
// which this follows: the canvas floats inside a fixed viewport, the zoom
// level is a first-class piece of state shown in a status bar, and the
// keyboard owns fit/fill/100%.
//
// `view` is the Stage's own transform — {scale, x, y} in SCREEN pixels — so
// converting between document space and screen space is the same two lines
// everywhere (see toScreen/toDoc below), and the HTML overlays that have to
// sit on top of Konva nodes (the floating toolbar, the inline text editor)
// can be positioned without reading anything back out of Konva.

export const MIN_SCALE = 0.05
export const MAX_SCALE = 8
// Fit leaves a margin so the selection handles of an edge-hugging layer
// aren't clipped by the viewport, which is what Canva's fit does too.
const FIT_MARGIN = 0.94

const clamp = s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

export function useZoomPan(docW, docH) {
  const viewportNode = useRef(null)
  const observer = useRef(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [spaceDown, setSpaceDown] = useState(false)
  // Set once per document so reopening the editor always starts framed, but
  // never again — a resize of the window must not throw away the user's zoom.
  const framedFor = useRef(null)

  // A CALLBACK ref, not an object ref with a layout effect: the editor shows a
  // spinner until the source image has loaded, so the viewport element does
  // not exist on first render. A `useLayoutEffect(..., [])` would run against
  // a null node, never re-run, and leave the canvas permanently unmeasured —
  // which is exactly the "nothing renders" failure this replaced. A callback
  // ref fires whenever the element actually mounts or unmounts.
  const viewportRef = useCallback(node => {
    observer.current?.disconnect()
    observer.current = null
    viewportNode.current = node
    if (!node) return
    const measure = () => setViewport({ w: node.clientWidth, h: node.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    observer.current = ro
  }, [])

  useEffect(() => () => observer.current?.disconnect(), [])

  // Exposed as a getter rather than as the ref itself so the returned object
  // carries no refs — callers read the box inside event handlers only.
  const getViewportRect = useCallback(() => viewportNode.current?.getBoundingClientRect() || null, [])

  const fitScale = useMemo(() => {
    if (!docW || !docH || !viewport.w || !viewport.h) return 1
    return clamp(Math.min(viewport.w / docW, viewport.h / docH) * FIT_MARGIN)
  }, [docW, docH, viewport.w, viewport.h])

  const centreAt = useCallback(scale => ({
    scale,
    x: (viewport.w - docW * scale) / 2,
    y: (viewport.h - docH * scale) / 2,
  }), [viewport.w, viewport.h, docW, docH])

  const zoomToFit = useCallback(() => setView(centreAt(fitScale)), [centreAt, fitScale])
  const zoomToFill = useCallback(() => {
    const scale = clamp(Math.max(viewport.w / docW, viewport.h / docH))
    setView(centreAt(scale))
  }, [centreAt, viewport.w, viewport.h, docW, docH])
  const zoomToActual = useCallback(() => setView(centreAt(1)), [centreAt])

  useEffect(() => {
    if (!docW || !docH || !viewport.w) return
    const key = `${docW}x${docH}`
    if (framedFor.current === key) return
    framedFor.current = key
    setView(centreAt(fitScale))
  }, [docW, docH, viewport.w, viewport.h, fitScale, centreAt])

  // A window resize must not throw away the zoom the user chose, but leaving
  // the pan untouched slides the canvas towards a corner and can push it off
  // screen entirely. Shifting by half the size change keeps whatever was in
  // the middle in the middle, which is what every canvas tool does and what
  // makes a resize feel like the frame grew rather than the artwork moved.
  const lastViewport = useRef(null)
  useEffect(() => {
    if (!viewport.w || !viewport.h) return
    const prev = lastViewport.current
    lastViewport.current = viewport
    if (!prev || !prev.w || !prev.h) return
    const dx = (viewport.w - prev.w) / 2, dy = (viewport.h - prev.h) / 2
    if (dx || dy) setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }, [viewport])

  // Zoom about a fixed screen point — the pointer for a wheel/pinch, the
  // viewport centre for a keyboard shortcut. Keeping that point stationary is
  // what makes wheel-zoom feel like it's zooming at the cursor rather than
  // scrolling the canvas out from under it.
  const zoomAt = useCallback((nextScale, screenX, screenY) => {
    setView(v => {
      const scale = clamp(nextScale)
      if (scale === v.scale) return v
      const docX = (screenX - v.x) / v.scale
      const docY = (screenY - v.y) / v.scale
      return { scale, x: screenX - docX * scale, y: screenY - docY * scale }
    })
  }, [])

  const zoomBy = useCallback(factor => {
    setView(v => {
      const scale = clamp(v.scale * factor)
      if (scale === v.scale) return v
      const cx = viewport.w / 2, cy = viewport.h / 2
      const docX = (cx - v.x) / v.scale, docY = (cy - v.y) / v.scale
      return { scale, x: cx - docX * scale, y: cy - docY * scale }
    })
  }, [viewport.w, viewport.h])

  const panBy = useCallback((dx, dy) => setView(v => ({ ...v, x: v.x + dx, y: v.y + dy })), [])
  const setPan = useCallback((x, y) => setView(v => ({ ...v, x, y })), [])

  // Wheel: ctrlKey means a trackpad pinch or a ctrl-scroll — every browser
  // reports both that way — so that zooms. A plain wheel pans, matching the
  // scroll-to-pan behaviour of the canvas tools people arrive from.
  const onWheel = useCallback(e => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    const p = stage?.getPointerPosition()
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const factor = Math.exp(-e.evt.deltaY * 0.01)
      zoomAt(view.scale * factor, p?.x ?? viewport.w / 2, p?.y ?? viewport.h / 2)
    } else {
      panBy(-e.evt.deltaX, -e.evt.deltaY)
    }
  }, [zoomAt, panBy, view.scale, viewport.w, viewport.h])

  // Space-to-pan, the universal canvas idiom. Held rather than toggled, and
  // ignored while a text field has focus so typing a space in the inline text
  // editor doesn't turn the cursor into a grab hand.
  useEffect(() => {
    function isTyping(target) {
      const tag = target?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable
    }
    function down(e) {
      if (e.code === 'Space' && !isTyping(e.target)) { e.preventDefault(); setSpaceDown(true) }
    }
    function up(e) { if (e.code === 'Space') setSpaceDown(false) }
    // Losing focus mid-hold (alt-tab) would otherwise leave the canvas stuck
    // in pan mode with no key event ever arriving to clear it.
    function blur() { setSpaceDown(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const toScreen = useCallback((docX, docY) => ({
    x: docX * view.scale + view.x, y: docY * view.scale + view.y,
  }), [view])

  const toDoc = useCallback((screenX, screenY) => ({
    x: (screenX - view.x) / view.scale, y: (screenY - view.y) / view.scale,
  }), [view])

  return {
    viewportRef, getViewportRect, viewport, view, setView, spaceDown,
    fitScale, zoomToFit, zoomToFill, zoomToActual, zoomAt, zoomBy, panBy, setPan,
    onWheel, toScreen, toDoc,
  }
}
