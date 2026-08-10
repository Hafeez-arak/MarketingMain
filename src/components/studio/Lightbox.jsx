import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { labelFor } from './labels'

// ─── Full-screen viewer ────────────────────────────────────────────────────
// The lane frame is sized to the window so the whole picture is always
// visible, but "visible" is not "inspectable" — checking whether Arabic
// letterforms actually joined correctly, or whether a lamp's reflection is
// right, needs real pixels. This is that: scroll to zoom toward the pointer,
// drag to pan, ← → to step through the lane's versions, Esc to leave.

// Pure, and deliberately outside the component: the wheel handler is a
// native listener registered once, so anything it calls must not be a new
// closure on every render. Zooms about a point (coordinates relative to the
// frame's centre) so the pixel under the cursor stays under the cursor —
// the thing that separates a viewer that feels precise from one that feels
// like it's fighting you.
function computeZoom(z, p, nextRaw, cx, cy) {
  const nz = Math.min(6, Math.max(1, nextRaw))
  const np = nz === 1
    ? { x: 0, y: 0 }
    : { x: cx - (cx - p.x) * (nz / z), y: cy - (cy - p.y) * (nz / z) }
  return { zoom: nz, pan: np }
}

export function Lightbox({ versions = [], startId, onClose, onDownload }) {
  const [idx, setIdx] = useState(() => {
    const i = versions.findIndex(v => v.id === startId)
    return i < 0 ? 0 : i
  })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  // Real state, not just a ref, because the cursor style is rendered from it.
  const [grabbing, setGrabbing] = useState(false)
  // Mirrored in refs so the wheel handler (a native listener, registered
  // once) can read the current transform without being torn down and
  // re-registered on every zoom step.
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const boxRef = useRef(null)
  const dragRef = useRef(null)

  const current = versions[idx] || null
  const isVideo = current?.media_type === 'video' && current?.video_url

  function setTransform(nextZoom, nextPan) {
    zoomRef.current = nextZoom
    panRef.current = nextPan
    setZoom(nextZoom)
    setPan(nextPan)
  }

  function zoomAt(nextRaw, cx, cy) {
    const next = computeZoom(zoomRef.current, panRef.current, nextRaw, cx, cy)
    setTransform(next.zoom, next.pan)
  }

  function go(delta) {
    setIdx(i => Math.min(versions.length - 1, Math.max(0, i + delta)))
    setTransform(1, { x: 0, y: 0 })
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight') { setIdx(i => Math.min(versions.length - 1, i + 1)); setTransform(1, { x: 0, y: 0 }) }
      if (e.key === 'ArrowLeft')  { setIdx(i => Math.max(0, i - 1)); setTransform(1, { x: 0, y: 0 }) }
      if (e.key === '0')          { setTransform(1, { x: 0, y: 0 }) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, versions.length])

  // The page behind must not scroll while this is open, or dismissing the
  // viewer drops you somewhere other than where you left.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Registered natively rather than via onWheel: React's wheel listener is
  // passive, so preventDefault() there is ignored and the page scrolls behind
  // the viewer while you're trying to zoom.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const next = computeZoom(
        zoomRef.current, panRef.current,
        zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15),
        e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2,
      )
      zoomRef.current = next.zoom
      panRef.current = next.pan
      setZoom(next.zoom)
      setPan(next.pan)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (!current) return null

  function onMouseDown(e) {
    if (zoomRef.current === 1) return
    dragRef.current = { x: e.clientX, y: e.clientY, p: panRef.current }
    setGrabbing(true)
  }
  function onMouseMove(e) {
    const d = dragRef.current
    if (!d) return
    setTransform(zoomRef.current, { x: d.p.x + (e.clientX - d.x), y: d.p.y + (e.clientY - d.y) })
  }
  function endDrag() { dragRef.current = null; setGrabbing(false) }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'rgba(20,16,13,0.92)' }}>
      {/* ── Bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 text-white/80">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-wide">{labelFor(current) || 'Version'}</span>
          {versions.length > 1 && <span className="text-[11px] text-white/50">{idx + 1} of {versions.length}</span>}
          {zoom > 1 && <span className="text-[11px] text-white/50">{Math.round(zoom * 100)}%</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {zoom > 1 && (
            <button type="button" onClick={() => setTransform(1, { x: 0, y: 0 })}
              className="px-2.5 py-1 text-[11px] font-medium border border-white/25 hover:bg-white/10 transition-colors">
              Fit
            </button>
          )}
          {onDownload && (
            <button type="button" onClick={() => onDownload(current)}
              className="px-2.5 py-1 text-[11px] font-medium border border-white/25 hover:bg-white/10 transition-colors">
              ⬇ Download
            </button>
          )}
          <button type="button" onClick={onClose} title="Close (Esc)"
            className="w-7 h-7 flex items-center justify-center border border-white/25 hover:bg-white/10 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {/* ── Stage ── */}
      <div ref={boxRef}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={endDrag} onMouseLeave={endDrag}
        onDoubleClick={e => {
          const r = boxRef.current.getBoundingClientRect()
          zoomAt(zoomRef.current > 1 ? 1 : 2.5,
            e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
        }}
        // Clicking the backdrop leaves; clicking the picture must not, or
        // every attempt to grab and pan closes the thing you're inspecting.
        onClick={e => { if (e.target === boxRef.current) onClose() }}
        className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden select-none"
        style={{ cursor: zoom > 1 ? (grabbing ? 'grabbing' : 'grab') : 'zoom-in' }}
      >
        {isVideo ? (
          <video src={current.video_url} controls autoPlay playsInline
            className="max-h-full max-w-full" onClick={e => e.stopPropagation()} />
        ) : (
          <img src={current.image_url} alt="" draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            className="max-h-full max-w-full object-contain transition-transform duration-75" />
        )}

        {versions.length > 1 && (
          <>
            <button type="button" disabled={idx === 0} onClick={e => { e.stopPropagation(); go(-1) }}
              className="absolute left-3 w-9 h-9 flex items-center justify-center text-white border border-white/25 hover:bg-white/10 disabled:opacity-20 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>
            </button>
            <button type="button" disabled={idx === versions.length - 1} onClick={e => { e.stopPropagation(); go(1) }}
              className="absolute right-3 w-9 h-9 flex items-center justify-center text-white border border-white/25 hover:bg-white/10 disabled:opacity-20 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
            </button>
          </>
        )}
      </div>

      {current.user_prompt && (
        <p className="flex-shrink-0 px-4 py-2 text-[11px] text-white/55 text-center line-clamp-2">{current.user_prompt}</p>
      )}
    </div>,
    document.body,
  )
}
