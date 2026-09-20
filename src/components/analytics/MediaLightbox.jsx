import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

// ─── The picture, full size ────────────────────────────────────────────────
//
// A 112px thumbnail is enough to recognise a post and not enough to look at
// one, and looking at it is half of why somebody opens a post that did well.
//
// ── WHY IT KNOWS ABOUT CAROUSELS ──
//
// `mediaItems` carries one entry per slide — `{ type, url, thumbnail }` —
// and a carousel's thumbnail is only its first frame. Zooming to that one
// frame would answer "which post is this" a second time instead of "what was
// in it", so all the slides are here with the count, and arrow keys move
// between them.
//
// ── WHY IT CAPTURES ESCAPE ──
//
// It opens on top of the post Modal, which closes itself on Escape via its
// own document listener. Both listeners are on `document`, and the Modal's
// was added first, so in the bubble phase it would run either way and one
// Escape would shut both — the picture AND the post behind it. This listens
// in the CAPTURE phase, which reaches `document` before the target and
// therefore before the Modal's, and stops the event there. So Escape closes
// the picture, and a second Escape closes the post.

export function MediaLightbox({ items = [], index = 0, onIndex, onClose }) {
  const count = items.length
  const item = items[Math.max(0, Math.min(index, count - 1))]

  const move = useCallback(step => {
    if (count < 2) return
    onIndex(((index + step) % count + count) % count)
  }, [count, index, onIndex])

  useEffect(() => {
    if (!item) return undefined
    const fn = e => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation()
        move(1)
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation()
        move(-1)
      }
    }
    document.addEventListener('keydown', fn, true)
    return () => document.removeEventListener('keydown', fn, true)
  }, [item, onClose, move])

  if (!item) return null

  const arrow = 'w-9 h-9 flex items-center justify-center text-white/80 hover:text-white ' +
    'border border-white/25 hover:border-white/60 transition-colors flex-shrink-0'

  return createPortal(
    // Above the Modal's own z-50.
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 p-4"
      style={{ background: 'rgba(12,15,14,0.88)' }}
      onClick={onClose}>
      <div className="flex items-center gap-3 max-w-full" onClick={e => e.stopPropagation()}>
        {count > 1 && (
          <button className={arrow} onClick={() => move(-1)} aria-label="Previous">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        )}

        {item.type === 'video' ? (
          <video src={item.url} controls autoPlay
            className="max-w-[86vw] max-h-[82vh] object-contain bg-black" />
        ) : (
          <img src={item.url || item.thumbnail} alt=""
            className="max-w-[86vw] max-h-[82vh] object-contain" />
        )}

        {count > 1 && (
          <button className={arrow} onClick={() => move(1)} aria-label="Next">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-[11px] text-white/70" onClick={e => e.stopPropagation()}>
        {count > 1 && <span className="tabular-nums">{index + 1} of {count}</span>}
        <button onClick={onClose} className="hover:text-white underline">Close</button>
      </div>
    </div>,
    document.body,
  )
}
