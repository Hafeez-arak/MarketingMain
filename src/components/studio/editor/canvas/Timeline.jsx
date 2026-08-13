import { useEffect, useRef } from 'react'
import { clampTiming, layerLabel, layerTiming } from '../model/document'
import { MOTION_LABELS, layerMotion } from '../model/playback'
import { IconLoop, IconPause, IconPlay, IconSkipStart, IconVolume, IconVolumeMuted } from '../icons'

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
// How close a dragged edge has to come to something meaningful before it
// jumps onto it. Eight pixels is Canva's feel: close enough that you have to
// mean it, far enough that you don't have to aim.
const SNAP_PX = 8
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

// Enough ticks to read the clip against, few enough to stay legible at any
// length from a 4-second loop to a two-minute reel.
function tickStep(duration) {
  if (duration <= 6) return 1
  if (duration <= 15) return 2
  if (duration <= 40) return 5
  if (duration <= 90) return 10
  return 15
}

// ─── Snapping ──────────────────────────────────────────────────────────────
// Dragging a bar to land exactly on the playhead, on the clip's start, or
// flush against the layer above it was previously impossible — you dragged
// near it and then typed the number in the In/Out fields, which is what those
// fields existed to rescue rather than to be the primary way of working. Every
// timeline in every editor snaps, and its absence is most of what made this
// one feel like a diagram of a timeline rather than one.
//
// What is worth snapping to is exactly what a person is trying to line up
// with: the ends of the clip, the ends of the shipping window, the playhead
// they just parked, and the cues of every OTHER layer. A layer never snaps to
// itself — its own far edge is being dragged with it, and offering it would
// let a bar collapse onto its own start.
function snapTargets({ doc, duration, trim, playhead, exceptId }) {
  const out = [
    { t: 0, kind: 'clip' },
    { t: duration, kind: 'clip' },
    { t: playhead, kind: 'playhead' },
  ]
  if (trim.start > 0.001) out.push({ t: trim.start, kind: 'trim' })
  if (trim.end < duration - 0.001) out.push({ t: trim.end, kind: 'trim' })
  for (const l of doc.layers) {
    if (l.id === exceptId) continue
    const { tIn, tOut } = layerTiming(l)
    out.push({ t: tIn, kind: 'layer' })
    if (tOut !== null) out.push({ t: tOut, kind: 'layer' })
  }
  return out
}

// The correction to add to a value to put it on the nearest target, or null if
// nothing is close enough. Returns the correction rather than the snapped
// value so a MOVE — which has two edges and must not change length — can apply
// the same shift to both.
function snapCorrection(value, targets, tolerance) {
  let best = null
  for (const target of targets) {
    const delta = target.t - value
    if (Math.abs(delta) > tolerance) continue
    if (best === null || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at: target.t }
  }
  return best
}

export function Timeline({
  doc, duration, selectedIds, playback, trim, onSelect, onBegin, onPatchLayer, onTrim,
}) {
  const cleanupRef = useRef(null)
  const trackRef = useRef(null)
  const clipTrackRef = useRef(null)
  const headRef = useRef(null)
  const readoutRef = useRef(null)
  // The snap guide. Written to directly for the same reason the playhead is:
  // it moves with the pointer, it is one CSS `left`, and routing sixty of
  // those a second through setState would re-render the whole strip.
  const snapRef = useRef(null)

  const rows = [...doc.layers].reverse()
  const selected = new Set(selectedIds)

  // Shown at the snapped time while a drag is held on one, hidden otherwise.
  function showSnap(at) {
    const el = snapRef.current
    if (!el) return
    if (at === null || duration <= 0) { el.style.opacity = '0'; return }
    el.style.left = `${Math.min(100, Math.max(0, (at / duration) * 100))}%`
    el.style.opacity = '1'
  }

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
    // Captured once at pointerdown, not recomputed per frame: the targets are
    // the OTHER layers and the playhead, none of which this gesture moves, and
    // rebuilding the list sixty times a second would be pure waste.
    const targets = snapTargets({
      doc, duration, trim, playhead: playback?.timeRef.current ?? 0, exceptId: layer.id,
    })
    const tolerance = SNAP_PX * perPx

    function move(ev) {
      const delta = (ev.clientX - start.startX) * perPx
      let next
      // ⌥ suspends snapping for the rest of the gesture, which is the escape
      // hatch every snapping timeline has: sometimes 2.03s really is what you
      // want, and without this the eight pixels either side of a cue become
      // unreachable.
      const snapping = !ev.altKey
      let landedOn = null

      if (mode === 'move') {
        next = { tIn: start.tIn + delta, tOut: start.tOut === null ? null : start.tOut + delta, fade: start.fade }
        // Moving must not also resize: a bar pushed past either end stops there
        // with its length intact rather than squashing against the edge.
        if (next.tIn < 0) next = { ...next, tIn: 0, tOut: start.tOut === null ? null : span }
        if (next.tOut !== null && next.tOut > duration) {
          next = { ...next, tIn: Math.max(0, duration - span), tOut: duration }
        }
        if (snapping) {
          // BOTH edges are candidates and the nearer one wins, then the shift
          // is applied to the pair — a move that snapped one edge by adjusting
          // only that edge would silently change the layer's length, which is
          // the one thing this gesture promises not to do.
          const head = snapCorrection(next.tIn, targets, tolerance)
          const tail = next.tOut === null ? null : snapCorrection(next.tOut, targets, tolerance)
          const win = !tail || (head && Math.abs(head.delta) <= Math.abs(tail.delta)) ? head : tail
          if (win) {
            next = { ...next, tIn: next.tIn + win.delta, tOut: next.tOut === null ? null : next.tOut + win.delta }
            landedOn = win.at
          }
        }
      } else if (mode === 'in') {
        next = { tIn: start.tIn + delta, tOut: start.tOut, fade: start.fade }
        const win = snapping ? snapCorrection(next.tIn, targets, tolerance) : null
        if (win) { next = { ...next, tIn: win.at }; landedOn = win.at }
      } else {
        next = { tIn: start.tIn, tOut: (start.tOut === null ? duration : start.tOut) + delta, fade: start.fade }
        const win = snapping ? snapCorrection(next.tOut, targets, tolerance) : null
        if (win) { next = { ...next, tOut: win.at }; landedOn = win.at }
      }
      showSnap(landedOn)
      onPatchLayer(layer.id, clampTiming(next, duration))
    }
    function up() {
      showSnap(null)
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
    // The trim snaps to the layer cues and the playhead, but NOT to the
    // existing trim edges — those are what this gesture is moving, and the
    // other one would be an odd thing to line an in point up with. Passing no
    // trim keeps them out of the list.
    const targets = snapTargets({
      doc, duration, trim: { start: 0, end: duration },
      playhead: playback?.timeRef.current ?? 0, exceptId: null,
    })
    const tolerance = SNAP_PX * perPx

    function move(ev) {
      const delta = (ev.clientX - start.startX) * perPx
      const raw = edge === 'start' ? start.start + delta : start.end + delta
      const win = ev.altKey ? null : snapCorrection(raw, targets, tolerance)
      const at = win ? win.at : raw
      showSnap(win ? win.at : null)
      onTrim(edge === 'start' ? { start: at, end: start.end } : { start: start.start, end: at })
    }
    function up() {
      showSnap(null)
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <button type="button" onClick={() => playback?.toggle()}
          disabled={!playback?.ready}
          title={playback?.playing ? 'Pause (space)' : 'Play (space)'}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white transition-colors hover:bg-amber-600 disabled:opacity-40">
          {playback?.playing ? <IconPause /> : <IconPlay className="ml-[1px] h-3 w-3" />}
        </button>
        <button type="button" onClick={() => playback?.seek(0)} disabled={!playback?.ready}
          title="Back to the start (Home)" className="text-text-tertiary hover:text-text disabled:opacity-40">
          <IconSkipStart />
        </button>
        {/* Loop and sound. Both are preview-only and neither reaches the
            render: a looped clip still ships once, and the mute is this
            element's, not the footage's. Muting what the MODEL generated is a
            document-level decision that belongs with the audio work in §9 of
            VIDEO-EDITOR.md, and conflating the two here would let someone
            silence a reel by turning their own speakers down. */}
        <button type="button" onClick={() => playback?.toggleLoop()} disabled={!playback?.ready}
          title={playback?.loop ? 'Looping — click to play once' : 'Loop the clip while you work'}
          className={`flex h-5 w-5 items-center justify-center transition-colors disabled:opacity-40 ${
            playback?.loop ? 'bg-amber-100 text-amber-900' : 'text-text-tertiary hover:text-text'
          }`}>
          <IconLoop />
        </button>
        <AudioControl playback={playback} />
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
              : playback?.forcedMute
                // Said out loud rather than left as a silently muted element.
                // The browser refused sound on a clip the user asked to play,
                // and a speaker icon showing "muted" with no explanation reads
                // as the app having done it.
                ? 'Your browser blocked the sound — click the speaker to turn it on.'
                : doc.layers.length
                  ? 'Drag a bar to move it, its ends to trim · ⌥ to ignore snapping'
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

        {/* The snap guide. In the same wrapper geometry as the playhead so its
            percentage resolves against the track (see the note above), above
            it in z so the two are distinguishable when a bar lands exactly on
            the playhead — which is the single most common snap. Opacity rather
            than mount/unmount: it appears and disappears at pointer speed, and
            a React round trip per frame is exactly what this file avoids. */}
        <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: GUTTER, right: PAD_X }}>
          <div ref={snapRef} className="absolute top-0 bottom-0 w-px bg-clay-600 opacity-0"
            style={{ left: '0%' }} />
        </div>

        <div className="max-h-[132px] overflow-y-auto px-3 py-1.5">
          {rows.map(layer => {
            const t = layerTiming(layer)
            const left = (t.tIn / duration) * 100
            const right = ((t.tOut === null ? duration : t.tOut) / duration) * 100
            const isSel = selected.has(layer.id)
            const span = (t.tOut === null ? duration : t.tOut) - t.tIn
            // As a percentage OF THE BAR, which is what the wedges below are
            // positioned inside. Capped at half: clampTiming already limits a
            // fade to half the span, but a bar dragged shorter mid-gesture can
            // momentarily be narrower than its own ramps.
            const fadePct = span > 0 ? Math.min(50, (t.fade / span) * 100) : 0
            const motion = layerMotion(layer)
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
                    title={[
                      `${fmt(t.tIn)} → ${t.tOut === null ? 'end' : fmt(t.tOut)}`,
                      t.fade ? `${fmt(t.fade)} fade` : null,
                      motion ? `${MOTION_LABELS[motion.in]} in / ${MOTION_LABELS[motion.out]} out` : null,
                    ].filter(Boolean).join(' · ')}
                    className={`absolute inset-y-0 cursor-grab overflow-hidden rounded ${
                      isSel ? 'bg-amber-500' : 'bg-amber-300 hover:bg-amber-400'
                    }`}
                    style={{ left: `${left}%`, width: `${Math.max(1.5, right - left)}%` }}>
                    {/* ── The fade ramps ──
                        Drawn as the wedge every NLE draws, by cutting the
                        corner of the bar away with the track's own colour. The
                        fade was previously a number in a field and nothing
                        else, which meant the one property that most changes how
                        an overlay READS was invisible on the surface built to
                        show how overlays read.

                        The out wedge is drawn ONLY when there is a real tOut,
                        and that asymmetry is not an oversight — it is copied
                        from the compose graph, which has nothing to anchor an
                        out-fade to on a layer that runs to the end of the clip.
                        layerAlphaAt reproduces it, the canvas preview shows it,
                        and drawing a ramp here that neither of them performs
                        would put the lie back at the top of the stack. */}
                    {fadePct > 1 && (
                      <span className="pointer-events-none absolute inset-y-0 left-0"
                        style={{
                          width: `${fadePct}%`,
                          backgroundImage: 'linear-gradient(to bottom right, rgba(255,255,255,0.92) 49.6%, transparent 50%)',
                        }} />
                    )}
                    {fadePct > 1 && t.tOut !== null && (
                      <span className="pointer-events-none absolute inset-y-0 right-0"
                        style={{
                          width: `${fadePct}%`,
                          backgroundImage: 'linear-gradient(to top right, transparent 49.6%, rgba(255,255,255,0.92) 50%)',
                        }} />
                    )}
                    {/* Grab handles. Visual only — the hit test above is what
                        decides trim vs move, so they can stay this thin. Drawn
                        after the wedges so a fade never buries the grip. */}
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

// ── Sound ──────────────────────────────────────────────────────────────────
// A speaker that toggles and a short slider beside it, both always on screen.
//
// The slider was briefly revealed on hover instead, to save the width. That
// was wrong for a reason worth writing down: it was positioned `left-full`,
// so on hover it floated straight over the timecode readout — you could not
// see the time you were setting the volume against, and the transport
// appeared to lose its readout whenever the pointer crossed the speaker.
// Forty pixels of permanent width is cheaper than a control that hides the
// one number the strip exists to show.
//
// This is PREVIEW audio: it changes what this browser plays and nothing about
// what ships. Worth being explicit about, since the one control the strip does
// NOT have is a mute for the model's own generated track — that is a property
// of the document, it survives a reload, and it costs an ffmpeg flag. Putting
// the two behind one speaker would let someone silence a delivered reel by
// turning their own monitors down.
function AudioControl({ playback }) {
  if (!playback) return null
  const muted = playback.muted || playback.volume === 0
  return (
    <span className="flex items-center gap-1">
      <button type="button" onClick={() => playback.setMuted()} disabled={!playback.ready}
        title={muted
          ? (playback.forcedMute ? 'Your browser blocked the sound — click to turn it on' : 'Unmute the preview')
          : 'Mute the preview'}
        className={`flex h-5 w-5 items-center justify-center transition-colors disabled:opacity-40 ${
          muted ? 'text-text-tertiary hover:text-text' : 'text-amber-800 hover:text-amber-900'
        }`}>
        {muted ? <IconVolumeMuted /> : <IconVolume />}
      </button>
      <input type="range" min={0} max={1} step={0.05} value={playback.muted ? 0 : playback.volume}
        onChange={e => playback.setVolume(Number(e.target.value))}
        disabled={!playback.ready} title="Preview volume"
        className="h-4 w-12 accent-amber-600 disabled:opacity-40" />
    </span>
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
