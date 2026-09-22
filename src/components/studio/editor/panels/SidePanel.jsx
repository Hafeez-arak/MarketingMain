import { useEffect, useRef, useState } from 'react'
import { Spinner } from '../../../ui/index'
import { fetchMediaLibrary } from '../../../../lib/mediaLibrary'
import { fetchBrandAssets } from '../../../../lib/brandAssets'
import {
  ADJUST_GROUPS, ADJUST_LABELS, ADJUST_RANGE,
  FILTER_PRESETS, matchPreset, hasAdjustments,
} from '../model/adjust'
import { isFullFrame, CORNERS } from '../model/document'
import { SliderField, PanelSection, ToolbarButton } from '../controls'
import {
  IconAdjust, IconArrow, IconEllipse, IconImage, IconLayers, IconLine, IconPolygon,
  IconPlus, IconRect, IconStar, IconTriangle, IconUpload,
} from '../icons'
import { PositionPanel } from './PositionPanel'

// ─── The left rail and its panels ──────────────────────────────────────────
// Canva's side panel is where you INSERT things (text, elements, uploads) and
// where the occasional whole-photo tool lives (adjust, crop). Selection
// styling belongs in the toolbar above the canvas, not here — see
// TopToolbar.jsx.

const RAIL = [
  { id: 'insert', Icon: IconPlus, label: 'Add' },
  { id: 'uploads', Icon: IconImage, label: 'Images' },
  { id: 'adjust', Icon: IconAdjust, label: 'Adjust' },
  { id: 'position', Icon: IconLayers, label: 'Position' },
]

// `hide` drops rail entries that cannot apply in the current mode — video mode
// hides Adjust, because a photo adjustment has no way to reach the footage
// underneath a composited PNG. Hiding beats disabling: a greyed-out slider
// still reads as "this should work and doesn't".
export function SidePanel({ panel, onOpenPanel, hide = [], children }) {
  return (
    <div className="flex min-h-0">
      <div className="flex w-[62px] shrink-0 flex-col gap-1 border-r border-border bg-surface-subtle p-1.5">
        {RAIL.filter(item => !hide.includes(item.id)).map(({ id, Icon, label }) => (
          <button key={id} type="button" onClick={() => onOpenPanel(id)}
            className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors ${
              panel === id ? 'bg-amber-100 text-amber-900' : 'text-text-tertiary hover:bg-white hover:text-amber-800'
            }`}>
            <Icon className="h-[18px] w-[18px]" />
            {label}
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
  { id: 'rect', Icon: IconRect, label: 'Rectangle' },
  { id: 'ellipse', Icon: IconEllipse, label: 'Ellipse' },
  { id: 'triangle', Icon: IconTriangle, label: 'Triangle' },
  { id: 'polygon', Icon: IconPolygon, label: 'Polygon' },
  { id: 'star', Icon: IconStar, label: 'Star' },
  { id: 'line', Icon: IconLine, label: 'Line' },
  { id: 'arrow', Icon: IconArrow, label: 'Arrow' },
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
          {SHAPES.map(({ id, Icon, label }) => (
            <button key={id} type="button" onClick={() => onAddShape(id)}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-white py-3 text-[11px] text-text-secondary transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800">
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </PanelSection>
    </div>
  )
}

// ── Images ─────────────────────────────────────────────────────────────────
// Four sources, Brand Brain first: the logo is the thing people add most, and
// before this it could only be reached by downloading it from Brand Brain and
// uploading it again. Then a file from the marketer's machine, anything already saved
// to THIS workspace's Media Library (its past uploads and generations, across
// every session), and anything already generated in this session — which is the one
// people actually reach for, to drop a logo or an earlier crop onto a new
// background.
// Brand Brain kinds that are pictures. Music is an asset kind too, and has no
// business on a canvas.
const BRAND_IMAGE_KINDS = ['product_photo', 'project_photo', 'reference', 'other']

const CORNER_ARROWS = { 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘' }

export function UploadsPanel({ onUploadImage, onAddImage, onAddLogo, library = [], workspaceId, accessToken }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mediaAssets, setMediaAssets] = useState([])
  const [mediaLoading, setMediaLoading] = useState(true)
  const [brandAssets, setBrandAssets] = useState([])
  const [brandLoading, setBrandLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetchBrandAssets(workspaceId, accessToken).then(rows => {
      if (!alive) return
      setBrandAssets(rows.filter(a => a.public_url)); setBrandLoading(false)
    })
    return () => { alive = false }
  }, [workspaceId, accessToken])

  const logos = brandAssets.filter(a => a.kind === 'logo')
  const brandImages = brandAssets.filter(a => BRAND_IMAGE_KINDS.includes(a.kind))

  useEffect(() => {
    let alive = true
    fetchMediaLibrary(workspaceId, accessToken, { kind: 'image' }).then(rows => {
      if (!alive) return
      setMediaAssets(rows); setMediaLoading(false)
    })
    return () => { alive = false }
  }, [workspaceId, accessToken])

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
      <PanelSection title="Your logo">
        {brandLoading ? (
          <div className="flex justify-center py-4"><Spinner size="sm" /></div>
        ) : logos.length === 0 ? (
          <p className="text-[11px] text-text-tertiary">
            No logo in Brand Brain yet. Add one there under Assets, kind “Logo”, and it appears here.
          </p>
        ) : (
          <div className="space-y-2">
            {logos.map(a => (
              <div key={a.id} className="rounded-lg border border-border bg-white p-2">
                {/* Mid-grey, not the usual light checkerboard: Arak's own logo
                    is white and vanished on light. Grey shows white and dark
                    marks alike. */}
                <button type="button" onClick={() => onAddImage(a.public_url)}
                  title="Add to the canvas, then drag it where you want"
                  className="flex h-16 w-full items-center justify-center rounded-md bg-[repeating-conic-gradient(#9a9a9a_0%_25%,#a8a8a8_0%_50%)] bg-[length:12px_12px] hover:ring-1 hover:ring-amber-400">
                  <img src={a.public_url} alt={a.title || 'Logo'} className="max-h-14 max-w-full object-contain" />
                </button>
                {onAddLogo && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-text-tertiary">Put in corner</span>
                    <div className="grid grid-cols-2 gap-1">
                      {CORNERS.map(corner => (
                        <button key={corner} type="button" onClick={() => onAddLogo(a.public_url, corner)}
                          title={`Add to the ${corner.replace('-', ' ')} corner`}
                          aria-label={`Add logo to the ${corner.replace('-', ' ')} corner`}
                          className="h-6 w-6 rounded border border-border text-[11px] text-text-secondary hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800">
                          {CORNER_ARROWS[corner]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      {brandImages.length > 0 && (
        <PanelSection title="Brand Brain">
          <div className="grid grid-cols-2 gap-1.5">
            {brandImages.map(a => (
              <button key={a.id} type="button" onClick={() => onAddImage(a.public_url)}
                title={a.title || a.caption || 'Add to canvas'}
                className="aspect-square overflow-hidden rounded-lg border border-border bg-surface-subtle hover:border-amber-400">
                <img src={a.public_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Upload">
        <button type="button" disabled={busy || !onUploadImage} onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white py-6 text-[11px] text-text-secondary hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50">
          {busy ? <><Spinner size="sm" /> Uploading…</> : <><IconUpload /> Upload an image</>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </PanelSection>

      <PanelSection title="Media library">
        {mediaLoading ? (
          <div className="flex justify-center py-4"><Spinner size="sm" /></div>
        ) : mediaAssets.length === 0 ? (
          <p className="text-[11px] text-text-tertiary">Nothing saved to your library yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {mediaAssets.map(a => (
              <button key={a.id} type="button" onClick={() => onAddImage(a.url)}
                title={a.name || 'Add to canvas'}
                className="aspect-square overflow-hidden rounded-lg border border-border bg-surface-subtle hover:border-amber-400">
                <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
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
// Canva's order: the filter row first (one click to a whole look), Auto next
// (one click to a corrected exposure), and the sliders under both — because a
// preset is a starting point you then tune, not a replacement for tuning.
export function AdjustPanel({ adjust, onChange, onBeginChange, onResetAll, onPreset, onAuto }) {
  const dirty = hasAdjustments(adjust)
  const active = matchPreset(adjust)

  return (
    <div className="space-y-4">
      <PanelSection title="Filters">
        <div className="grid grid-cols-4 gap-1">
          {FILTER_PRESETS.map(p => (
            <button key={p.id} type="button" onClick={() => onPreset(p.id)}
              className={`rounded-lg border px-1 py-1.5 text-[10px] transition-colors ${
                active === p.id
                  ? 'border-amber-500 bg-amber-100 text-amber-900'
                  : 'border-border text-text-secondary hover:border-amber-400 hover:bg-amber-50'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </PanelSection>

      <div className="flex gap-2">
        <ToolbarButton onClick={onAuto} className="flex-1 justify-center border border-border"
          title="Read the photo's histogram and balance its exposure">
          Auto adjust
        </ToolbarButton>
        <ToolbarButton onClick={onResetAll} disabled={!dirty}
          className="flex-1 justify-center border border-border" title="Back to no adjustments">
          Reset all
        </ToolbarButton>
      </div>

      {ADJUST_GROUPS.map(group => (
        <PanelSection key={group.title} title={group.title}>
          <div className="space-y-3">
            {group.keys.map(key => (
              <SliderField key={key} label={ADJUST_LABELS[key]}
                value={adjust[key] || 0}
                min={ADJUST_RANGE[key][0]} max={ADJUST_RANGE[key][1]} step={1}
                onCommitStart={onBeginChange}
                onChange={v => onChange(key, v)}
                onReset={adjust[key] ? () => { onBeginChange(); onChange(key, 0) } : null}
              />
            ))}
          </div>
        </PanelSection>
      ))}

      <p className="text-[11px] leading-relaxed text-text-tertiary">
        Applies to the photo only — text, shapes and image layers are untouched.
        Nothing here is baked into the image: reopen this edit later and every
        slider is still where you left it.
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

export function CropPanel({ base, crop, cropRect, ratio, onSetRatio, onApply, onCancel, onReset }) {
  const cropped = !isFullFrame(crop)
  return (
    <div className="space-y-4">
      <PanelSection title="Aspect ratio">
        <div className="space-y-1">
          {RATIOS.map(r => (
            <button key={r.label} type="button" onClick={() => onSetRatio(r.value)}
              className={`w-full rounded-lg border px-3 py-1.5 text-left text-[11px] transition-colors ${
                ratio === r.value
                  ? 'border-amber-500 bg-amber-100 text-amber-900'
                  : 'border-border bg-white text-text-secondary hover:border-amber-400 hover:bg-amber-50'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
      </PanelSection>

      {cropRect && base && (
        <p className="text-[11px] text-text-tertiary">
          New size: {Math.round(cropRect.w)} × {Math.round(cropRect.h)} px
          <span className="block">(the photo is {base.width} × {base.height})</span>
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-text-tertiary">
        The parts outside the frame are dimmed, not deleted — drag the frame
        back out over them whenever you like, in this session or a later one.
        Everything on the layers stays where it is relative to the photo.
      </p>

      <div className="flex gap-2">
        <ToolbarButton onClick={onCancel} className="flex-1 justify-center border border-border">Cancel</ToolbarButton>
        <ToolbarButton onClick={onApply} className="flex-1 justify-center border border-amber-500 bg-amber-100 text-amber-900">Apply crop</ToolbarButton>
      </div>
      {cropped && (
        <ToolbarButton onClick={onReset} className="w-full justify-center border border-border"
          title="Show the whole photo again">
          Reset to the full photo
        </ToolbarButton>
      )}
    </div>
  )
}

export { PositionPanel }
