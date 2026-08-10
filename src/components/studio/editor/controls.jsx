import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EMPTY_PALETTE, hasEyeDropper, loadRecentColors, normalizeHex, pickWithEyeDropper, pushRecentColor,
} from './model/palette'

// ─── Small shared controls for the editor chrome ───────────────────────────
// Deliberately not in src/components/ui — these are editor-density widgets
// (28px rows, 11px labels, no form semantics) and pushing them into the app's
// general UI kit would drag the rest of the app towards this density.

export function ToolbarButton({ children, title, active, disabled, danger, onClick, className = '' }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`h-8 min-w-8 shrink-0 px-2 flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-30 disabled:pointer-events-none ${
        danger ? 'text-red-600 hover:bg-red-50'
          : active ? 'bg-amber-100 text-amber-900'
            : 'text-text-secondary hover:bg-amber-50 hover:text-amber-800'
      } ${className}`}>
      {children}
    </button>
  )
}

export function ToolbarDivider() {
  return <span className="w-px h-5 bg-border shrink-0" />
}

// A numeric field that lets you type freely (including an empty box and a
// lone minus sign) and only reports a value when it parses — committing on
// every keystroke makes "12" impossible to type from "1".
export function NumberField({ label, value, onChange, onCommitStart, min, max, step = 1, suffix, className = '' }) {
  const [draft, setDraft] = useState(null)
  const shown = draft ?? (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '')

  function push(raw) {
    setDraft(raw)
    const n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n)) return
    onCommitStart?.()
    onChange(clamp(n, min, max))
  }

  return (
    <label className={`flex items-center gap-1.5 ${className}`}>
      {label && <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary w-4">{label}</span>}
      <span className="relative flex-1">
        <input
          type="number" value={shown} step={step} min={min} max={max}
          onChange={e => push(e.target.value)}
          onBlur={() => setDraft(null)}
          className="w-full h-8 rounded-lg border border-border bg-white pl-2 pr-1 text-[12px] text-text focus:outline-none focus:border-amber-400"
        />
        {suffix && <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-text-tertiary">{suffix}</span>}
      </span>
    </label>
  )
}

function clamp(n, min, max) {
  if (min != null && n < min) return min
  if (max != null && n > max) return max
  return n
}

// A slider whose drag is one undo step: onCommitStart fires on pointer-down,
// which is what marks the gesture in the history reducer (see
// useEditorHistory.js), and every subsequent frame just updates the present.
export function SliderField({ label, value, min, max, step, onChange, onCommitStart, onReset, format }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-medium text-text-secondary">{label}</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-text-tertiary">{format ? format(value) : value}</span>
          {onReset && (
            <button type="button" onClick={onReset} className="text-[10px] text-text-tertiary hover:text-amber-700">Reset</button>
          )}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onPointerDown={onCommitStart}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-amber-600" />
    </div>
  )
}

// ─── Popover ───────────────────────────────────────────────────────────────
// Every dropdown in the editor chrome goes through this, and it renders into
// document.body rather than next to its trigger.
//
// That is not a style choice. The top toolbar and the side panel are both
// scroll containers, and CSS clips an absolutely-positioned descendant to its
// nearest scrolling ancestor — in BOTH axes, because `overflow-x: auto`
// computes `overflow-y` to `auto` as well. With the panel inside the toolbar,
// every menu was being cut to the toolbar's own 45px height and handed a
// scrollbar: the colour swatches, the effects grid and the spacing sliders
// were all rendered but unreachable. A portal has no such ancestor, so the
// panel is clipped by the viewport and nothing else.
//
// The cost of leaving the subtree is that position has to be computed rather
// than inherited: `place()` below reads the trigger's rect and flips the panel
// above the trigger when there's no room under it (which is what the status
// bar's zoom menu needs, sitting at the bottom of the editor).

const POPOVER_GAP = 6
const VIEWPORT_PAD = 8
const MIN_PANEL_H = 160

// Popovers nest — the Effects menu holds a colour picker — and once both are
// portalled to <body> they're DOM SIBLINGS, so the outer one can no longer
// tell "a click in my child" from "a click outside me" by containment alone.
// Each panel therefore publishes an `owns(target)` predicate to its parent
// through this context (which follows the React tree, not the DOM), and the
// outside-click test asks the whole subtree rather than one node.
const PopoverParent = createContext(null)

// Two components rather than one so that EVERYTHING about an open menu —
// measured position, listeners, registration with the parent, and any state
// the content itself holds — comes into existence on open and is torn down on
// close. Guarding each of those with `if (!open)` inside one component means
// state that has to be reset in an effect, which is a cascading render and a
// class of stale-state bug this simply doesn't have.
function Popover({ open, ...props }) {
  if (!open) return null
  return <PopoverPanel {...props} />
}

function PopoverPanel({ onClose, anchorRef, width, align = 'start', className = '', children }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  const parent = useContext(PopoverParent)
  const childOwners = useRef(new Set())
  const owns = useCallback(target => (
    !!panelRef.current?.contains(target)
    || !!anchorRef.current?.contains(target)
    || [...childOwners.current].some(fn => fn(target))
  ), [anchorRef])

  useEffect(() => {
    if (!parent) return
    parent.add(owns)
    return () => parent.remove(owns)
  }, [parent, owns])

  const childApi = useMemo(() => ({
    add: fn => childOwners.current.add(fn),
    remove: fn => childOwners.current.delete(fn),
  }), [])

  useLayoutEffect(() => {
    function place() {
      const a = anchorRef.current?.getBoundingClientRect()
      const panel = panelRef.current
      if (!a || !panel) return
      const vw = window.innerWidth, vh = window.innerHeight
      const pw = panel.offsetWidth, ph = panel.offsetHeight

      let left = align === 'end' ? a.right - pw : a.left
      left = Math.max(VIEWPORT_PAD, Math.min(left, vw - pw - VIEWPORT_PAD))

      const roomBelow = vh - a.bottom - POPOVER_GAP - VIEWPORT_PAD
      const roomAbove = a.top - POPOVER_GAP - VIEWPORT_PAD
      // Prefer below, as a menu should; flip only when below genuinely can't
      // hold it and above can hold more.
      const below = roomBelow >= Math.min(ph, MIN_PANEL_H) || roomBelow >= roomAbove
      const maxHeight = Math.max(MIN_PANEL_H, below ? roomBelow : roomAbove)
      const top = below
        ? a.bottom + POPOVER_GAP
        : Math.max(VIEWPORT_PAD, a.top - Math.min(ph, maxHeight) - POPOVER_GAP)

      setPos({ left, top, maxHeight })
    }
    place()
    // Capture, so a scroll in ANY ancestor counts — including the toolbar's
    // own horizontal scroll, which moves the trigger without moving the page.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [align, anchorRef])

  useEffect(() => {
    function away(e) { if (!owns(e.target)) onClose() }
    function esc(e) {
      if (e.key !== 'Escape') return
      // An open child owns the key — Escape closes the innermost menu, not
      // the whole stack.
      if (childOwners.current.size) return
      // Swallowed on the way down: the editor's global Escape clears the
      // selection, and closing a menu must not also throw that away.
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose, owns])

  return createPortal(
    <PopoverParent.Provider value={childApi}>
      <div ref={panelRef}
        className={`fixed z-[80] overflow-y-auto overscroll-contain rounded-xl border border-border bg-white shadow-dropdown ${className}`}
        style={{
          width,
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          maxHeight: pos?.maxHeight,
          // Hidden for the one layout pass it takes to measure, so it never
          // flashes at the top-left corner.
          visibility: pos ? 'visible' : 'hidden',
        }}
        // Typing inside a menu (a hex value, a slider's arrow keys) must not
        // reach the editor's global shortcuts.
        onKeyDown={e => e.stopPropagation()}>
        {children}
      </div>
    </PopoverParent.Provider>,
    document.body,
  )
}

const DEFAULT_SWATCHES = [
  '#ffffff', '#f5f5f4', '#a8a29e', '#57534e', '#000000',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#d946ef', '#ec4899', '#d4af37', '#1a1410',
]

// ─── Colour ────────────────────────────────────────────────────────────────
// Canva's colour panel, in the space a toolbar swatch can afford. The point of
// it is that a generic rainbow grid is the LAST place you should be picking
// from: the useful colours are the ones already in the design, the ones in the
// photo you're captioning, the brand's own, and the one you used a minute ago.
// So the panel is a stack of sourced groups in that order, and the default
// grid sits at the bottom where it belongs.
//
// `palette` is {document, photo, brand, recent} — all derived in
// model/palette.js, all plain arrays of hex.

function SwatchGrid({ colors, value, onPick, label, hint }) {
  if (!colors.length) return null
  return (
    <div className="mb-2.5">
      <p className="mb-1 flex items-baseline gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
        {label}
        {hint && <span className="font-normal normal-case tracking-normal opacity-70">{hint}</span>}
      </p>
      <div className="grid grid-cols-6 gap-1.5">
        {colors.map(c => (
          <button key={c} type="button" title={c} onClick={() => onPick(c)}
            style={{ background: c }}
            className={`h-7 w-7 rounded-md border transition-transform hover:scale-110 ${
              c === value ? 'border-amber-500 ring-2 ring-amber-200' : 'border-black/10'
            }`} />
        ))}
      </div>
    </div>
  )
}

export function ColorField({
  value, onChange, onCommitStart, title = 'Colour', allowNone = false,
  palette = EMPTY_PALETTE,
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <span ref={anchorRef} className="inline-flex shrink-0">
        <button type="button" title={title} onClick={() => setOpen(o => !o)}
          className={`h-8 w-8 rounded-lg border p-1 hover:border-amber-400 ${open ? 'border-amber-500 ring-2 ring-amber-200' : 'border-border'}`}>
          <span className="block h-full w-full rounded-md border border-black/10"
            style={value
              ? { background: value }
              // A checkerboard reads as "no fill" without needing a label.
              : { backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%)', backgroundSize: '8px 8px', backgroundPosition: '0 0,4px 4px' }} />
        </button>
      </span>

      <Popover open={open} onClose={close} anchorRef={anchorRef} width={232} className="p-2.5">
        <ColorPanel value={value} onChange={onChange} onCommitStart={onCommitStart}
          title={title} allowNone={allowNone} palette={palette} onClose={close} />
      </Popover>
    </>
  )
}

// Mounted only while the popover is open (see Popover), which is what makes
// `useState(loadRecentColors)` correct: the store is re-read every time the
// panel appears, so a colour another field wrote a moment ago is already
// there, with no effect and no cascading render.
function ColorPanel({ value, onChange, onCommitStart, title, allowNone, palette, onClose }) {
  const [recent, setRecent] = useState(loadRecentColors)
  const [hexDraft, setHexDraft] = useState('')

  const pick = useCallback((c, { keepOpen = false } = {}) => {
    onCommitStart?.()
    onChange(c)
    // '' is "no fill" — a valid choice, but not a colour worth remembering.
    if (c) setRecent(pushRecentColor(c))
    if (!keepOpen) onClose()
  }, [onChange, onCommitStart, onClose])

  async function eyedrop() {
    const hex = await pickWithEyeDropper()
    if (hex) pick(hex)
  }

  // The default grid last, minus anything an earlier group already offered —
  // the same colour in two places makes the panel look arbitrary.
  const shown = [...palette.document, ...palette.photo, ...palette.brand, ...recent]
  const defaults = DEFAULT_SWATCHES.filter(c => !shown.includes(c))
  const empty = !shown.length

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-text">{title}</p>
        {allowNone && (
          <button type="button" onClick={() => pick('')}
            className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-tertiary hover:border-amber-400 hover:text-amber-800">
            ∅ None
          </button>
        )}
      </div>

      {/* Type it, sample it off the screen, or fall back to the OS wheel. */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="relative flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-text-tertiary">#</span>
          <input
            type="text" spellCheck={false} maxLength={7}
            placeholder={(value || '').replace('#', '') || 'hex'}
            value={hexDraft}
            onChange={e => {
              setHexDraft(e.target.value)
              // Applied the moment it parses, so typing the last digit of a
              // known code shows the result without a second action. Not
              // banked into "recently used" until blur or Enter, or every
              // half-typed prefix would end up in the history.
              const hex = normalizeHex(e.target.value)
              if (hex) { onCommitStart?.(); onChange(hex) }
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const hex = normalizeHex(e.currentTarget.value)
              if (hex) pick(hex)
            }}
            onBlur={e => {
              const hex = normalizeHex(e.target.value)
              if (hex) setRecent(pushRecentColor(hex))
            }}
            className="h-7 w-full rounded-md border border-border bg-white pl-4 pr-1.5 text-[11px] uppercase text-text focus:border-amber-400 focus:outline-none"
          />
        </span>
        {hasEyeDropper() && (
          <button type="button" title="Pick a colour from anywhere on screen" onClick={eyedrop}
            className="h-7 w-7 shrink-0 rounded-md border border-border text-[12px] leading-none hover:border-amber-400 hover:bg-amber-50">
            ⛏
          </button>
        )}
        {/* Left open while it changes: the OS picker streams values as you
            drag it, and closing on the first one would make it unusable. */}
        <input type="color" value={value || '#000000'} title="Custom colour"
          onChange={e => pick(e.target.value, { keepOpen: true })}
          className="h-7 w-8 shrink-0 cursor-pointer rounded-md border border-border bg-white p-0.5" />
      </div>

      <SwatchGrid label="In this design" colors={palette.document} value={value} onPick={pick} />
      <SwatchGrid label="From the photo" colors={palette.photo} value={value} onPick={pick} />
      <SwatchGrid label="Brand" colors={palette.brand} value={value} onPick={pick} />
      <SwatchGrid label="Recently used" colors={recent} value={value} onPick={pick} />
      <SwatchGrid label={empty ? 'Colours' : 'Default'} colors={defaults} value={value} onPick={pick} />
    </>
  )
}

// A generic dropdown for the top toolbar — used for the font list, weight and
// the aspect-ratio presets. Native <select> would be simpler, but it can't
// render a font preview in its options, which is the whole point for fonts.
// `closeOnClick` is off for menus that hold sliders or colour pickers rather
// than a list of choices — closing on the first pointer-down would make a
// slider impossible to drag.
export function ToolbarMenu({ label, title, width = 200, children, disabled, closeOnClick = true, align }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <span ref={anchorRef} className="inline-flex shrink-0">
        <ToolbarButton title={title} onClick={() => setOpen(o => !o)} disabled={disabled} active={open}>
          <span className="max-w-[130px] truncate">{label}</span>
          <span className="text-[9px] opacity-60">▾</span>
        </ToolbarButton>
      </span>
      <Popover open={open} onClose={close} anchorRef={anchorRef} width={width} align={align} className="p-1">
        <div onClick={closeOnClick ? close : undefined}>{children}</div>
      </Popover>
    </>
  )
}

export function MenuItem({ children, active, onClick, style }) {
  return (
    <button type="button" onClick={onClick} style={style}
      className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
        active ? 'bg-amber-100 text-amber-900' : 'text-text-secondary hover:bg-amber-50 hover:text-amber-800'
      }`}>
      {children}
    </button>
  )
}

export function PanelSection({ title, children, action }) {
  return (
    <div className="space-y-2">
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</p>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
