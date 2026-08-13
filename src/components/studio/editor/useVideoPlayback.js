import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Playing the clip you are editing ──────────────────────────────────────
// Owns a detached <video> for the footage under the canvas. Detached on
// purpose: nothing about it is laid out or styled, it exists only to be a
// source `drawImage` can read, and Konva draws a video element that was never
// put in the document perfectly well.
//
// The design decision worth stating is that **the current time is not React
// state while the clip is playing.** Sixty renders a second of an editor whose
// tree includes a wrapping toolbar, a side panel and every Konva node would be
// pure waste, and none of it would look different — only the layers' opacity
// changes. So a frame is a gesture, not derived state (the same reasoning
// Timeline.jsx already applies to its drags): while playing, subscribers are
// handed the time directly and mutate what they own. Time re-enters React on
// pause, seek and end — the three moments where the rest of the UI has to
// agree with it — and those are rare.
//
// crossOrigin='anonymous' BEFORE src, always, for the same reason
// videoFrame.js says so: without it the canvas is tainted the moment a frame is
// drawn, and Supabase only honours it when the attribute is already set.

// `trim` is the raw { start, end } off the document, in seconds of source
// time, or null for the whole clip. It arrives unresolved because only this
// hook knows the clip's real length — it reads it off the media — and the
// window is that length intersected with the trim.
//
// Playback is confined to the window so what you watch is what ships, but
// SEEKING is not: the timeline shows the whole clip with the excluded parts
// dimmed, and dragging the playhead into a dimmed region to see what you are
// cutting has to work.
export function useVideoPlayback(videoUrl, fallbackDuration = 0, trim = null) {
  // The element is a mutable resource, not state: it is created once per URL,
  // mutated constantly (currentTime, play, pause) and never re-rendered from.
  // `ready` is the render signal instead — it flips once, when there is a
  // decoded frame worth drawing, and that is the only moment a consumer needs
  // to re-render for.
  // Two handles on one object, deliberately. `videoRef` is the one that gets
  // mutated — currentTime, play, pause — because those are imperative calls on
  // an external resource and have no business triggering a render. `readyEl`
  // is the one Konva draws from, and it IS state, because it is read during
  // render and the canvas has to re-render the moment it appears. It is only
  // ever read, never written through; it is set once, from the media's own
  // `loadeddata` event, when there is a decoded frame worth drawing.
  const videoRef = useRef(null)
  const [readyEl, setReadyEl] = useState(null)
  const ready = !!readyEl
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  // The clip's REAL length, once it reports one. The version row's `duration`
  // is what we asked the model for, rounded to a string; what came back can be
  // a little different, and the timeline is drawn to scale against it. Falling
  // back to the requested figure keeps the strip usable while metadata loads.
  const [duration, setDuration] = useState(Number(fallbackDuration) || 0)
  const [time, setTime] = useState(0)

  const timeRef = useRef(0)
  const subs = useRef(new Set())

  const notify = useCallback(t => {
    timeRef.current = t
    for (const fn of subs.current) fn(t)
  }, [])

  const subscribe = useCallback(fn => {
    subs.current.add(fn)
    // Fire once on subscribe so a component that mounts mid-scrub paints the
    // right thing immediately rather than at the next frame.
    fn(timeRef.current)
    return () => { subs.current.delete(fn) }
  }, [])

  // ── The element ─────────────────────────────────────────────────────────
  // No setState in the body: the flags are only ever raised from the media's
  // own events, which is the "subscribe to an external system" shape an effect
  // is for. The teardown lowers them, which is a cleanup rather than a
  // cascading render.
  useEffect(() => {
    if (!videoUrl) return undefined

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'   // before src. always.
    video.playsInline = true
    video.preload = 'auto'

    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration)
    }
    // 'loadeddata' rather than 'loadedmetadata': metadata gives dimensions and
    // length, but there is nothing decoded to draw until a frame has arrived,
    // and drawing an empty video paints a blank rectangle rather than failing.
    const onData = () => { setReadyEl(video); notify(video.currentTime) }
    const onPlay = () => setPlaying(true)
    const onPause = () => { setPlaying(false); setTime(video.currentTime); notify(video.currentTime) }
    const onEnded = () => { setPlaying(false); setTime(video.currentTime); notify(video.currentTime) }
    const onSeeked = () => notify(video.currentTime)
    const onError = () => setError("This clip couldn't be loaded for playback.")

    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('loadeddata', onData)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)

    videoRef.current = video
    video.src = videoUrl

    return () => {
      video.pause()
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('loadeddata', onData)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      video.removeAttribute('src')
      video.load()
      videoRef.current = null
      setReadyEl(null)
      setPlaying(false)
    }
  }, [videoUrl, notify])

  // ── The frame pump ──────────────────────────────────────────────────────
  // One rAF loop, alive only while playing. requestVideoFrameCallback would be
  // the more precise signal, but it fires at the clip's frame rate (24–30fps)
  // and the overlay fades want to move at the display's — a fade rendered in
  // 24 steps against footage playing at 24fps looks fine, but scrubbing and
  // the playhead do not. rAF drives both at once.
  //
  // It is also where the trim's OUT point is enforced. There is no media event
  // for "reached a time that isn't the end of the file", so stopping at the
  // out point has to be a check on each frame; doing it here rather than with
  // a timer means it cannot drift away from the frame actually on screen.
  //
  // Both edges are reduced to plain numbers before they reach an effect's
  // dependencies. The document hands over an object, and a fresh object each
  // render would tear the rAF pump down and rebuild it on every frame.
  const inAt = Math.max(0, Number(trim?.start) || 0)
  const rawOut = trim?.end
  const outAt = rawOut === null || rawOut === undefined || rawOut === ''
    ? null
    : Math.min(Number(rawOut) || 0, duration || Number(rawOut) || 0)
  useEffect(() => {
    const v = videoRef.current
    if (!playing || !v) return undefined
    let raf = 0
    const tick = () => {
      if (outAt !== null && v.currentTime >= outAt) {
        v.pause()
        v.currentTime = outAt
        notify(outAt)
        return
      }
      notify(v.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, notify, outAt])

  const seek = useCallback(t => {
    const v = videoRef.current
    const max = duration || 0
    const next = Math.min(Math.max(0, Number(t) || 0), max || Number(t) || 0)
    setTime(next)
    notify(next)
    if (v) v.currentTime = next
  }, [duration, notify])

  const play = useCallback(async () => {
    const v = videoRef.current
    if (!v) return
    // Play means "play what ships", so a playhead parked outside the trimmed
    // window — including the ordinary case of sitting on the last frame after
    // a run-through — starts again from the in point rather than sitting there
    // or playing footage that has been cut.
    const to = outAt !== null ? outAt : (duration || 0)
    if (v.currentTime < inAt - 0.001 || (to && v.currentTime >= to - 0.02)) {
      v.currentTime = inAt
      notify(inAt)
    }
    try {
      await v.play()
    } catch {
      // Autoplay policy can refuse a clip with sound even from inside a click
      // in some embeddings. Losing the audio is a far better outcome than a
      // play button that does nothing, so retry muted and say nothing.
      v.muted = true
      try { await v.play() } catch { setError('This clip could not be played here.') }
    }
  }, [duration, notify, inAt, outAt])

  const pause = useCallback(() => { videoRef.current?.pause() }, [])
  const toggle = useCallback(() => { (playing ? pause() : play()) }, [playing, play, pause])

  return {
    el: readyEl, ready, playing, error, duration, time, timeRef,
    subscribe, seek, play, pause, toggle,
  }
}
