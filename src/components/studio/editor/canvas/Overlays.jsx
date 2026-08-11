import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { autoDirectionPatch } from '../../overlayModel'
import { buildTextBitmap } from '../model/textBitmap'

// ─── HTML overlays that sit on top of the Konva canvas ─────────────────────
// Plain DOM rather than Konva shapes: text and icons stay crisp at any zoom,
// focus and keyboard behaviour come for free, and none of it has to be
// re-implemented as canvas hit-testing. Everything here is positioned from
// document coordinates through the view transform, so it tracks zoom and pan
// without ever reading back out of Konva.

// ── The pill above the selection ───────────────────────────────────────────
// Canva's element toolbar minus the parts we don't have (comments, AI, apps).
export function FloatingToolbar({ box, toScreen, scale, locked, multiple, canForward, canBackward, onDuplicate, onDelete, onToggleLock, onForward, onBackward, onMore }) {
  const GAP = 12, HEIGHT = 36
  const ref = useRef(null)
  const topLeft = toScreen(box.left, box.top)
  const bottomLeft = toScreen(box.left, box.bottom)
  const above = topLeft.y - HEIGHT - GAP >= 4
  const top = above ? topLeft.y - HEIGHT - GAP : bottomLeft.y + GAP
  const wanted = topLeft.x + (box.width * scale) / 2

  // Keep the pill inside the canvas viewport: a selection hugging the left or
  // right edge would otherwise centre the toolbar half-off screen, and its
  // buttons would be unreachable exactly when you most want them.
  const [left, setLeft] = useState(wanted)
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.offsetParent
    if (!el || !parent) { setLeft(wanted); return }
    const half = el.offsetWidth / 2 + 6
    setLeft(Math.max(half, Math.min(wanted, parent.clientWidth - half)))
  }, [wanted])

  return (
    <div
      ref={ref}
      className="absolute z-20 flex items-center gap-0.5 border border-border bg-white px-1 py-1 shadow-dropdown"
      style={{ left, top, transform: 'translateX(-50%)' }}
      onMouseDown={e => e.stopPropagation()}
    >
      <PillButton title="Send backward" onClick={onBackward} disabled={!canBackward}>↓</PillButton>
      <PillButton title="Bring forward" onClick={onForward} disabled={!canForward}>↑</PillButton>
      <span className="w-px h-4 bg-border mx-0.5" />
      <PillButton title={locked ? 'Unlock' : 'Lock'} onClick={onToggleLock}>{locked ? '🔒' : '🔓'}</PillButton>
      <PillButton title={multiple ? 'Duplicate selection' : 'Duplicate'} onClick={onDuplicate}>⧉</PillButton>
      <PillButton title="More actions" onClick={onMore}>⋯</PillButton>
      <span className="w-px h-4 bg-border mx-0.5" />
      <PillButton title="Delete" danger onClick={onDelete}>×</PillButton>
    </div>
  )
}

function PillButton({ children, title, danger, disabled, onClick }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center text-sm leading-none transition-colors disabled:opacity-30 disabled:pointer-events-none ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-text-secondary hover:bg-amber-50 hover:text-amber-800'
      }`}>
      {children}
    </button>
  )
}

// ── Edit text right on the canvas ──────────────────────────────────────────
// A plain <textarea> positioned over the (hidden) Konva bitmap; styled to
// approximate the real render closely enough to type against, not to be
// pixel-exact — the bitmap that reappears on close is what's pixel-exact.
export function InlineTextEditor({ layer, W, H, scale, toScreen, onChange, onClose }) {
  const ref = useRef(null)
  const bmp = useMemo(() => buildTextBitmap(layer, W, H), [layer, W, H])
  const pos = toScreen(layer.x * W - bmp.offsetX, layer.y * H - bmp.offsetY)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <textarea
      ref={ref}
      value={layer.text}
      dir={layer.dir}
      onChange={e => onChange(autoDirectionPatch(layer, e.target.value))}
      onBlur={onClose}
      onMouseDown={e => e.stopPropagation()}
      onKeyDown={e => {
        // Esc ends the edit. Everything else has to stop here or the editor's
        // global shortcuts would read plain typing as commands.
        e.stopPropagation()
        if (e.key === 'Escape') e.currentTarget.blur()
      }}
      className="absolute z-20 bg-transparent outline-none resize-none overflow-hidden"
      style={{
        left: pos.x, top: pos.y,
        width: bmp.width * scale, height: bmp.height * scale,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: '0 0',
        fontFamily: `"${layer.family}", sans-serif`, fontWeight: layer.weight,
        fontSize: layer.size * H * scale, lineHeight: layer.lineHeight,
        color: layer.color, textAlign: layer.align, direction: layer.dir,
        padding: bmp.offsetX * scale,
        border: `1.5px dashed ${'#f59e0b'}`, borderRadius: 4, caretColor: '#f59e0b',
      }}
    />
  )
}

// ── Right-click menu ───────────────────────────────────────────────────────
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  // Right-clicking near the right or bottom edge of the canvas would otherwise
  // put half the menu outside the viewport. Measured after mount rather than
  // guessed from an assumed height, because the item list is built from the
  // current selection and isn't a fixed size.
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.offsetParent
    if (!el || !parent) { setPos({ x, y }); return }
    const PAD = 6
    const maxX = parent.clientWidth - el.offsetWidth - PAD
    const maxY = parent.clientHeight - el.offsetHeight - PAD
    setPos({ x: Math.max(PAD, Math.min(x, maxX)), y: Math.max(PAD, Math.min(y, maxY)) })
  }, [x, y, items.length])

  useEffect(() => {
    function away(e) { if (!ref.current?.contains(e.target)) onClose() }
    function esc(e) { if (e.key === 'Escape') onClose() }
    // `capture` so the dismissal wins over the canvas's own mousedown, which
    // would otherwise change the selection out from under the menu.
    window.addEventListener('mousedown', away, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away, true)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div ref={ref}
      className="absolute z-30 min-w-[190px] rounded-xl border border-border bg-white py-1 shadow-dropdown"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        item.separator ? <div key={`sep${i}`} className="my-1 h-px bg-border" /> : (
          <button key={item.label} type="button" disabled={item.disabled}
            onClick={() => { item.onClick(); onClose() }}
            className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-30 disabled:pointer-events-none ${
              item.danger ? 'text-red-600 hover:bg-red-50' : 'text-text-secondary hover:bg-amber-50 hover:text-amber-800'
            }`}>
            <span>{item.label}</span>
            {item.hint && <span className="text-[10px] text-text-tertiary">{item.hint}</span>}
          </button>
        )
      ))}
    </div>
  )
}
