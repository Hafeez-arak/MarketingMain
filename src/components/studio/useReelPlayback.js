import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ─── Watching the reel before paying to assemble it ────────────────────────
// A multi-clip session decides its whole cut — the order of the shots, where
// each one starts and stops, what happens at every seam — in a form, before a
// single frame exists. This is what lets those decisions be made against the
// footage instead: the rendered clips played back to back, in order, with the
// trims applied, in the browser, for nothing.
//
// **Two <video> elements, not one.** Switching `src` on a single element tears
// down the decoder and refetches, which at a cut is a black hole of a few
// hundred milliseconds — long enough that you would be judging the pacing of
// the loader rather than of the edit. So the next clip is loaded and seeked to
// its in-point on the *other* element while the current one is still playing,
// and the seam is a swap of which one is on top.
//
// **Where the truth lives.** Which element is playing and which shot it is
// playing are ONE fact, and it changes in the middle of a frame callback. Held
// as two pieces of React state they can be read as a mismatched pair — which
// is not a hypothetical: the first version of this did exactly that and, after
// one seam, left the visible element frozen on a stale frame while the other
// one played on invisibly. So `activeRef` is authoritative and the matching
// state exists only so the component can re-render the right element to the
// front. Nothing in the pump reads the state.
//
// Reel time is the sum of the TRIMMED lengths. Crossfades make the stitched
// output shorter than that, because the two sides overlap — the preview plays
// every seam as a cut and the UI says so, which is a smaller lie than
// pretending a blend that isn't there.

const PRELOAD_LEAD_S = 1.5
const SEAM_EPSILON = 0.04

export function useReelPlayback(segments) {
  const aRef = useRef(null)
  const bRef = useRef(null)

  // The authoritative pair. Never read during render.
  const activeRef = useRef({ isA: true, index: 0 })
  // Its shadow, for rendering only.
  const [active, setActive] = useState({ isA: true, index: 0 })
  const [playing, setPlaying] = useState(false)

  // Where each clip starts on the reel's own clock, plus the total.
  const { offsets, duration } = useMemo(() => {
    const out = []
    let acc = 0
    for (const s of segments) {
      out.push(acc)
      acc += Math.max(0, s.out - s.in)
    }
    return { offsets: out, duration: acc }
  }, [segments])

  const timeRef = useRef(0)
  const subs = useRef(new Set())
  // The clip each element is currently holding, so a swap doesn't refetch a
  // file the element already has decoded.
  const loaded = useRef({ a: null, b: null })
  const preloadedFor = useRef(-1)
  // The pump reads these rather than closing over them, so it can be an effect
  // that runs once per play/pause instead of once per seam.
  const segRef = useRef(segments)
  const offsetsRef = useRef(offsets)
  const durationRef = useRef(duration)
  // Refreshed after every render rather than during one. The pump is the only
  // reader and it runs from an animation frame, which is always after a commit
  // — so these are never a render behind by the time anything looks at them.
  useEffect(() => {
    segRef.current = segments
    offsetsRef.current = offsets
    durationRef.current = duration
  })

  const notify = useCallback(t => {
    timeRef.current = t
    for (const fn of subs.current) fn(t)
  }, [])

  const subscribe = useCallback(fn => {
    subs.current.add(fn)
    fn(timeRef.current)
    return () => { subs.current.delete(fn) }
  }, [])

  const elFor = useCallback(isA => (isA ? aRef.current : bRef.current), [])

  // Moves the authoritative pair and tells React about it in one place, so the
  // two can never be updated independently.
  const setActivePair = useCallback((isA, index) => {
    activeRef.current = { isA, index }
    setActive(prev => (prev.isA === isA && prev.index === index ? prev : { isA, index }))
  }, [])

  // Point an element at a clip and park it on that clip's in-point. Skipped
  // when it is already holding the same file — which is what makes scrubbing
  // inside one shot cost nothing.
  const load = useCallback((isA, segIndex, localT) => {
    const el = elFor(isA)
    const seg = segRef.current[segIndex]
    if (!el || !seg) return
    const slot = isA ? 'a' : 'b'
    if (loaded.current[slot] !== seg.url) {
      el.crossOrigin = 'anonymous'   // before src. always. see videoFrame.js
      el.src = seg.url
      loaded.current[slot] = seg.url
    }
    el.currentTime = seg.in + Math.max(0, localT || 0)
  }, [elFor])

  // Reel time → which clip and how far into it.
  const locate = useCallback(t => {
    const segs = segRef.current
    const offs = offsetsRef.current
    if (!segs.length) return { i: 0, local: 0 }
    let i = 0
    while (i < segs.length - 1 && t >= offs[i + 1]) i += 1
    return { i, local: Math.max(0, t - offs[i]) }
  }, [])

  const seek = useCallback(reelT => {
    const t = Math.min(Math.max(0, Number(reelT) || 0), durationRef.current || 0)
    const { i, local } = locate(t)
    // A seek takes over whichever element is already on screen rather than
    // swapping, so the visible surface never goes blank mid-drag.
    const { isA } = activeRef.current
    load(isA, i, local)
    setActivePair(isA, i)
    preloadedFor.current = -1
    notify(t)
  }, [locate, load, setActivePair, notify])

  // ── The frame pump ──────────────────────────────────────────────────────
  // Depends on `playing` alone. Everything else it needs is behind a ref, so a
  // seam does not tear this down and rebuild it — which is what let the old
  // version resume against a stale element.
  useEffect(() => {
    if (!playing) return undefined
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const { isA, index } = activeRef.current
      const el = elFor(isA)
      const seg = segRef.current[index]
      if (!el || !seg) return

      const local = Math.max(0, el.currentTime - seg.in)
      notify(Math.min((offsetsRef.current[index] || 0) + local, durationRef.current))

      const next = index + 1
      const last = next >= segRef.current.length

      // Get the next clip decoding while there is still footage to watch, so
      // the swap at the seam is a swap and not a load.
      if (!last && (seg.out - seg.in) - local < PRELOAD_LEAD_S && preloadedFor.current !== next) {
        preloadedFor.current = next
        load(!isA, next, 0)
      }

      if (el.currentTime >= seg.out - SEAM_EPSILON) {
        el.pause()
        if (last) {
          setPlaying(false)
          notify(durationRef.current)
          cancelAnimationFrame(raf)
          return
        }
        load(!isA, next, 0)
        setActivePair(!isA, next)
        preloadedFor.current = -1
        elFor(!isA)?.play().catch(() => {})
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, elFor, load, setActivePair, notify])

  const play = useCallback(() => {
    if (!segRef.current.length) return
    // Landing on the end and pressing play should replay, as every player
    // does. Anywhere else, carry on from where the playhead is.
    const atEnd = timeRef.current >= durationRef.current - 0.05
    const from = atEnd ? 0 : timeRef.current
    const { i, local } = locate(from)
    if (atEnd) notify(0)
    const { isA } = activeRef.current
    load(isA, i, local)
    setActivePair(isA, i)
    preloadedFor.current = -1
    setPlaying(true)
    elFor(isA)?.play().catch(() => {})
  }, [locate, load, setActivePair, elFor, notify])

  const pause = useCallback(() => {
    aRef.current?.pause()
    bRef.current?.pause()
    setPlaying(false)
  }, [])

  const toggle = useCallback(() => { (playing ? pause() : play()) }, [playing, play, pause])

  // ── Resetting when the cut changes ──────────────────────────────────────
  // A reordered or re-trimmed reel whose playhead stayed put would be showing
  // a frame from a shot that is no longer in that position, so everything goes
  // back to the first frame.
  //
  // Split in two on purpose. The STATE half runs during render, which is
  // React's documented way to adjust state when an input changes; an effect
  // would render the stale cut once and then immediately render again. The
  // IMPERATIVE half is an effect, because pointing a <video> at a file is
  // exactly the external-system work effects are for.
  const shape = segments.map(s => `${s.url}|${s.in}|${s.out}`).join('~')
  const [lastShape, setLastShape] = useState(shape)
  if (lastShape !== shape) {
    setLastShape(shape)
    setPlaying(false)
    setActive({ isA: true, index: 0 })
  }

  useEffect(() => {
    activeRef.current = { isA: true, index: 0 }
    preloadedFor.current = -1
    loaded.current = { a: null, b: null }
    timeRef.current = 0
    if (!segRef.current.length) return
    load(true, 0, 0)
    notify(0)
  }, [shape, load, notify])

  // Callback refs rather than ref objects. Handing a caller a `.current` to
  // read during render is the thing React tells you not to do — and these two
  // elements are only ever touched imperatively in here, so there is nothing
  // for the caller to read. It just needs somewhere to attach them.
  const attachA = useCallback(node => { aRef.current = node }, [])
  const attachB = useCallback(node => { bRef.current = node }, [])

  // `timeRef` is deliberately not returned: handing a ref out makes every
  // property read off this object look like a ref access, and `subscribe`
  // already delivers the time to the one place that wants it, sixty times a
  // second, without a render.
  return {
    attachA, attachB,
    activeIsA: active.isA, index: active.index,
    playing, duration, offsets,
    ready: segments.length > 0,
    subscribe, seek, play, pause, toggle,
  }
}
