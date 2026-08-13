import { useEffect, useRef } from 'react'
import { clampTiming, layerLabel, layerTiming } from '../model/document'

// ─── The timeline ──────────────────────────────────────────────────────────
// A transport, a ruler with a playhead, and one bar per layer across the
// clip's length: drag the middle of a bar to move it, drag an end to trim.
// This is the whole difference between text that is stamped on a clip and text
// that is *edited* onto it — a headline over the first three seconds and a
// call-to-action over the last two is what a reel actually looks like, and
// neither costs a render.
//
// Rows are drawn TOP LAYER FIRST, the reverse of doc.layers (which is
// bottom-to-top for painting), so the strip reads the same way round as the
// canvas looks.
//
// Timing is in SECONDS, unlike every geometric value in this editor, which is a
// fraction. See document.js — seconds are resolution-independent already, and a
// fraction of the clip would silently move the text if the clip were later
// re-rendered at a different length.
//
// ── Why the playhead is not React state ────────────────────────────────────
// It moves sixty times a second and it is one CSS `left`. Routing that through
// setState would re-render this component, its parent, and every Konva node in
// the tree, for a two-pixel move. So playback drives it through a
// subscription and it writes to the DOM directly — the same reasoning that
// already keeps drags out of React below, and the reason useVideoPlayback
// exposes `subscribe` at all.

const ROW_H = 26
const EDGE_PX = 7          // how close to an end counts as "trim" rather than "move"
const LABEL_W = 96         // the layer-name gutter; the track starts after it
const PAD_X = 12           // the strip's own horizontal padding (px-3)
// Where every track starts, measured from the strip's left edge. This has to
// be the sum of everything to the left of a bar — the padding, the name
// column and the flex gap — because the ruler and the playhead are positioned
// with it while the rows get there by ordinary layout. It was LABEL_W + 8,
// which left out the padding, so the ruler and the playhead sat exactly 12px
// to the left of the bars they were supposed to be measuring.
const GUTTER = PAD_X + LABEL_W + 8

function fmt(s) {
  return `${Number(s).toFixed(1)}s`
}

// Inline, like every other icon in the app — nothing else in src/ pulls an
// icon package in, and a transport is three glyphs.
const IconPlay = () => (
  <svg viewBox="0 0 24 24" className="ml-[1px] h-3 w-3" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
)
const IconPause = () => (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
)
const IconStart = () => (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="M7 5h2v14H7zM19 5v14l-9-7z" /></svg>
)

// Enough ticks to read the clip against, few enough to stay legible at any
// length from a 4-second loop to a two-minute reel.
function tickStep(duration) {
  if (duration <= 6) return 1
  if (duration <= 15) return 2
  if (duration <= 40) return 5
  if (duration <= 90) return 10
  return 15
}

export function Timeline({
  doc, duration, selectedIds, playback, trim, onSelect, onBegin, onPatchLayer, onTrim,
}) {
  const cleanupRef = useRef(null)
  const trackRef = useRef(null)
  const clipTrackRef = useRef(null)
  const headRef = useRef(null)
  const readoutRef = useRef(null)

  const rows = [...doc.layers].reverse()
  const selected = new Set(selectedIds)

  // ── The playhead ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playback?.subscribe) return undefined
    return playback.subscribe(t => {
      const pct = duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0
      if (headRef.current) headRef.current.style.left = `${pct}%`
      if (readoutRef.current) readoutRef.current.textContent = fmt(t)
    })
  }, [playback, duration])

  // Scrubbing. Bound imperatively at pointerdown for the same reason the bar
  // drags below are: a gesture is not derived state, and a pointerdown on the
  // ruler should keep scrubbing after the cursor leaves the 18px strip it
  // started in — which it immediately does.
  function startScrub(e) {
    e.preventDefault()
    const track = trackRef.current
    if (!track || !playback) return
    const box = track.getBoundingClientRect()
    const at = clientX => {
      const pct = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)))
      playback.seek(pct * duration)
    }
    // Scrubbing while it plays fights the clip for the current time; pausing
    // first is what every editor does and it makes the gesture land where you
    // let go rather than wherever playback had reached by then.
    playback.pause()
    at(e.clientX)

    const move = ev => at(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cleanupRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    cleanupRef.current = up
  }

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

  // ── Trimming the footage ────────────────────────────────────────────────
  // The same gesture as a layer bar, against the clip instead. Dragging an end
  // never moves the other one, and the two can't cross: a trim is a window,
  // and a window with its edges swapped is not a shorter clip, it's nothing.
  function startTrim(e, edge) {
    e.preventDefault()
    e.stopPropagation()
    onBegin()
    // Read from the track by ref, not by walking up from the handle. The
    // handles live inside the BAR now (so they can sit on its rounded ends),
    // and the bar is only as wide as the kept region — scaling the drag by
    // that would make the gesture wildly too fast on a heavily trimmed clip.
    const trackW = Math.max(1, clipTrackRef.current?.clientWidth || 1)
    const perPx = duration / trackW
    const start = { ...trim, startX: e.clientX }

    function move(ev) {
      const delta = (ev.clientX - start.startX) * perPx
      const next = edge === 'start'
        ? { start: start.start + delta, end: start.end }
        : { start: start.start, end: start.end + delta }
      onTrim(next)
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
  const step = tickStep(duration)
  const ticks = []
  for (let s = 0; s <= duration + 0.001; s += step) ticks.push(s)

  const pct = s => Math.min(100, Math.max(0, (s / duration) * 100))
  const trimLeft = pct(trim.start)
  const trimRight = pct(trim.end)
  const trimmed = trim.start > 0.001 || trim.end < duration - 0.001

  return (
    <div className="border-t border-border bg-surface-subtle/40">
      {/* ── Transport ── */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button type="button" onClick={() => playback?.toggle()}
          disabled={!playback?.ready}
          title={playback?.playing ? 'Pause (space)' : 'Play (space)'}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white transition-colors hover:bg-amber-600 disabled:opacity-40">
          {playback?.playing ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" onClick={() => playback?.seek(0)} disabled={!playback?.ready}
          title="Back to the start" className="text-text-tertiary hover:text-text disabled:opacity-40">
          <IconStart />
        </button>
        <p className="font-mono text-[10px] tabular-nums text-text-tertiary">
          <span ref={readoutRef}>0.0s</span> / {fmt(duration)}
        </p>
        {trimmed && (
          <span className="flex items-center gap-1 text-[10px] text-amber-800">
            · ships {fmt(trim.length)}
            <button type="button" onClick={() => { onBegin(); onTrim({ start: 0, end: null }) }}
              className="underline hover:text-amber-900">use the whole clip</button>
          </span>
        )}

        <span className="flex-1" />

        {single ? (
          <TimingFields layer={single} duration={duration} onBegin={onBegin} onPatchLayer={onPatchLayer} />
        ) : (
          <p className="text-[10px] text-text-tertiary">
            {playback?.error
              ? playback.error
              : doc.layers.length
                ? 'Drag a bar to move it, its ends to trim · space to play'
                : 'Space to play. Add text or a logo and it appears here as a bar you can time.'}
          </p>
        )}
      </div>

      {/* ── Ruler + rows, with the playhead spanning both ── */}
      <div className="relative">
        {/* The ruler is the scrub surface. Its own left padding lines the
            zero mark up with the start of every bar below it. */}
        <div className="flex select-none items-end" style={{ paddingLeft: GUTTER, paddingRight: PAD_X }}>
          <div ref={trackRef} onPointerDown={startScrub}
            className="relative h-[18px] flex-1 cursor-ew-resize border-b border-border">
            {ticks.map(s => (
              <span key={s} className="absolute bottom-0 flex flex-col items-start"
                style={{ left: `${(s / duration) * 100}%` }}>
                <span className="pl-0.5 text-[9px] leading-none text-text-tertiary">{s}s</span>
                <span className="h-[4px] w-px bg-border" />
              </span>
            ))}
          </div>
        </div>

        {/* ── The footage ──
            The clip itself, with handles at each end. Everything outside the
            handles is dimmed rather than removed — the same choice crop mode
            makes with a photo, and for the same reason: the footage is never
            cut, so you have to be able to see what you are excluding and drag
            the edge back out over it. */}
        <div className="flex items-center gap-2 px-3 pt-1.5">
          <span style={{ width: LABEL_W }}
            className="shrink-0 truncate text-left text-[10px] font-semibold text-text-tertiary">
            Clip
          </span>
          {/* Built exactly like a layer row below — same white track, same
              ring, same solid bar, same thin edge grips. It used to be a
              two-tone plate with chunky contrasting handle blocks, which read
              as a glint across the bar rather than as one object, and made the
              footage look like a different kind of thing from everything under
              it. It isn't: it's a bar on a track with draggable ends. */}
          <div ref={clipTrackRef} className="relative h-4 flex-1 rounded bg-white ring-1 ring-border">
            <div className="absolute inset-y-0 rounded bg-stone-400"
              style={{ left: `${trimLeft}%`, width: `${Math.max(1.5, trimRight - trimLeft)}%` }}>
              {/* Unlike the layer bars' purely cosmetic grips, these ARE the
                  hit target — the footage bar has no drag-the-middle gesture,
                  so the ends are the whole interaction. */}
              <span onPointerDown={e => startTrim(e, 'start')} title={`Starts at ${fmt(trim.start)}`}
                className="absolute inset-y-0 left-0 w-[5px] cursor-ew-resize rounded-l bg-black/30 hover:bg-black/50" />
              <span onPointerDown={e => startTrim(e, 'end')} title={`Ends at ${fmt(trim.end)}`}
                className="absolute inset-y-0 right-0 w-[5px] cursor-ew-resize rounded-r bg-black/30 hover:bg-black/50" />
            </div>
          </div>
        </div>

        {/* The excluded time, greyed across the ruler and every layer row so a
            cue sitting in a part of the clip that no longer ships is visibly
            in the dark rather than looking live. */}
        {trimmed && (
          <div className="pointer-events-none absolute inset-y-0 z-[5]" style={{ left: GUTTER, right: PAD_X }}>
            <div className="absolute inset-y-0 left-0 bg-white/60" style={{ width: `${trimLeft}%` }} />
            <div className="absolute inset-y-0 bg-white/60" style={{ left: `${trimRight}%`, right: 0 }} />
          </div>
        )}

        {/* The playhead, in a wrapper that spans exactly the track region.
            The percentage has to resolve against the TRACK, and it only does
            that if its containing block IS the track — this used to be one
            element carrying `left: n%` (measured against the whole strip,
            gutter included) plus `marginLeft: GUTTER` on top, so it drifted
            further right the later it got and at 100% ended up a full gutter
            past the right-hand edge of the panel entirely.

            Pointer-events off: the line is a readout, and swallowing clicks
            here would make the bar directly under it un-grabbable. */}
        <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: GUTTER, right: PAD_X }}>
          <div ref={headRef} className="absolute top-0 bottom-0 w-px bg-amber-600" style={{ left: '0%' }}>
            <span className="absolute -left-[3px] top-0 h-[7px] w-[7px] rounded-full bg-amber-600" />
          </div>
        </div>

        <div className="max-h-[132px] overflow-y-auto px-3 py-1.5">
          {rows.map(layer => {
            const t = layerTiming(layer)
            const left = (t.tIn / duration) * 100
            const right = ((t.tOut === null ? duration : t.tOut) / duration) * 100
            const isSel = selected.has(layer.id)
            return (
              <div key={layer.id} className="flex items-center gap-2" style={{ height: ROW_H }}>
                <button type="button" onClick={() => onSelect(layer.id)}
                  style={{ width: LABEL_W }}
                  className={`shrink-0 truncate text-left text-[10px] ${
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
