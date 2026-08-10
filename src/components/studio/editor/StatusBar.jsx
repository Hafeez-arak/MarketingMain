import { ToolbarButton, ToolbarDivider, ToolbarMenu, MenuItem } from './controls'

// ─── Status bar ────────────────────────────────────────────────────────────
// Canva keeps the zoom control here rather than in the toolbar, and so does
// every other canvas tool — it's view state, not document state.
export function StatusBar({ doc, view, zoom, layerCount, hint }) {
  const percent = Math.round(view.scale * 100)
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-white px-2 py-1">
      <span className="hidden md:block truncate text-[11px] text-text-tertiary">{hint}</span>
      <span className="flex-1" />
      <span className="text-[11px] tabular-nums text-text-tertiary">
        {doc.width} × {doc.height} px · {layerCount} layer{layerCount === 1 ? '' : 's'}
      </span>
      <ToolbarDivider />
      <ToolbarButton title="Zoom out (⌘−)" onClick={() => zoom.zoomBy(1 / 1.2)}>−</ToolbarButton>
      <ToolbarMenu label={`${percent}%`} title="Zoom" width={170}>
        <MenuItem onClick={zoom.zoomToFit}>Zoom to fit <span className="float-right text-[10px] text-text-tertiary">⌥⌘0</span></MenuItem>
        <MenuItem onClick={zoom.zoomToFill}>Zoom to fill <span className="float-right text-[10px] text-text-tertiary">⇧⌘0</span></MenuItem>
        <MenuItem onClick={zoom.zoomToActual}>100% <span className="float-right text-[10px] text-text-tertiary">⌘0</span></MenuItem>
      </ToolbarMenu>
      <ToolbarButton title="Zoom in (⌘+)" onClick={() => zoom.zoomBy(1.2)}>+</ToolbarButton>
    </div>
  )
}
