import { useState } from 'react'
import { layerRect, moveToPatch } from '../model/geometry'
import { isPath, isBoxed, layerLabel } from '../model/document'
import { ALIGN_MODES } from '../model/align'
import { NumberField, PanelSection, ToolbarButton } from '../controls'

// ─── Position: arrange, align, exact numbers, and the layer list ───────────
// Canva puts all four of these behind one "Position" button, in two tabs
// (Arrange and Layers). Same here, for the same reason: they're the things you
// reach for when the direct manipulation on the canvas has got you 95% of the
// way and you want the last 5% to be exact.

const ALIGN_LABELS = {
  left: ['⇤', 'Align left'], 'center-h': ['⇹', 'Centre horizontally'], right: ['⇥', 'Align right'],
  top: ['⤒', 'Align top'], 'center-v': ['⇳', 'Centre vertically'], bottom: ['⤓', 'Align bottom'],
}

export function PositionPanel({
  doc, selection, selectedIds,
  onAlign, onTidyUp, onOrder, onOrderExtreme,
  onPatch, onBeginChange,
  onSelect, onToggleVisible, onToggleLock, onDelete,
}) {
  const [tab, setTab] = useState('arrange')
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-surface-subtle/60 p-0.5">
        {['arrange', 'layers'].map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
              tab === t ? 'bg-white text-text shadow-sm' : 'text-text-tertiary hover:text-text-secondary'
            }`}>{t}</button>
        ))}
      </div>

      {tab === 'arrange'
        ? <ArrangeTab doc={doc} selection={selection} onAlign={onAlign} onTidyUp={onTidyUp}
            onOrder={onOrder} onOrderExtreme={onOrderExtreme} onPatch={onPatch} onBeginChange={onBeginChange} />
        : <LayersTab doc={doc} selectedIds={selectedIds} onSelect={onSelect}
            onToggleVisible={onToggleVisible} onToggleLock={onToggleLock} onDelete={onDelete}
            onOrder={onOrder} />}
    </div>
  )
}

function ArrangeTab({ doc, selection, onAlign, onTidyUp, onOrder, onOrderExtreme, onPatch, onBeginChange }) {
  if (!selection.length) {
    return <p className="text-[11px] leading-relaxed text-text-secondary">Select something on the canvas to arrange it.</p>
  }
  const single = selection.length === 1 ? selection[0] : null

  return (
    <div className="space-y-4">
      <PanelSection title="Layer order">
        <div className="grid grid-cols-2 gap-1.5">
          <ToolbarButton title="Bring forward (⌘])" onClick={() => onOrder(1)} className="justify-start border border-border">↑ Forward</ToolbarButton>
          <ToolbarButton title="Send backward (⌘[)" onClick={() => onOrder(-1)} className="justify-start border border-border">↓ Backward</ToolbarButton>
          <ToolbarButton title="Bring to front (⌥⌘])" onClick={() => onOrderExtreme(1)} className="justify-start border border-border">⤒ To front</ToolbarButton>
          <ToolbarButton title="Send to back (⌥⌘[)" onClick={() => onOrderExtreme(-1)} className="justify-start border border-border">⤓ To back</ToolbarButton>
        </div>
      </PanelSection>

      <PanelSection title={selection.length > 1 ? 'Align to each other' : 'Align to the page'}>
        <div className="grid grid-cols-6 gap-1">
          {ALIGN_MODES.map(mode => (
            <ToolbarButton key={mode} title={ALIGN_LABELS[mode][1]} onClick={() => onAlign(mode)}
              className="border border-border">{ALIGN_LABELS[mode][0]}</ToolbarButton>
          ))}
        </div>
        {selection.length > 2 && (
          <ToolbarButton title="Even out the gaps (⌥⇧T)" onClick={onTidyUp}
            className="w-full justify-center border border-border">Tidy up spacing</ToolbarButton>
        )}
      </PanelSection>

      {single && <AdvancedFields doc={doc} layer={single} onPatch={onPatch} onBeginChange={onBeginChange} />}
    </div>
  )
}

// Exact numbers, in pixels from the top-left of the canvas — Canva's
// "Advanced" block. X/Y are the VISUAL bounding box, not the raw stored
// origin, so the number matches the handle you can see (a text layer's stored
// x sits inside its shadow padding, and an ellipse's inside its box).
function AdvancedFields({ doc, layer, onPatch, onBeginChange }) {
  const [ratioLock, setRatioLock] = useState(true)
  const W = doc.width, H = doc.height
  const rect = layerRect(layer, W, H)
  const resizable = isBoxed(layer)

  function move(nextLeft, nextTop) {
    onBeginChange()
    onPatch(moveToPatch(layer, W, H, nextLeft, nextTop))
  }

  function resize(dimension, px) {
    onBeginChange()
    if (dimension === 'w') {
      const w = px / W
      const patch = { w }
      if (ratioLock && layer.h) patch.h = layer.h * (w / layer.w)
      onPatch(patch)
    } else {
      const h = px / H
      const patch = { h }
      if (ratioLock && layer.w) patch.w = layer.w * (h / layer.h)
      onPatch(patch)
    }
  }

  return (
    <PanelSection title="Advanced">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={rect.left} suffix="px" onCommitStart={onBeginChange}
          onChange={v => move(v, rect.top)} />
        <NumberField label="Y" value={rect.top} suffix="px" onCommitStart={onBeginChange}
          onChange={v => move(rect.left, v)} />
      </div>

      {resizable && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="W" value={layer.w * W} min={1} suffix="px" onCommitStart={onBeginChange}
              onChange={v => resize('w', v)} />
            <NumberField label="H" value={layer.h * H} min={1} suffix="px" onCommitStart={onBeginChange}
              onChange={v => resize('h', v)} />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <input type="checkbox" checked={ratioLock} onChange={e => setRatioLock(e.target.checked)} className="accent-amber-600" />
            Lock aspect ratio
          </label>
        </>
      )}

      {!isPath(layer) && (
        <NumberField label="∠" value={layer.rotation || 0} min={-180} max={180} suffix="°"
          onCommitStart={onBeginChange} onChange={rotation => onPatch({ rotation })} />
      )}
    </PanelSection>
  )
}

function LayersTab({ doc, selectedIds, onSelect, onToggleVisible, onToggleLock, onDelete, onOrder }) {
  if (!doc.layers.length) {
    return <p className="text-[11px] text-text-tertiary">Nothing added yet — add text, a shape or an image from the left.</p>
  }
  // Reversed so the list reads top-of-stack first, which is how every layers
  // panel in every design tool reads.
  return (
    <div className="space-y-1">
      {[...doc.layers].reverse().map(l => {
        const idx = doc.layers.findIndex(x => x.id === l.id)
        const active = selectedIds.includes(l.id)
        return (
          <div key={l.id} onMouseDown={e => onSelect(l.id, e.shiftKey || e.metaKey)}
            className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
              active ? 'bg-amber-100 text-amber-900' : 'text-text-secondary hover:bg-surface-subtle'
            }`}>
            <span className="w-4 shrink-0 text-center opacity-60">{LAYER_ICON[l.type] || '◻'}</span>
            <span className="flex-1 truncate">{layerLabel(l)}</span>
            <IconAction title={l.visible === false ? 'Show' : 'Hide'} onClick={() => onToggleVisible(l.id)}>
              {l.visible === false ? '🚫' : '👁'}
            </IconAction>
            <IconAction title={l.locked ? 'Unlock' : 'Lock'} onClick={() => onToggleLock(l.id)}>
              {l.locked ? '🔒' : '🔓'}
            </IconAction>
            <IconAction title="Move up" disabled={idx === doc.layers.length - 1} onClick={() => onOrder(1, l.id)}>↑</IconAction>
            <IconAction title="Move down" disabled={idx === 0} onClick={() => onOrder(-1, l.id)}>↓</IconAction>
            <IconAction title="Delete" danger onClick={() => onDelete(l.id)}>×</IconAction>
          </div>
        )
      })}
    </div>
  )
}

const LAYER_ICON = { text: 'T', image: '▣', rect: '▭', ellipse: '◯', line: '／', arrow: '→' }

function IconAction({ children, title, danger, disabled, onClick }) {
  return (
    <button type="button" title={title} disabled={disabled}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`w-5 h-5 shrink-0 rounded text-[10px] leading-none transition-colors disabled:opacity-25 disabled:pointer-events-none ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-white/70 hover:text-amber-800'
      }`}>
      {children}
    </button>
  )
}
