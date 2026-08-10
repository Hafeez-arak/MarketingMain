import { useEffect, useRef, useState } from 'react'

// ─── Small shared controls for the editor chrome ───────────────────────────
// Deliberately not in src/components/ui — these are editor-density widgets
// (28px rows, 11px labels, no form semantics) and pushing them into the app's
// general UI kit would drag the rest of the app towards this density.

export function ToolbarButton({ children, title, active, disabled, danger, onClick, className = '' }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`h-8 min-w-8 px-2 flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-30 disabled:pointer-events-none ${
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

const SWATCHES = [
  '#ffffff', '#000000', '#d4af37', '#c8a24a', '#1a1410',
  '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6',
]

// Colour as a popover rather than a bare <input type="color"> so the common
// case (a brand colour, black, white) is one click, and the OS picker is
// still there for everything else — Canva's colour panel, compressed.
export function ColorField({ value, onChange, onCommitStart, title = 'Colour', allowNone = false, documentColors = [] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function away(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  const swatches = [...new Set([...documentColors, ...SWATCHES])].slice(0, 20)

  return (
    <span className="relative" ref={ref}>
      <button type="button" title={title} onClick={() => setOpen(o => !o)}
        className="h-8 w-8 rounded-lg border border-border p-1 hover:border-amber-400">
        <span className="block h-full w-full rounded-md border border-black/10"
          style={value
            ? { background: value }
            // A checkerboard reads as "no fill" without needing a label.
            : { backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%)', backgroundSize: '8px 8px', backgroundPosition: '0 0,4px 4px' }} />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-[188px] rounded-xl border border-border bg-white p-2 shadow-dropdown">
          <div className="grid grid-cols-5 gap-1.5">
            {allowNone && (
              <button type="button" title="None" onClick={() => { onCommitStart?.(); onChange('') }}
                className="h-7 w-7 rounded-md border border-border text-[11px] text-text-tertiary hover:border-amber-400">∅</button>
            )}
            {swatches.map(c => (
              <button key={c} type="button" title={c} onClick={() => { onCommitStart?.(); onChange(c) }}
                style={{ background: c }}
                className={`h-7 w-7 rounded-md border ${c === value ? 'border-amber-500 ring-2 ring-amber-200' : 'border-border'}`} />
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-text-secondary">
            <input type="color" value={value || '#000000'}
              onChange={e => { onCommitStart?.(); onChange(e.target.value) }}
              className="h-7 w-9 cursor-pointer rounded-md border border-border bg-white" />
            Custom
          </label>
        </div>
      )}
    </span>
  )
}

// A generic dropdown for the top toolbar — used for the font list, weight and
// the aspect-ratio presets. Native <select> would be simpler, but it can't
// render a font preview in its options, which is the whole point for fonts.
// `closeOnClick` is off for menus that hold sliders or colour pickers rather
// than a list of choices — closing on the first pointer-down would make a
// slider impossible to drag.
export function ToolbarMenu({ label, title, width = 200, children, disabled, closeOnClick = true }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function away(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  return (
    <span className="relative" ref={ref}>
      <ToolbarButton title={title} onClick={() => setOpen(o => !o)} disabled={disabled} active={open}>
        <span className="max-w-[130px] truncate">{label}</span>
        <span className="text-[9px] opacity-60">▾</span>
      </ToolbarButton>
      {open && (
        <div className="absolute z-40 mt-1 max-h-[340px] overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-dropdown"
          style={{ width }}
          onClick={closeOnClick ? () => setOpen(false) : undefined}>
          {children}
        </div>
      )}
    </span>
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
