import { useRef, useState } from 'react'
import { Spinner } from '../../../ui/index'
import { ADJUST_KEYS, ADJUST_RANGE } from '../model/adjust'
import { SliderField, PanelSection, ToolbarButton } from '../controls'
import { PositionPanel } from './PositionPanel'

// ─── The left rail and its panels ──────────────────────────────────────────
// Canva's side panel is where you INSERT things (text, elements, uploads) and
// where the occasional whole-photo tool lives (adjust, crop). Selection
// styling belongs in the toolbar above the canvas, not here — see
// TopToolbar.jsx.

const RAIL = [
  { id: 'insert', icon: '✚', label: 'Add' },
  { id: 'uploads', icon: '▣', label: 'Images' },
  { id: 'adjust', icon: '🎚', label: 'Adjust' },
  { id: 'position', icon: '⌗', label: 'Position' },
]

export function SidePanel({ panel, onOpenPanel, children }) {
  return (
    <div className="flex min-h-0">
      <div className="flex w-[62px] shrink-0 flex-col gap-1 border-r border-border bg-surface-subtle/40 p-1.5">
        {RAIL.map(item => (
          <button key={item.id} type="button" onClick={() => onOpenPanel(item.id)}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-medium transition-colors ${
              panel === item.id ? 'bg-amber-100 text-amber-900' : 'text-text-tertiary hover:bg-white hover:text-amber-800'
            }`}>
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div className="w-[248px] shrink-0 overflow-y-auto p-3">{children}</div>
    </div>
  )
}

// ── Add: text and shapes ───────────────────────────────────────────────────
// Three text presets rather than one generic box, because "add a heading"
// is the actual intent nine times out of ten and picking a size afterwards is
// friction. The fractions are of document height, like every other size.
const TEXT_PRESETS = [
  { label: 'Add a heading', size: 0.11, weight: 900, className: 'text-lg font-extrabold' },
  { label: 'Add a subheading', size: 0.07, weight: 700, className: 'text-sm font-bold' },
  { label: 'Add body text', size: 0.045, weight: 400, className: 'text-xs' },
]

const SHAPES = [
  { id: 'rect', icon: '▭', label: 'Rectangle' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse' },
  { id: 'line', icon: '／', label: 'Line' },
  { id: 'arrow', icon: '→', label: 'Arrow' },
]

export function InsertPanel({ onAddText, onAddShape }) {
  return (
    <div className="space-y-4">
      <PanelSection title="Text">
        <div className="space-y-1.5">
          {TEXT_PRESETS.map(p => (
            <button key={p.label} type="button"
              onClick={() => onAddText({ size: p.size, weight: p.weight, text: p.label.replace('Add a ', '').replace('Add ', '') })}
              className={`w-full rounded-lg border border-border bg-white px-3 py-2.5 text-left text-text hover:border-amber-400 hover:bg-amber-50 ${p.className}`}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary">Shortcut: press T. Typing Arabic switches the box to RTL and an Arabic face on its own.</p>
      </PanelSection>

      <PanelSection title="Elements">
        <div className="grid grid-cols-2 gap-1.5">
          {SHAPES.map(s => (
            <button key={s.id} type="button" onClick={() => onAddShape(s.id)}
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-white py-3 text-[11px] text-text-secondary hover:border-amber-400 hover:bg-amber-50">
              <span className="text-lg leading-none">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </PanelSection>
    </div>
  )
}

// ── Images ─────────────────────────────────────────────────────────────────
// Two sources: a file from the marketer's machine, and anything already
// generated in this session — which is the one people actually reach for, to
// drop a logo or an earlier crop onto a new background.
export function UploadsPanel({ onUploadImage, onAddImage, library = [] }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!onUploadImage) { setError('Uploading is not available here.'); return }
    setBusy(true); setError('')
    const res = await onUploadImage(file)
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    if (res?.url) onAddImage(res.url)
  }

  return (
    <div className="space-y-4">
      <PanelSection title="Upload">
        <button type="button" disabled={busy || !onUploadImage} onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white py-6 text-[11px] text-text-secondary hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50">
          {busy ? <><Spinner size="sm" /> Uploading…</> : '＋ Upload an image'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </PanelSection>

      <PanelSection title="From this session">
        {library.length === 0
          ? <p className="text-[11px] text-text-tertiary">Nothing generated in this session yet.</p>
          : (
            <div className="grid grid-cols-2 gap-1.5">
              {library.map(item => (
                <button key={item.url} type="button" onClick={() => onAddImage(item.url)}
                  title={item.label || 'Add to canvas'}
                  className="aspect-square overflow-hidden rounded-lg border border-border bg-surface-subtle hover:border-amber-400">
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
      </PanelSection>
    </div>
  )
}

// ── Adjust ─────────────────────────────────────────────────────────────────
export function AdjustPanel({ adjust, onChange, onBeginChange, onResetAll }) {
  const dirty = ADJUST_KEYS.some(k => adjust[k])
  return (
    <div className="space-y-4">
      <PanelSection title="Adjust the photo" action={
        dirty ? <button type="button" onClick={onResetAll} className="text-[10px] text-text-tertiary hover:text-amber-700">Reset all</button> : null
      }>
        <div className="space-y-3">
          {ADJUST_KEYS.map(key => (
            <SliderField key={key} label={key[0].toUpperCase() + key.slice(1)}
              value={adjust[key] || 0}
              min={ADJUST_RANGE[key][0]} max={ADJUST_RANGE[key][1]} step={1}
              onCommitStart={onBeginChange}
              onChange={v => onChange(key, v)}
              onReset={adjust[key] ? () => { onBeginChange(); onChange(key, 0) } : null}
            />
          ))}
        </div>
      </PanelSection>
      <p className="text-[11px] leading-relaxed text-text-tertiary">
        Applies to the photo only — text, shapes and image layers are untouched.
        The preview is filtered at screen resolution; the export is filtered at full resolution.
      </p>
    </div>
  )
}

// ── Crop ───────────────────────────────────────────────────────────────────
const RATIOS = [
  { label: 'Freeform', value: null },
  { label: 'Square 1:1', value: 1 },
  { label: 'Portrait 4:5', value: 4 / 5 },
  { label: 'Portrait 3:4', value: 3 / 4 },
  { label: 'Story 9:16', value: 9 / 16 },
  { label: 'Landscape 16:9', value: 16 / 9 },
  { label: 'Landscape 3:2', value: 3 / 2 },
]

export function CropPanel({ doc, cropRect, onSetRatio, onApply, onCancel }) {
  return (
    <div className="space-y-4">
      <PanelSection title="Crop">
        <div className="space-y-1">
          {RATIOS.map(r => (
            <button key={r.label} type="button" onClick={() => onSetRatio(r.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-1.5 text-left text-[11px] text-text-secondary hover:border-amber-400 hover:bg-amber-50">
              {r.label}
            </button>
          ))}
        </div>
      </PanelSection>
      {cropRect && (
        <p className="text-[11px] text-text-tertiary">
          New size: {Math.round(cropRect.w)} × {Math.round(cropRect.h)} px
          <span className="block">(was {doc.width} × {doc.height})</span>
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-text-tertiary">
        Everything on the layers stays where it is relative to the photo — the crop moves the frame around it.
      </p>
      <div className="flex gap-2">
        <ToolbarButton onClick={onCancel} className="flex-1 justify-center border border-border">Cancel</ToolbarButton>
        <ToolbarButton onClick={onApply} className="flex-1 justify-center border border-amber-500 bg-amber-100 text-amber-900">Apply crop</ToolbarButton>
      </div>
    </div>
  )
}

export { PositionPanel }
