import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PostImage } from './ui/index'

// ─── Looking at a post's pictures, and putting a carousel in order ─────────
// The planner showed a post's picture as an 80px square that did nothing when
// clicked, and a carousel as its first slide alone — the other slides and
// their order were invisible until the post was already in the queue.
//
// Two pieces:
//   MediaViewer  full-screen, every slide, ← → and Esc
//   SlideStrip   every slide as a numbered thumbnail; drag (or the arrows)
//                to reorder, click to open the viewer. Reordering is only
//                offered when `onReorder` is given — a post that has gone out
//                shows its slides but cannot move them.

export function MediaViewer({ urls = [], videoUrl = '', start = 0, onClose }) {
  const items = videoUrl ? [{ type: 'video', url: videoUrl }] : urls.filter(Boolean).map(url => ({ type: 'image', url }))
  const [idx, setIdx] = useState(Math.min(Math.max(0, start), Math.max(0, items.length - 1)))
  const count = items.length

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIdx(i => Math.min(count - 1, i + 1))
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, onClose])

  const current = items[idx]
  if (!current) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3 p-4 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.88)' }} role="dialog" aria-modal="true" aria-label="Post media"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <button onClick={onClose} aria-label="Close"
        className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center text-white/80 hover:text-white text-xl">✕</button>

      <div className="relative flex items-center justify-center w-full flex-1 min-h-0" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        {current.type === 'video'
          ? <video src={current.url} controls className="max-w-full max-h-full" />
          : <PostImage src={current.url} alt={`Slide ${idx + 1}`} className="max-w-full max-h-full object-contain" />}
        {count > 1 && (
          <>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Previous"
              className="absolute left-0 sm:left-2 w-10 h-10 bg-black/50 text-white text-lg disabled:opacity-30">‹</button>
            <button onClick={() => setIdx(i => Math.min(count - 1, i + 1))} disabled={idx === count - 1} aria-label="Next"
              className="absolute right-0 sm:right-2 w-10 h-10 bg-black/50 text-white text-lg disabled:opacity-30">›</button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex items-center gap-2 max-w-full overflow-x-auto pb-1">
          {items.map((it, i) => (
            <button key={`${it.url}-${i}`} onClick={() => setIdx(i)}
              className={`relative w-12 h-12 flex-shrink-0 border-2 ${i === idx ? 'border-amber-400' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              <PostImage src={it.url} alt="" className="w-full h-full object-cover" />
              <span className="absolute bottom-0 left-0 text-[9px] font-bold bg-black/70 text-white px-1">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-white/70">{count > 1 ? `Slide ${idx + 1} of ${count} · ← → to step, Esc to close` : 'Esc to close'}</p>
    </div>,
    document.body,
  )
}

// Numbered slides, reorderable. `onReorder(nextUrls)` receives the whole new
// order; the caller persists it.
export function SlideStrip({ urls = [], onOpen, onReorder, size = 'w-12 h-12' }) {
  const dragFrom = useRef(null)
  const [over, setOver] = useState(null)
  const list = urls.filter(Boolean)
  if (list.length < 2) return null

  function move(from, to) {
    if (to < 0 || to >= list.length || from === to) return
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onReorder?.(next)
  }

  return (
    <div className="flex items-start gap-1.5 flex-wrap">
      {list.map((url, i) => (
        <div key={`${url}-${i}`}
          draggable={!!onReorder}
          onDragStart={e => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={e => { if (!onReorder) return; e.preventDefault(); setOver(i) }}
          onDragLeave={() => setOver(o => (o === i ? null : o))}
          onDrop={e => { e.preventDefault(); setOver(null); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null }}
          onDragEnd={() => { dragFrom.current = null; setOver(null) }}
          className={`group relative flex flex-col items-center ${onReorder ? 'cursor-grab active:cursor-grabbing' : ''}`}>
          <button type="button" onClick={() => onOpen?.(i)} title={`Open slide ${i + 1}`}
            className={`relative ${size} border overflow-hidden ${over === i ? 'border-amber-500 ring-2 ring-amber-300' : 'border-border hover:border-amber-400'}`}>
            <PostImage src={url} alt={`Slide ${i + 1}`} className="w-full h-full object-cover pointer-events-none" />
            <span className="absolute top-0 left-0 text-[9px] font-bold bg-black/70 text-white px-1 leading-[1.5]">{i + 1}</span>
          </button>
          {onReorder && (
            <span className="flex">
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move slide ${i + 1} earlier`}
                className="text-sm font-semibold leading-none w-6 h-5 text-text-secondary hover:text-amber-700 hover:bg-amber-50 disabled:opacity-20 disabled:hover:bg-transparent">‹</button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === list.length - 1} aria-label={`Move slide ${i + 1} later`}
                className="text-sm font-semibold leading-none w-6 h-5 text-text-secondary hover:text-amber-700 hover:bg-amber-50 disabled:opacity-20 disabled:hover:bg-transparent">›</button>
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
