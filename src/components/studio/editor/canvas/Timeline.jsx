import { useEffect, useRef } from 'react'
import { clampTiming, layerLabel, layerTiming } from '../model/document'

// ─── Timeline strip (video mode only) ──────────────────────────────────────
// One bar per layer across the clip's length: drag the middle to move it, drag
// an end to trim. This is the whole difference between text that is stamped on
// a clip and text that is *edited* onto it — a headline over the first three
// seconds and a call-to-action over the last two is what a reel actually looks
// like, and neither costs a render.
//
// Rows are drawn TOP LAYER FIRST, the reverse of doc.layers (which is
// bottom-to-top for painting), so the strip reads the same way round as the
// canvas looks.
//
// Timing is in SECONDS, unlike every geometric value in this editor, which is a
// fraction. See document.js — seconds are resolution-independent already, and a
// fraction of the clip would silently move the text if the clip were later
// re-rendered at a different length.

const ROW_H = 26
const EDGE_PX = 7          // how close to an end counts as "trim" rather than "move"

function fmt(s) {
  return `${Number(s).toFixed(1)}s`
}

export function Timeline({
  doc, duration, selectedIds, onSelect, onBegin, onPatchLayer,
}) {
  const cleanupRef = useRef(null)

  const rows = [...doc.layers].reverse()
  const selected = new Set(selectedIds)

  // Listeners are bound imperatively at pointerdown rather than through an
  // effect keyed on drag state: a gesture is not derived state, and routing it
  // through a re-render was costing an ugly "nudge a value to force a re-bind"
  // hack. They go on window so the drag survives the cursor leaving the 26px
  // row it started in, which it always does.
  function startDrag(e, layer, mode) {
    e.preventDefault()
    e.stopPropagation()
    onSelect(layer.id)
    onBegin()

    // Width is read from the track this gesture actually started on, at the
    // moment it starts. Every row is the same width, but reading it here means
    // a resized window mid-session can't leave a stale scale behind.
    const trackW = Math.max(1, e.currentTarget.parentElement.clientWidth)
    const perPx = duration / trackW
    const start = { ...layerTiming(layer), startX: e.clientX }
    const span = (start.tOut === null ? duration : start.tOut) - start.tIn

    function move(ev) {
      const delta = (ev.clientX - start.startX) * perPx
      let next
      if (mode === 'move') {
        next = { tIn: start.tIn + delta, tOut: start.tOut === null ? null : start.tOut + delta, fade: start.fade }
        // Moving must not also resize: a bar pushed past either end stops there
        // with its length intact rather than squashing against the edge.
        if (next.tIn < 0) next = { ...next, tIn: 0, tOut: start.tOut === null ? null : span }
        if (next.tOut !== null && next.tOut > duration) {
          next = { ...next, tIn: Math.max(0, duration - span), tOut: duration }
        }
      } else if (mode === 'in') {
        next = { tIn: start.tIn + delta, tOut: start.tOut, fade: start.fade }
      } else {
        next = { tIn: start.tIn, tOut: (start.tOut === null ? duration : start.tOut) + delta, fade: start.fade }
      }
      onPatchLayer(layer.id, clampTiming(next, duration))
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cleanupRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    cleanupRef.current = up
  }

  // A drag still in flight when the editor closes would otherwise leave two
  // listeners on window pointing at an unmounted component.
  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current() }, [])

  const single = selectedIds.length === 1 ? doc.layers.find(l => l.id === selectedIds[0]) : null

  return (
    <div className="border-t border-border bg-surface-subtle/40">
      <div className="flex items-center justify-between px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
          Timing · {fmt(duration)} clip
        </p>
        {single ? (
          <TimingFields layer={single} duration={duration} onBegin={onBegin} onPatchLayer={onPatchLayer} />
        ) : (
          <p className="text-[10px] text-text-tertiary">Drag a bar to move it, its ends to trim.</p>
        )}
      </div>

      <div className="max-h-[132px] overflow-y-auto px-3 pb-2">
        {rows.map(layer => {
          const t = layerTiming(layer)
          const left = (t.tIn / duration) * 100
          const right = ((t.tOut === null ? duration : t.tOut) / duration) * 100
          const isSel = selected.has(layer.id)
          return (
            <div key={layer.id} className="flex items-center gap-2" style={{ height: ROW_H }}>
              <button type="button" onClick={() => onSelect(layer.id)}
                className={`w-24 shrink-0 truncate text-left text-[10px] ${
                  isSel ? 'font-semibold text-amber-900' : 'text-text-tertiary hover:text-text'
                }`}>
                {layerLabel(layer)}
              </button>
              <div className="relative h-4 flex-1 rounded bg-white ring-1 ring-border">
                <div
                  onPointerDown={e => {
                    const box = e.currentTarget.getBoundingClientRect()
                    const mode = e.clientX - box.left < EDGE_PX ? 'in'
                      : box.right - e.clientX < EDGE_PX ? 'out' : 'move'
                    startDrag(e, layer, mode)
                  }}
                  title={`${fmt(t.tIn)} → ${t.tOut === null ? 'end' : fmt(t.tOut)}${t.fade ? ` · ${fmt(t.fade)} fade` : ''}`}
                  className={`absolute inset-y-0 cursor-grab rounded ${
                    isSel ? 'bg-amber-500' : 'bg-amber-300 hover:bg-amber-400'
                  }`}
                  style={{ left: `${left}%`, width: `${Math.max(1.5, right - left)}%` }}>
                  {/* Grab handles. Visual only — the hit test above is what
                      decides trim vs move, so they can stay this thin. */}
                  <span className="absolute inset-y-0 left-0 w-[3px] cursor-ew-resize rounded-l bg-black/25" />
                  <span className="absolute inset-y-0 right-0 w-[3px] cursor-ew-resize rounded-r bg-black/25" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The precise way in. Dragging to exactly 2.0s is fiddly at this width, and
// "the logo appears at two seconds" is a thing people mean exactly.
function TimingFields({ layer, duration, onBegin, onPatchLayer }) {
  const t = layerTiming(layer)
  const set = patch => { onBegin(); onPatchLayer(layer.id, clampTiming({ ...t, ...patch }, duration)) }
  const num = (label, value, onChange, extra = {}) => (
    <label className="flex items-center gap-1 text-[10px] text-text-tertiary">
      {label}
      <input type="number" step="0.1" min="0" max={duration} value={value}
        onChange={e => onChange(e.target.value)}
        className="w-14 border border-border px-1 py-0.5 text-[10px] text-text" {...extra} />
    </label>
  )
  return (
    <div className="flex items-center gap-2">
      {num('In', t.tIn.toFixed(1), v => set({ tIn: Number(v) }))}
      {num('Out', t.tOut === null ? '' : t.tOut.toFixed(1), v => set({ tOut: v === '' ? null : Number(v) }),
        { placeholder: 'end' })}
      {num('Fade', t.fade.toFixed(1), v => set({ fade: Number(v) }))}
      {t.tOut !== null && (
        <button type="button" onClick={() => set({ tOut: null })}
          className="text-[10px] text-amber-800 underline hover:text-amber-900">to end</button>
      )}
    </div>
  )
}
